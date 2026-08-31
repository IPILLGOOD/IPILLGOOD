import { mkdir, mkdtemp, open, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { collectPillCatalogSnapshot, MAX_PILL_SNAPSHOT_BYTES, snapshotSearchCatalog, validatePillCatalogSnapshot, type PillCatalogSnapshot } from "../src/pill-catalog-snapshot.ts";
import { PILL_SEARCH_RULES_VERSION, searchPillCandidates, type PillObservation, type PillSearchResult } from "../src/pill-identification.ts";
import { serializePillProfile } from "./profile-pill-catalog.ts";

const OUTPUT_DIRECTORY = fileURLToPath(new URL("../../verification-artifacts/pill-catalog/", import.meta.url));
const HELP = `Local pill catalog tooling (run from the repository root):
  collect --live [--max-requests 600]
  search --catalog <catalog.json> --observation <observation.json> --max-age-hours <1..168> [--limit 20]

Collect: node --env-file=front/.env.local --experimental-strip-types backend/scripts/pill-catalog.ts collect --live
Search:  node --experimental-strip-types backend/scripts/pill-catalog.ts search --catalog <path> --observation <path> --max-age-hours 24

Only collect uses the official API (two sequential scans, no retries, no image downloads).
Search is offline. Output goes to ignored verification-artifacts/pill-catalog/; existing runs are never overwritten.
Generated examples copy official features for a smoke test; they are NOT a photo-accuracy evaluation.`;

export async function readBoundedJson(path: string, maxBytes: number): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_PILL_SNAPSHOT_BYTES) throw new Error("invalid_file_size_limit");
  const file = await open(path, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maxBytes) throw new Error("invalid_file_size");
    // Enforce the limit while reading too, including a file that grows after stat().
    const chunks: Buffer[] = [];
    let bytes = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, maxBytes - bytes + 1));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      bytes += bytesRead;
      if (bytes > maxBytes) throw new Error("invalid_file_size");
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { await file.close(); }
}

export function pillSnapshotSummary(snapshot: PillCatalogSnapshot) {
  const forms: Record<string, number> = {};
  const unknownForms = new Map<string, number>();
  const occurrences = new Map<string, number>();
  for (const item of snapshot.items) {
    forms[item.form] = (forms[item.form] ?? 0) + 1;
    if (item.form === "unknown") {
      const label = item.formName ?? "(missing)";
      unknownForms.set(label, (unknownForms.get(label) ?? 0) + 1);
    }
    occurrences.set(item.itemSeq, (occurrences.get(item.itemSeq) ?? 0) + 1);
  }
  return {
    version: snapshot.version, verification: snapshot.verification, verifiedAt: snapshot.verifiedAt,
    totalRecords: snapshot.totalCount, uniqueItemSeqs: occurrences.size,
    repeatedItemSeqCount: [...occurrences.values()].filter((count) => count > 1).length,
    repeatedItemSeqExamples: [...occurrences].filter(([, count]) => count > 1).slice(0, 20).map(([itemSeq, records]) => ({ itemSeq, records })),
    forms, unknownForms: Object.fromEntries(unknownForms), officialImageUrls: snapshot.items.filter((item) => item.imageUrl !== null).length,
    missingChangedDates: snapshot.items.filter((item) => item.source.changedAt === null).length,
    imagesDownloaded: 0,
  };
}

export function officialFeatureExamples(snapshot: PillCatalogSnapshot) {
  const eligible = snapshot.items.filter((item) => item.form !== "unknown" && item.shape && item.shape.length <= 40 && item.shape !== "기타"
    && item.colors.length > 0 && item.colors.length <= 4 && item.colors.every((color) => color.length <= 20) && item.front.imprint !== null && item.back.imprint !== null
    && item.front.imprint.length <= 80 && item.back.imprint.length <= 80 && item.imageUrl !== null);
  const chosen = [eligible.find((item) => item.form === "tablet"), eligible.find((item) => item.form === "capsule"),
    eligible.find((item) => item.front.imprintHasDescription || item.back.imprintHasDescription)];
  const seen = new Set<string>();
  return chosen.filter((item) => {
    if (!item || seen.has(item.itemSeq)) return false;
    seen.add(item.itemSeq);
    return true;
  }).map((item) => ({
    itemSeq: item!.itemSeq, productName: item!.productName, origin: "official_record_self_consistency_only" as const,
    observation: {
      source: "manual", form: item!.form, integrity: "intact", count: 1, overlapping: false, quality: "clear",
      shape: item!.shape, colors: item!.colors,
      front: { imprint: item!.front.imprint, scoreLine: item!.front.scoreLine },
      back: { imprint: item!.back.imprint, scoreLine: item!.back.scoreLine },
    } satisfies PillObservation,
  }));
}

/** New per-run directory. No shared active pointer, no overwrite of a previous good snapshot. */
export async function savePillSnapshot(snapshot: PillCatalogSnapshot, parent: string, environment: Record<string, string | undefined> = process.env) {
  const checked = validatePillCatalogSnapshot(snapshot);
  if (!checked.ok) throw new Error(checked.reason);
  const pretty = JSON.stringify(checked.snapshot, null, 2);
  // Reject credential reflection, rather than silently changing official data and its digest on disk.
  if (serializePillProfile(checked.snapshot, environment) !== pretty) throw new Error("reflected_secret_rejected");
  const serialized = JSON.stringify(checked.snapshot);
  if (Buffer.byteLength(serialized) > MAX_PILL_SNAPSHOT_BYTES) throw new Error("snapshot_size_exceeded");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "run-"));
  const pending = join(directory, "catalog.pending");
  const catalogPath = join(directory, "catalog.json");
  await writeFile(pending, serialized, { flag: "wx", mode: 0o600 });
  await rename(pending, catalogPath); // Destination is absent in this newly created directory.
  const examples = [];
  for (const [index, example] of officialFeatureExamples(checked.snapshot).entries()) {
    const observationPath = join(directory, `example-${index + 1}.json`);
    await writeFile(observationPath, JSON.stringify(example.observation, null, 2), { flag: "wx", mode: 0o600 });
    examples.push({ itemSeq: example.itemSeq, productName: example.productName, origin: example.origin, observationPath });
  }
  const summary = { ...pillSnapshotSummary(checked.snapshot), catalogPath, examples };
  await writeFile(join(directory, "summary.json"), serializePillProfile(summary, environment), { flag: "wx", mode: 0o600 });
  return summary;
}

const md = (value: string | null) => (value ?? "미상").replace(/[\\`*_{}\[\]()#+.!|<>]/g, "\\$&").replace(/[\r\n]/g, " ");
export function pillSearchMarkdown(result: PillSearchResult, snapshot: PillCatalogSnapshot): string {
  const lines = ["# 로컬 알약 후보 검색 결과", "", result.notice, "", `상태: **${result.status}** — ${result.message}`,
    `카탈로그: ${snapshot.version}`, `검색 규칙: ${PILL_SEARCH_RULES_VERSION}`, `전체 수집 검증 시각: ${snapshot.verifiedAt}`, "",
    `전체 후보 ${result.metrics.candidateCount}개 중 ${result.metrics.returnedCount}개 표시${result.truncated ? " (나머지 후보 있음)" : ""}.`, "",
    "이 결과는 특징 입력 기반입니다. 사진 인식·복용 가능 판정이 아니며, 제공된 example 파일은 공식 필드로 만든 자기 일관성 점검용 입력입니다.", "",
    "| 검색 단계 | 잔여 레코드 |", "| --- | ---: |", ...result.metrics.stages.map((stage) => `| ${stage.stage} | ${stage.remaining} |`), ""];
  for (const candidate of result.candidates) {
    lines.push(`## ${md(candidate.variants[0]!.item.productName)} · ${candidate.itemSeq}`, "", `특징 비교: ${candidate.matchType} · 일치 외형 ${candidate.variants.length}개`, "");
    for (const variant of candidate.variants) {
      const item = variant.item;
      lines.push(`제조사: ${md(item.manufacturer)} / 제형: ${md(item.formName)} / 모양: ${md(item.shape)} / 색상: ${md(item.colors.join("·"))}`, "",
        `앞면 원문: ${md(item.front.rawImprint)} / 뒷면 원문: ${md(item.back.rawImprint)} / 비교 방향: ${variant.orientation}`, "",
        `공식 변경일: ${item.source.changedAt ?? "미상"} / 조회 시각: ${item.source.fetchedAt}`, "");
      if (item.imageUrl) lines.push(`[공식 이미지 열기](<${new URL(item.imageUrl).href.replace(/[<>]/g, (char) => encodeURIComponent(char))}>)`, "");
      lines.push("| 특징 | 입력 | 공식 정보 | 비교 |", "| --- | --- | --- | --- |",
        ...variant.evidence.map((entry) => `| ${md(entry.field)} | ${md(entry.observed)} | ${md(entry.official)} | ${entry.match} |`), "");
    }
  }
  return lines.join("\n");
}

function parseOptions(args: string[], allowed: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!;
    if (!allowed.includes(flag) || values.has(flag)) throw new Error("invalid_arguments");
    if (flag === "--live") { values.set(flag, "true"); continue; }
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error("invalid_arguments");
    values.set(flag, value);
  }
  return values;
}

async function main(args: string[]) {
  if (args.length === 1 && args[0] === "--help") { console.log(HELP); return; }
  if (args[0] === "collect") {
    const flags = parseOptions(args.slice(1), ["--live", "--max-requests"]);
    if (!flags.has("--live")) throw new Error("explicit_live_required");
    const result = await collectPillCatalogSnapshot({
      maxRequests: flags.has("--max-requests") ? Number(flags.get("--max-requests")) : 600,
      beforeRequest: () => delay(250),
      onProgress: (progress) => {
        if (progress.pageNo === 1 || progress.pageNo % 25 === 0 || progress.pageNo === progress.totalPages) {
          console.error(serializePillProfile({ status: "collecting", ...progress }));
        }
      },
    });
    if (result.status !== "collected") { console.log(serializePillProfile(result)); process.exitCode = 1; return; }
    const summary = await savePillSnapshot(result.snapshot, OUTPUT_DIRECTORY);
    console.log(serializePillProfile({ status: "saved", requests: result.requests, ...summary }));
    return;
  }
  if (args[0] === "search") {
    const flags = parseOptions(args.slice(1), ["--catalog", "--observation", "--max-age-hours", "--limit"]);
    if (!["--catalog", "--observation", "--max-age-hours"].every((name) => flags.has(name))) throw new Error("missing_arguments");
    const snapshot = validatePillCatalogSnapshot(await readBoundedJson(resolve(flags.get("--catalog")!), MAX_PILL_SNAPSHOT_BYTES));
    if (!snapshot.ok) throw new Error(snapshot.reason);
    const catalog = snapshotSearchCatalog(snapshot.snapshot, { now: new Date(), maxAgeHours: Number(flags.get("--max-age-hours")) });
    if (!catalog.ok) throw new Error(catalog.reason);
    const observation = await readBoundedJson(resolve(flags.get("--observation")!), 16 * 1024);
    const result = searchPillCandidates(observation, catalog.catalog, { limit: flags.has("--limit") ? Number(flags.get("--limit")) : 20 });
    await mkdir(OUTPUT_DIRECTORY, { recursive: true });
    const directory = await mkdtemp(join(OUTPUT_DIRECTORY, "search-"));
    const jsonPath = join(directory, "result.json");
    const reportPath = join(directory, "result.md");
    await writeFile(jsonPath, serializePillProfile({ ...result, searchRulesVersion: PILL_SEARCH_RULES_VERSION }), { flag: "wx", mode: 0o600 });
    // Redact before Markdown escaping too, so an escaped credential cannot bypass redaction.
    const safeResult = JSON.parse(serializePillProfile(result)) as PillSearchResult;
    await writeFile(reportPath, pillSearchMarkdown(safeResult, snapshot.snapshot), { flag: "wx", mode: 0o600 });
    console.log(serializePillProfile({ status: result.status, reason: result.reason, searchRulesVersion: PILL_SEARCH_RULES_VERSION, ...result.metrics, truncated: result.truncated, reportPath, jsonPath }));
    if (["invalid_input", "not_configured", "unavailable"].includes(result.status)) process.exitCode = 1;
    return;
  }
  throw new Error("invalid_command");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    // A raw error can contain credentials, local input, or an upstream response.
    const safeReasons = new Set(["explicit_live_required", "invalid_arguments", "missing_arguments", "invalid_command", "invalid_snapshot",
      "snapshot_integrity_failed", "invalid_freshness_policy", "snapshot_expired_or_future", "reflected_secret_rejected", "snapshot_size_exceeded",
      "invalid_file_size", "invalid_file_size_limit"]);
    const reason = error instanceof Error && safeReasons.has(error.message) ? error.message : "local_operation_failed";
    console.error(serializePillProfile({ status: "unavailable", reason }));
    console.error("Local pill catalog operation failed. Check arguments, file integrity/freshness and filesystem permissions. Raw errors are suppressed.\n" + HELP);
    process.exitCode = 1;
  });
}
