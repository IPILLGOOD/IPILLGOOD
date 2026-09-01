import { mkdir, mkdtemp, open, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PILL_PHOTO_CASES, PILL_PHOTO_FILES, PILL_PHOTO_SOURCE_URL, PILL_PHOTO_EXPECTED_REJECTIONS } from "../test-support/pill-photo-review.ts";
import { applyReviewedPhotoMaskGate, assessReviewedPhotoMask, extractReviewedPillPhotos, pillPhotoExperimentVersions, prepareReviewedPillPhoto, reviewedPhotoIndex, type PhotoExtractionResult, type ReviewedPhotoMaskAssessment } from "../src/pill-photo-experiment.ts";
import { comparePillPhotoFeatures, migratePillPhotoFeaturesV1 } from "../src/pill-photo-features.ts";
import { MAX_PILL_SNAPSHOT_BYTES, snapshotSearchCatalog, validatePillCatalogSnapshot } from "../src/pill-catalog-snapshot.ts";
import { readBoundedJson } from "./pill-catalog.ts";
import { serializePillProfile } from "./profile-pill-catalog.ts";
import { loadFrozenPillPhotoFixture, PILL_PHOTO_FIXTURE_IMAGES } from "../test-support/pill-photo-fixture.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SOURCE = PILL_PHOTO_FIXTURE_IMAGES;
const OUTPUT = join(ROOT, "verification-artifacts/pill-photo");
const HELP = `Reviewed public pill photo experiment (NOT a user-upload service):
  replay [--case <fixed-case-id>]
  review --catalog <catalog.json> --max-age-hours <1..168> [--case <fixed-case-id>]
  evaluate --catalog <catalog.json> --max-age-hours <1..168> --live --confirm-public-transfer [--case <fixed-case-id>]

replay is offline: Git fixtures + SAVED AI features + current search, with no API key or freshness claim.
review is offline: verifies hashes, decodes images, and creates a local HTML review sheet (fresh catalog required).
evaluate sends at most six reviewed public photo pairs through one Vision and two surface-specific OCR requests per pair, sequentially, without retries.
Only the compiled allowlist is accepted. No arbitrary photo paths, URLs or manifests.
Expected product codes/filenames never enter AI requests. The FULL catalog is searched.
Outputs are ignored under verification-artifacts/pill-photo/. Existing runs are not overwritten.
Actual patient/user photos remain blocked by #61/#88. Results are candidates, not medicine identities.`;

export function parsePillPhotoArgs(args: string[]) {
  const [command, ...rest] = args;
  if (command !== "review" && command !== "evaluate" && command !== "replay") throw new Error("invalid_arguments");
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    if (!["--catalog", "--max-age-hours", "--case", "--live", "--confirm-public-transfer"].includes(flag) || flags.has(flag)) throw new Error("invalid_arguments");
    if (flag === "--live" || flag === "--confirm-public-transfer") { flags.set(flag, "true"); continue; }
    const value = rest[++i];
    if (!value || value.startsWith("--")) throw new Error("invalid_arguments");
    flags.set(flag, value);
  }
  const cases = flags.has("--case") ? PILL_PHOTO_CASES.filter((item) => item.id === flags.get("--case")) : [...PILL_PHOTO_CASES];
  if (!cases.length) throw new Error("unknown_case");
  if (command === "replay") {
    if ([...flags.keys()].some((flag) => flag !== "--case")) throw new Error("replay_is_frozen_and_offline");
    return { command, catalogPath: null, maxAgeHours: null, cases };
  }
  if (!flags.has("--catalog") || !flags.has("--max-age-hours")) throw new Error("missing_arguments");
  const maxAgeHours = Number(flags.get("--max-age-hours"));
  if (!Number.isInteger(maxAgeHours) || maxAgeHours < 1 || maxAgeHours > 168) throw new Error("invalid_freshness_policy");
  if (command === "evaluate" && (!flags.has("--live") || !flags.has("--confirm-public-transfer"))) throw new Error("explicit_public_transfer_required");
  if (command === "review" && (flags.has("--live") || flags.has("--confirm-public-transfer"))) throw new Error("review_is_offline");
  return { command, catalogPath: resolve(flags.get("--catalog")!), maxAgeHours, cases };
}

/** Fixed exact size + bounded read + hash validation before any decoder/network use. */
export async function readReviewedPhoto(index: number, source = SOURCE): Promise<Buffer> {
  const entry = PILL_PHOTO_FILES[index];
  if (!entry) throw new Error("unreviewed_photo");
  const handle = await open(join(source, entry.path), "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== entry.bytes) throw new Error("unreviewed_photo");
    const bytes = Buffer.alloc(entry.bytes + 1);
    let total = 0;
    while (total < bytes.length) {
      const read = await handle.read(bytes, total, bytes.length - total, null);
      if (!read.bytesRead) break;
      total += read.bytesRead;
    }
    const result = bytes.subarray(0, total);
    if (reviewedPhotoIndex(result) !== index) throw new Error("unreviewed_photo");
    return result;
  } finally { await handle.close(); }
}

type Comparison = ReturnType<typeof comparePillPhotoFeatures>;
export function scorePillPhotoCase(expectedItemSeq: string | null, comparison: Comparison | null, expectedRejectionReason?: string) {
  const expectedGateObserved = expectedRejectionReason && comparison ? comparison.reason === expectedRejectionReason : null;
  if (!comparison || comparison.status === "invalid_features") return { outcome: "not_evaluated", expectedRank: null, expectedHeld: false, expectedGateObserved };
  const search = comparison.search;
  if (search && ["invalid_input", "not_configured", "unavailable"].includes(search.status)) return { outcome: "not_evaluated", expectedRank: null, expectedHeld: false, expectedGateObserved };
  if (expectedItemSeq === null) {
    // Provider failures and an accidental zero-hit search do not count as successful rejection.
    const rejected = comparison.status === "needs_retake" || search?.status === "needs_retake" || search?.status === "unsupported_form";
    return { outcome: rejected ? "rejected" : "rejection_missed", expectedRank: null, expectedHeld: false, expectedGateObserved };
  }
  const index = search?.candidates.findIndex((item) => item.itemSeq === expectedItemSeq) ?? -1;
  return { outcome: index >= 0 ? "expected_candidate_found" : search?.truncated ? "not_in_displayed_candidates" : "expected_candidate_missing",
    expectedRank: index >= 0 ? index + 1 : null,
    expectedHeld: search?.heldCandidates.some((item) => item.itemSeq === expectedItemSeq) ?? false, expectedGateObserved };
}

type Row = {
  id: string; kind: string; expectedItemSeq: string | null; expectedProduct: string | null;
  evidenceUrl: string | null; photos: string[]; extraction: PhotoExtractionResult | null;
  maskAssessments: ReviewedPhotoMaskAssessment[];
  comparison: Comparison | null; evaluation: ReturnType<typeof scorePillPhotoCase>;
  expectedReference?: Array<{ formName: string | null; shape: string | null; colors: string[]; frontImprint: string | null; backImprint: string | null; imageUrl: string | null }>;
};
export type PillPhotoReport = {
  mode: string; createdAt: string; versions: typeof pillPhotoExperimentVersions;
  model: string | null; catalogVersion: string; catalogRecords: number; catalogVerifiedAt: string;
  maxAgeHours: number | null; requests: number; sourceUrl: string; rows: Row[];
  replay?: { fixtureVersion: string; recordedAt: string; recordedModel: string; recordedVersions: { review: string; preprocessing: string; prompt: string }; recordedRequests: number };
};

const html = (value: unknown) => String(value ?? "미상").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
function safeLink(value: string | null, label: string) {
  try { if (value && new URL(value).protocol === "https:") return `<a href="${html(value)}" target="_blank" rel="noreferrer noopener">${html(label)}</a>`; } catch { /* no link */ }
  return "";
}

/** No scripts, auto-fetched external images, user HTML, or raw provider response. */
export function renderPillPhotoReport(report: PillPhotoReport): string {
  const found = report.rows.filter((row) => row.evaluation.outcome === "expected_candidate_found").length;
  const positive = report.rows.filter((row) => row.expectedItemSeq !== null).length;
  const rejected = report.rows.filter((row) => row.evaluation.outcome === "rejected").length;
  const negatives = report.rows.length - positive;
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>IPILLGOOD · 공개 사진 실험</title><style>
body{font:16px/1.65 system-ui,sans-serif;background:#f4f6f5;color:#18332d;margin:0}main{max-width:1100px;margin:auto;padding:28px}h1{margin-bottom:4px}h2{font-size:21px}.notice{background:#fff0cd;padding:16px;border-radius:12px}section{background:white;border:1px solid #d5dfda;border-radius:14px;padding:22px;margin:24px 0}.pair{display:flex;gap:14px;flex-wrap:wrap}.pair figure{margin:0;flex:1;min-width:220px}.pair img{width:100%;height:240px;object-fit:contain;background:#fff;border:1px solid #ddd;border-radius:8px}figcaption{font-size:12px;overflow-wrap:anywhere}pre{background:#eef4f1;padding:14px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}a{color:#086657}table{border-collapse:collapse;width:100%;font-size:14px}td,th{border-bottom:1px solid #ddd;text-align:left;padding:8px}code{overflow-wrap:anywhere}.muted{color:#52665f;font-size:14px}</style><main>
<h1>사진 → 특징 → 공식 후보</h1><p>IPILLGOOD · 검수된 공개 샘플 로컬 실험 · ${html(report.mode)}</p>
<p class="notice">약의 확정·복용 가능 판정이 아닙니다. 사용자 업로드 기능이 아니며 #61/#88 완료 전 운영 활성화를 금지합니다. 정답 정보는 평가용으로만 표시하며 AI에는 보내지 않았습니다.</p>
${report.replay ? `<p class="notice">오프라인 재생: ${html(report.replay.recordedAt)}에 저장한 AI 추출 결과와 고정 카탈로그를 현재 검색 코드로 다시 비교했습니다. 사진을 AI로 새로 분석하지 않았고 현재 데이터의 최신성을 주장하지 않습니다. 이번 외부 호출은 0회입니다.</p>` : ""}
<p>기대 품목이 표시 후보에 포함: ${found}/${positive} · 예외 거절: ${rejected}/${negatives} · 외부 요청 ${report.requests}회</p>
<p>기대했던 예외 원인까지 감지: ${report.rows.filter((row) => row.evaluation.expectedGateObserved === true).length}/${negatives}. 다른 이유로 거절된 결과와 구분합니다.</p>
<p class="muted">4개 제품에서 고른 공개 누끼 사진 기반의 소규모 개발 점검입니다. 실사용 정확도·임상 검증 수치가 아닙니다. review 모드의 미실행 항목은 실패율 계산에 쓰지 않습니다.</p>
<details><summary>실험 버전·출처</summary><pre>${html(JSON.stringify({ ...report, rows: undefined }, null, 2))}</pre>${safeLink(report.sourceUrl, "공개 샘플 출처")}</details>
${report.rows.map((row) => `<section><h2>${html(row.id)} · ${html(row.evaluation.outcome)}</h2>
<p>평가용 기대 품목: ${html(row.expectedProduct ?? "후보 제시 없이 재촬영/비지원 처리 기대")} ${html(row.expectedItemSeq ?? "")} · ${safeLink(row.evidenceUrl, "접수번호 대응 근거")}</p>
<div class="pair">${row.photos.map((path, index) => `<figure><img src="${html(`photo-${path}.png`)}" alt="검수된 공개 사진 ${index === 0 ? "A" : "B"}"><figcaption>사진 ${index === 0 ? "A" : "B"} · ${html(PILL_PHOTO_FILES[Number(path)]?.path)}</figcaption></figure>`).join("")}</div>
<p>처리 상태: <strong>${html(row.extraction && !row.extraction.ok ? row.extraction.reason : row.comparison?.search?.status ?? row.comparison?.status ?? "not_run")}</strong> · ${html(row.comparison?.search?.reason ?? row.comparison?.reason ?? "미실행")}</p>
<details open><summary>${report.replay ? "과거에 저장된 사진 특징 (이번에 새로 추출하지 않음)" : "사진에서 추출한 특징"}</summary><pre>${html(JSON.stringify(row.extraction?.ok ? row.extraction.features : null, null, 2))}</pre></details>
<details><summary>로컬 투명 마스크 품질 점검</summary><pre>${html(JSON.stringify(row.maskAssessments, null, 2))}</pre></details>
<details><summary>평가용 정답 제품의 공식 특징 (AI 입력 아님)</summary><pre>${html(JSON.stringify(row.expectedReference ?? [], null, 2))}</pre>${(row.expectedReference ?? []).map((item) => safeLink(item.imageUrl, "평가용 공식 이미지 열기")).join(" ")}</details>
${row.comparison?.search ? `<p>${html(row.comparison.search.message)} 비교 후보 ${row.comparison.search.metrics.candidateCount}개 / 보류 ${row.comparison.search.metrics.heldCandidateCount}개. 기대 품목 표시 순서: ${html(row.evaluation.expectedRank)} (식별 확률이 아님)</p><table><tr><th>비교 후보</th><th>품목코드</th><th>비교 형태</th><th>공식 이미지</th></tr>${row.comparison.search.candidates.map((candidate) => `<tr><td>${html(candidate.variants[0]?.item.productName)}</td><td>${html(candidate.itemSeq)}</td><td>${html(candidate.matchType)}</td><td>${safeLink(candidate.variants[0]?.item.imageUrl ?? null, "공식 이미지 열기")}</td></tr>`).join("")}</table><details><summary>단계별 후보 수·일치/누락 근거·별도 보류 항목</summary><pre>${html(JSON.stringify(row.comparison.search, null, 2))}</pre></details>` : ""}
</section>`).join("\n")}<p class="muted">AI가 각인·색상을 잘못 읽으면 후보가 누락되거나 잘못 남을 수 있습니다. 약 봉투·처방전·약사 확인을 대체하지 않습니다.</p></main></html>`;
}

export async function runPillPhotoExperiment(args: string[]) {
  const options = parsePillPhotoArgs(args);
  const frozen = options.command === "replay" ? await loadFrozenPillPhotoFixture() : null;
  const checked = frozen ? { ok: true as const, snapshot: frozen.snapshot }
    : validatePillCatalogSnapshot(await readBoundedJson(options.catalogPath!, MAX_PILL_SNAPSHOT_BYTES));
  if (!checked.ok) throw new Error(checked.reason);
  const snapshot = checked.snapshot;
  const searchable = frozen ? { ok: true as const, catalog: frozen.catalog }
    : snapshotSearchCatalog(snapshot, { now: new Date(), maxAgeHours: options.maxAgeHours! });
  if (!searchable.ok) throw new Error(searchable.reason);
  if (options.cases.some((item) => item.expectedItemSeq && !snapshot.items.some((record) => record.itemSeq === item.expectedItemSeq))) throw new Error("expected_product_not_in_catalog");
  if (options.command === "evaluate" && !process.env.OPENAI_API_KEY?.trim()) throw new Error("not_configured");
  const originals = new Map<number, Buffer>();
  const previews = new Map<number, Buffer>();
  const maskAssessments = new Map<number, ReviewedPhotoMaskAssessment>();
  // Preflight ALL selected files before the first external request.
  for (const index of new Set(options.cases.flatMap((item) => [...item.photos]))) {
    const bytes = await readReviewedPhoto(index);
    originals.set(index, bytes);
    maskAssessments.set(index, await assessReviewedPhotoMask(bytes));
    previews.set(index, await prepareReviewedPillPhoto(bytes));
  }
  await mkdir(OUTPUT, { recursive: true });
  const directory = await mkdtemp(join(OUTPUT, "run-"));
  for (const [index, bytes] of previews) await writeFile(join(directory, `photo-${index}.png`), bytes, { flag: "wx", mode: 0o600 });
  const report: PillPhotoReport = {
    mode: options.command, createdAt: new Date().toISOString(), versions: pillPhotoExperimentVersions,
    model: options.command === "evaluate" ? process.env.OPENAI_MODEL ?? "gpt-5.6-luna" : null,
    catalogVersion: snapshot.version, catalogRecords: snapshot.totalCount, catalogVerifiedAt: snapshot.verifiedAt,
    maxAgeHours: options.maxAgeHours, requests: 0, sourceUrl: PILL_PHOTO_SOURCE_URL,
    ...(frozen ? { replay: { fixtureVersion: frozen.manifest.fixtureVersion, recordedAt: frozen.baseline.createdAt,
      recordedModel: frozen.baseline.model, recordedVersions: frozen.baseline.versions, recordedRequests: frozen.baseline.requests } } : {}),
    rows: options.cases.map((item) => ({ id: item.id, kind: item.kind, expectedItemSeq: item.expectedItemSeq,
      expectedProduct: snapshot.items.find((record) => record.itemSeq === item.expectedItemSeq)?.productName ?? null,
      expectedReference: snapshot.items.filter((record) => record.itemSeq === item.expectedItemSeq).map((record) => ({ formName: record.formName, shape: record.shape, colors: record.colors, frontImprint: record.front.imprint, backImprint: record.back.imprint, imageUrl: record.imageUrl })),
      evidenceUrl: item.evidenceUrl, photos: item.photos.map(String), extraction: null,
      maskAssessments: item.photos.map((photo) => maskAssessments.get(photo)!), comparison: null,
      evaluation: scorePillPhotoCase(item.expectedItemSeq, null, PILL_PHOTO_EXPECTED_REJECTIONS[item.id]) })),
  };
  if (frozen) {
    for (const row of report.rows) {
      const saved = frozen.baseline.rows.find((item) => item.id === row.id)!;
      row.extraction = { ...saved.extraction, features: migratePillPhotoFeaturesV1(saved.extraction.features) };
      row.comparison = comparePillPhotoFeatures(applyReviewedPhotoMaskGate(row.extraction.features, row.maskAssessments), searchable.catalog);
      row.evaluation = scorePillPhotoCase(row.expectedItemSeq, row.comparison, PILL_PHOTO_EXPECTED_REJECTIONS[row.id]);
    }
  }
  await writeFile(join(directory, "preflight.json"), serializePillProfile({ ...report, files: [...originals.keys()].map((index) => PILL_PHOTO_FILES[index]) }), { flag: "wx", mode: 0o600 });
  if (options.command === "evaluate") {
    const countedFetch: typeof fetch = async (input, init) => {
      report.requests++;
      return fetch(input, init);
    };
    for (const [index, item] of options.cases.entries()) {
      const row = report.rows[index]!;
      row.extraction = await extractReviewedPillPhotos(
        [originals.get(item.photos[0])!, originals.get(item.photos[1])!],
        { allowExternalTransfer: true, fetchImpl: countedFetch },
      );
      if (row.extraction.ok) row.comparison = comparePillPhotoFeatures(applyReviewedPhotoMaskGate(row.extraction.features, row.maskAssessments), searchable.catalog);
      row.evaluation = scorePillPhotoCase(item.expectedItemSeq, row.comparison, PILL_PHOTO_EXPECTED_REJECTIONS[item.id]);
      await writeFile(join(directory, `case-${item.id}.json`), serializePillProfile(row), { flag: "wx", mode: 0o600 });
      console.error(serializePillProfile({ case: item.id, status: row.extraction.ok ? row.comparison?.search?.status ?? row.comparison?.status : row.extraction.reason, evaluation: row.evaluation }));
      if (!row.extraction.ok && !["refused", "incomplete_response", "invalid_response"].includes(row.extraction.reason)) break;
    }
  }
  const serialized = serializePillProfile(report);
  await writeFile(join(directory, "report.json"), serialized, { flag: "wx", mode: 0o600 });
  await writeFile(join(directory, "report.html"), renderPillPhotoReport(JSON.parse(serialized) as PillPhotoReport), { flag: "wx", mode: 0o600 });
  const failedExecution = options.command === "evaluate" && report.rows.some((row) => !row.extraction?.ok || row.evaluation.outcome === "not_evaluated");
  return { directory, report, failedExecution };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length === 3 && process.argv[2] === "--help") console.log(HELP);
  else runPillPhotoExperiment(process.argv.slice(2)).then(({ directory, report, failedExecution }) => {
    console.log(serializePillProfile({ status: failedExecution ? "incomplete" : "saved", directory, requests: report.requests,
      outcomes: report.rows.map((row) => ({ id: row.id, ...row.evaluation })) }));
    if (failedExecution) process.exitCode = 1;
  }).catch((error: unknown) => {
    const safe = new Set(["invalid_arguments", "missing_arguments", "invalid_freshness_policy", "explicit_public_transfer_required", "review_is_offline", "replay_is_frozen_and_offline", "unknown_case", "unreviewed_photo", "invalid_photo", "not_configured", "snapshot_integrity_failed", "snapshot_expired_or_future", "expected_product_not_in_catalog", "fixture_catalog_hash_mismatch", "fixture_baseline_hash_mismatch", "fixture_baseline_mismatch", "fixture_image_manifest_mismatch", "fixture_catalog_invalid", "fixture_catalog_decode_failed", "fixture_size_exceeded"]);
    console.error(JSON.stringify({ status: "unavailable", reason: error instanceof Error && safe.has(error.message) ? error.message : "local_operation_failed" }));
    process.exitCode = 1;
  });
}
