import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { readBoundedFixtureFile, loadFrozenPillPhotoFixture } from "../test-support/pill-photo-fixture.ts";
import { loadPillPhotoPhoneValidationFixture } from "../test-support/pill-photo-phone-validation.ts";
import { loadRegisteredPillPhotoEvaluationFixture } from "../test-support/pill-photo-evaluation-registry.ts";
import { comparePillPhotoTrialRuns } from "../test-support/pill-photo-trial-comparison.ts";
import { crossReplayPillPhotoSignals } from "../test-support/pill-photo-signal-cross.ts";
import { parsePillPhotoTrialCompareArgs } from "./pill-photo-trial-compare.ts";
import { readPillPhotoDiagnosticRuns } from "./pill-photo-diagnose.ts";
import { serializePillProfile } from "./profile-pill-catalog.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUTPUT = join(ROOT, "verification-artifacts/pill-photo-signal-cross");
const ANALYSIS_FILES = ["backend/scripts/pill-photo-signal-cross.ts", "backend/test-support/pill-photo-signal-cross.ts",
  "backend/scripts/pill-photo-diagnose.ts", "backend/test-support/pill-photo-diagnostics.ts",
  "backend/test-support/pill-photo-trial-comparison.ts", "backend/scripts/pill-photo-trial-compare.ts"];
const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const bindingSchema = z.object({ code: z.array(z.object({ path: z.string(), sha256: z.string() })),
  fixtureVersion: z.string(), fixtureContentSha256: z.string(), catalogVersion: z.string(), catalogSha256: z.string(),
  cases: z.array(z.object({ id: z.string(), sourceSha256: z.array(z.string()) })) });
type Binding = z.infer<typeof bindingSchema>;

/** Call only after the complete saved conditions passed comparePillPhotoTrialRuns. */
export function assertPillSignalCrossBinding(expected: Binding, actual: Binding) {
  if (!isDeepStrictEqual(expected, actual)) throw new Error("signal_cross_source_or_code_changed");
}
async function readRecord(path: string, limit: number) {
  const bytes = await readBoundedFixtureFile(path, limit);
  return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown, sha256: sha256(bytes) };
}
async function readTrial(directory: string) {
  const condition = await readRecord(join(directory, "condition.json"), 2 * 1024 * 1024);
  const summary = await readRecord(join(directory, "summary.json"), 512 * 1024);
  return { condition: condition.value, summary: summary.value, hashes: { condition: condition.sha256, summary: summary.sha256 } };
}
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export function renderPillSignalCross(report: ReturnType<typeof crossReplayPillPhotoSignals>) {
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Vision/OCR 교차 재생</title><style>body{font:16px/1.6 system-ui;max-width:1100px;margin:32px auto;padding:0 20px;color:#183d36}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccd8d4;padding:8px;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{margin:20px 0}</style><h1>저장된 Vision/OCR 교차 재생</h1><p>V0/O0: 기존 실험의 원신호. V1/O1: 새 실험의 원신호. OCR 프롬프트는 같고 응답만 다릅니다.</p><p>외부 요청 0 · 새 사진 추론 아님 · 6제품 × 3회 · 최선 조합 선별 금지</p><table><tr><th>조합</th><th>recall@1 (각 6)</th><th>recall@5 (각 6)</th><th>recall@20 (각 6)</th><th>강한 오답 / 재촬영 노출</th></tr>${report.aggregate.map(cell => `<tr><th>${cell.id}</th>${cell.recall.map(metric => `<td>${metric.hitsByRepetition.join(" · ")}</td>`).join("")}<td>${cell.safety.map(s => `${s.strongWrongCandidates}/${s.retakeCandidateExposureCases}`).join(" · ")}</td></tr>`).join("")}</table><h2>회차별 순위</h2>${report.repetitions.map(repeat => `<h3>${repeat.repetition}회</h3><table><tr><th>사례</th>${repeat.cells.map(cell => `<th>${cell.id}</th>`).join("")}</tr>${repeat.cells[0]!.rows.map((row, index) => `<tr><th>${escape(row.id)}</th>${repeat.cells.map(cell => `<td>${cell.rows[index]!.expectedRank ?? "상위20에 없음"}</td>`).join("")}</tr>`).join("")}</table><details><summary>후보·보류·거절 사유 및 결합 출처</summary><pre>${escape(JSON.stringify(repeat, null, 2))}</pre></details>`).join("")}<h2>조건부 변화와 한계</h2><pre>${escape(JSON.stringify({ effects: report.effects, limits: report.limits }, null, 2))}</pre></html>`;
}

export async function runPillPhotoSignalCross(args: string[]) {
  const paths = parsePillPhotoTrialCompareArgs(args);
  const analysisFingerprint = () => Promise.all(ANALYSIS_FILES.map(async path => ({ path,
    sha256: sha256(await readBoundedFixtureFile(join(ROOT, path), 256 * 1024)) })));
  const analysisCode = await analysisFingerprint();
  // Holdout/partial/unrelated trials fail before any private source or feature loader.
  const baseline = await readTrial(paths.baseline), candidate = await readTrial(paths.candidate);
  const comparison = comparePillPhotoTrialRuns(baseline, candidate);
  const expected = bindingSchema.parse(candidate.condition);
  const code = await Promise.all(expected.code.map(async file => ({ path: file.path,
    sha256: sha256(await readBoundedFixtureFile(join(ROOT, file.path), 4 * 1024 * 1024)) })));
  if (!isDeepStrictEqual(code, expected.code)) throw new Error("signal_cross_source_or_code_changed");
  const [registered, { manifest }, frozen] = await Promise.all([
    loadRegisteredPillPhotoEvaluationFixture("v4"), loadPillPhotoPhoneValidationFixture(), loadFrozenPillPhotoFixture(),
  ]);
  assertPillSignalCrossBinding(expected, { code, fixtureVersion: registered.fixtureVersion,
    fixtureContentSha256: sha256(JSON.stringify({ products: registered.products, images: registered.images, cases: registered.cases })),
    catalogVersion: frozen.catalog.version!, catalogSha256: frozen.manifest.catalog.sha256,
    cases: manifest.cases.map(row => ({ id: row.id, sourceSha256: row.photos.map(path => manifest.images.find(image => image.path === path)!.sha256) })),
  });
  const sourceHashes = [];
  const pairs = [];
  for (const repeat of [1, 2, 3]) {
    const sources = await readPillPhotoDiagnosticRuns([join(paths.baseline, `repeat-${repeat}`), join(paths.candidate, `repeat-${repeat}`)]);
    pairs.push({ baseline: sources[0]!.saved, candidate: sources[1]!.saved });
    sourceHashes.push({ repetition: repeat, baseline: sources[0]!.inputHashes, candidate: sources[1]!.inputHashes });
  }
  const report = crossReplayPillPhotoSignals(pairs, manifest, frozen.catalog);
  for (const repeat of report.repetitions) {
    const index = repeat.repetition - 1;
    if (repeat.sourcePipelines[0]!.visionVersion !== comparison.metadata.beforeVisionPrompt
      || repeat.sourcePipelines[1]!.visionVersion !== comparison.metadata.afterVisionPrompt
      || !isDeepStrictEqual(repeat.originalScores[0], comparison.rows.map(row => row.repetitions[index]!.before))
      || !isDeepStrictEqual(repeat.originalScores[1], comparison.rows.map(row => row.repetitions[index]!.after))) {
      throw new Error("signal_cross_saved_summary_mismatch");
    }
  }
  const afterCode = await Promise.all(expected.code.map(async file => ({ path: file.path,
    sha256: sha256(await readBoundedFixtureFile(join(ROOT, file.path), 4 * 1024 * 1024)) })));
  if (!isDeepStrictEqual(code, afterCode) || !isDeepStrictEqual(analysisCode, await analysisFingerprint())) {
    throw new Error("signal_cross_code_changed_during_replay");
  }
  const bundle = { createdAt: new Date().toISOString(), sourceTrialFileHashes: { baseline: baseline.hashes, candidate: candidate.hashes },
    conditionHashes: { baseline: comparison.metadata.beforeConditionSha256, candidate: comparison.metadata.afterConditionSha256 },
    sourceHashes, runtime: { node: process.version, platform: process.platform, arch: process.arch }, analysisCode,
    boundToSavedTrials: true, report };
  const json = serializePillProfile(bundle), safe = JSON.parse(json) as typeof bundle;
  await mkdir(OUTPUT, { recursive: true });
  const directory = await mkdtemp(join(OUTPUT, "cross-"));
  await writeFile(join(directory, "report.json"), json, { flag: "wx", mode: 0o600 });
  await writeFile(join(directory, "report.html"), renderPillSignalCross(safe.report), { flag: "wx", mode: 0o600 });
  return { directory, bundle: safe };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length === 3 && process.argv[2] === "--help") console.log("Offline v4 saved-signal cross replay: --baseline <complete-trial> --candidate <complete-trial>. No API key/server; no new inference. Requires original private validation fixture for hash/metadata integrity. Writes new ignored report.json/html; original artifacts stay unchanged.");
  else runPillPhotoSignalCross(process.argv.slice(2)).then(({ directory, bundle }) => console.log(serializePillProfile({
    directory, externalRequests: 0, newInference: false, diagonalsVerified: bundle.report.diagonalsVerified,
    aggregate: bundle.report.aggregate, effects: bundle.report.effects,
  }))).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    console.error(JSON.stringify({ status: "unavailable", reason: /^(signal_cross_|trial_comparison_|diagnostic_)[a-z_]+$/.test(message) ? message : "local_input_missing_or_invalid" }));
    process.exitCode = 1;
  });
}
