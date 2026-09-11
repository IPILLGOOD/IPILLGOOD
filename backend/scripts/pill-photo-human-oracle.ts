// Fixed saved-validation comparison. No API/env loading, inference or holdout interventions.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { loadFrozenPillPhotoFixture, readBoundedFixtureFile } from "../test-support/pill-photo-fixture.ts";
import { loadPillPhotoPhoneValidationFixture } from "../test-support/pill-photo-phone-validation.ts";
import { compareHumanOracleRuns } from "../test-support/pill-photo-human-oracle.ts";
import { comparePillPhotoFeatures, tracePillPhotoFeatures, pillPhotoFeaturesSchema } from "../src/pill-photo-features.ts";
import { readPillPhotoDiagnosticRuns } from "./pill-photo-diagnose.ts";
import { fingerprintAuditInputs } from "./pill-photo-audit-baseline.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUTPUT = join(ROOT, "verification-artifacts/pill-photo-audit");
const PRIOR = join(OUTPUT, "analysis-5AZ8aI/report.json");
const REVIEW = join(OUTPUT, "analysis-5AZ8aI/human-review.md");
const TRIAL = "verification-artifacts/pill-photo-trials/run-9EINEQ";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const check = (value: boolean, reason: string) => { if (!value) throw new Error(`human_oracle_${reason}`); };
const fingerprintSchema = z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
const priorSchema = z.object({
  schemaVersion: z.literal("pill-photo-failure-audit.v1"), currentHead: z.string(), currentCode: z.array(fingerprintSchema),
  baseline: fingerprintSchema.extend({ head: z.string() }), protectedInputs: z.array(fingerprintSchema),
  validation: z.object({ rows: z.array(z.object({ caseId: z.string(), repetition: z.number(), condition: z.string(),
    executed: z.boolean(), observation: pillPhotoFeaturesSchema.nullable(), diagnosis: z.unknown(),
  })) }),
});
async function readJson(path: string, max = 16 * 1024 * 1024) {
  const bytes = await readBoundedFixtureFile(path, max);
  return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown, sha256: hash(bytes) };
}

export async function runHumanOracle(readingsPath: string) {
  const inputPath = resolve(readingsPath);
  check(/^human-input-[a-zA-Z0-9-]+\/readings\.json$/.test(relative(OUTPUT, inputPath).replaceAll("\\", "/")), "invalid_input_location");
  let currentHead: string;
  try { currentHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", windowsHide: true }).trim(); }
  catch { throw new Error("human_oracle_git_unavailable"); }
  const priorFile = await readJson(PRIOR), prior = priorSchema.parse(priorFile.value);
  const inputFile = await readJson(inputPath, 128 * 1024);
  const reviewHash = hash(await readBoundedFixtureFile(REVIEW, 64 * 1024));
  const protectedInputs = await fingerprintAuditInputs();
  check(isDeepStrictEqual(protectedInputs, prior.protectedInputs), "protected_inputs_changed");
  // Do not adjust old behavior/calculation code to make an oracle succeed.
  for (const file of prior.currentCode) check(hash(await readBoundedFixtureFile(join(ROOT, file.path), 512 * 1024)) === file.sha256, "prior_calculation_code_changed");
  const codePaths = [...prior.currentCode.map(file => file.path), "backend/scripts/pill-photo-human-oracle.ts", "backend/test-support/pill-photo-human-oracle.ts"];
  const currentCode = await Promise.all(codePaths.map(async path => ({ path, sha256: hash(await readBoundedFixtureFile(join(ROOT, path), 512 * 1024)) })));
  const baselineFile = await readJson(join(ROOT, prior.baseline.path), 32 * 1024 * 1024);
  check(baselineFile.sha256 === prior.baseline.sha256, "old_baseline_modified");
  const baseline = z.object({ rows: z.array(z.object({ id: z.string(), features: pillPhotoFeaturesSchema, result: z.unknown() })).length(84) }).parse(baselineFile.value);
  const frozen = await loadFrozenPillPhotoFixture();
  for (const row of baseline.rows) {
    const plain = comparePillPhotoFeatures(row.features, frozen.catalog);
    check(isDeepStrictEqual(plain, row.result) && isDeepStrictEqual(plain, tracePillPhotoFeatures(row.features, frozen.catalog).comparison), "behavior_changed");
  }
  const validation = await loadPillPhotoPhoneValidationFixture();
  const saved = [];
  for (const repeat of [1, 2, 3]) {
    const id = `${TRIAL}/repeat-${repeat}`;
    const [source] = await readPillPhotoDiagnosticRuns([join(ROOT, id)]);
    saved.push({ id, value: source!.saved.features, hashes: source!.inputHashes });
  }
  const comparison = compareHumanOracleRuns(saved, inputFile.value, validation.manifest, frozen.catalog);
  check(comparison.rows.find(row => row.humanEvidence)?.humanEvidence?.source.reviewFileSha256 === reviewHash, "review_transcription_binding_mismatch");
  // Original + official conditions must reproduce the last audit exactly (same runs, not best-per-case).
  const unchangedRows = comparison.rows.filter(row => row.condition !== "human_strings_only");
  for (const row of unchangedRows) {
    const previous = prior.validation.rows.filter(old => old.caseId === row.caseId && old.repetition === row.repetition && old.condition === row.condition);
    check(previous.length === 1 && row.executed === previous[0]!.executed
      && isDeepStrictEqual(row.observation, previous[0]!.observation) && isDeepStrictEqual(row.diagnosis, previous[0]!.diagnosis), "paired_reference_changed");
  }
  check(isDeepStrictEqual(protectedInputs, await fingerprintAuditInputs()), "protected_inputs_changed_during_comparison");
  check((await readJson(PRIOR)).sha256 === priorFile.sha256 && (await readJson(inputPath, 128 * 1024)).sha256 === inputFile.sha256
    && hash(await readBoundedFixtureFile(REVIEW, 64 * 1024)) === reviewHash
    && (await readJson(join(ROOT, prior.baseline.path), 32 * 1024 * 1024)).sha256 === baselineFile.sha256, "evidence_modified");
  for (const file of currentCode) check(hash(await readBoundedFixtureFile(join(ROOT, file.path), 512 * 1024)) === file.sha256, "code_changed_during_comparison");
  const report = { schemaVersion: "pill-human-oracle-comparison.v1", createdAt: new Date().toISOString(), runtime: process.version,
    currentHead, currentCode,
    externalRequests: 0, newInference: false, blindEvaluationClaim: false, productionReadinessClaim: false,
    scope: "validation_only_final_features_strings_only", fixtureVersion: validation.manifest.fixtureVersion,
    catalogVersion: frozen.catalog.version, catalogSha256: frozen.manifest.catalog.sha256,
    sources: { priorAudit: { path: relative(ROOT, PRIOR), sha256: priorFile.sha256, currentHead: prior.currentHead },
      humanReadings: { path: relative(ROOT, inputPath), sha256: inputFile.sha256 }, review: { path: relative(ROOT, REVIEW), sha256: reviewHash },
      savedRuns: saved.map(row => ({ id: row.id, hashes: row.hashes })), beforeInstrumentationBaseline: prior.baseline },
    preservation: { publicOutputsEqual: 84, includingSavedCrossCombinations: 72, fusionRerun: false,
      previousOriginalAndOfficialRowsEqual: unchangedRows.length, oldCalculationFilesUnchanged: prior.currentCode.length,
      protectedInputFilesUnchanged: protectedInputs.length, protectedInputs,
      holdout: "No new holdout condition, oracle, inference or diagnosis. Old inputs are only included in integrity/baseline checks." },
    ...comparison,
    limitations: ["Counterfactual text replacement, not improved OCR performance or a new official pass.",
      "All six products use every repetition of one fixed baseline. Eighteen observations are six unique products, not eighteen independent samples.",
      "Text-free human surfaces, marks, partial/readable status and score-line notes are metadata only; original visibility/blank/quality/safety remain fixed.",
      "Human readings may be wrong or ambiguous; supplied notes are preserved without inventing alternatives or replacing text with official labels.",
      "v4-v05 is historical appearance; current official strings are not proof of what this photo shows. 6/5/1 summaries do not change the official minimum-six gate.",
      "No model/prompt/preprocessing/ranking change is implemented. A final improvement needs a new untouched evaluation set."],
  };
  await mkdir(OUTPUT, { recursive: true });
  const directory = await mkdtemp(join(OUTPUT, "human-comparison-"));
  await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
  await writeFile(join(directory, "report.md"), renderHumanOracleReport(report), { flag: "wx", mode: 0o600 });
  return { directory, groups: report.groups, coverage: report.humanCoverage, externalRequests: 0 };
}

const cell = (value: unknown) => String(value ?? "—").replaceAll("|", "\\|").replace(/[\r\n]+/g, " ").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
export function renderHumanOracleReport(report: ReturnType<typeof compareHumanOracleRuns>) {
  const lines = ["# 사람 판독 각인 오프라인 비교", "", "기존 validation 6제품 × 같은 run-9EINEQ 3회. 새 API 호출 0. 결합 후 문자열만 주입했으며 새 인식 성능/블라인드 평가/합격 판정이 아닙니다.", "",
    "## 확보·실행 범위", "", "```json", JSON.stringify(report.humanCoverage, null, 2), "```", "",
    "## 6제품 / 5제품 / 과거 외형 1제품", "", "| 조건 | 집계 | 고유 제품 | 관측 수 | 실행/계획 | @1 | @5 | @20 |", "|---|---|---|---|---|---|---|---|"];
  for (const condition of report.groups) for (const group of condition.groups) lines.push(`| ${condition.condition} | ${group.group} | ${group.independentProducts} | ${group.repeatedObservations} | ${group.executedObservations}/${group.repeatedObservations} | ${group.recall.map(metric => `${metric.hitsAmongExecuted}/${metric.plannedDenominator}${metric.rate === null ? " (조건 미완료: 비율 미산출)" : ""}`).join(" | ")} |`);
  lines.push("", "## 사례별 반환 순위 (회차 1 / 2 / 3)", "", "| 사례 | 기존 AI | 공식 문자열 | 사람 문자열 |", "|---|---|---|---|");
  for (const id of [...new Set(report.rows.map(row => row.caseId))]) lines.push(`| ${id} | ${["original", "official_strings_only", "human_strings_only"].map(condition => report.rows.filter(row => row.caseId === id && row.condition === condition).map(row => row.executed ? row.diagnosis?.expectedRank ?? `없음(전체 ${row.diagnosis?.candidateRankBeforeLimit ?? "없음"})` : `미실행:${row.reason}`).join(" / ")).join(" | ")} |`);
  lines.push("", "## 각 조건의 상세 처리 (현재 코드 재구성)", "", "| 사례/회차/조건 | 변경 필드 | 후보·보류 | 전체 후보→반환 | 전체 보류→반환 | 처리 사유 | 주요 경쟁 후보·비교 근거 |", "|---|---|---|---|---|---|---|");
  for (const row of report.rows) {
    const d = row.diagnosis;
    lines.push(`| ${row.caseId}/${row.repetition}/${row.condition} | ${cell(row.changedFields.map(f => `${f.path}: ${JSON.stringify(f.before)} → ${JSON.stringify(f.after)}`).join("; "))} | ${cell(d?.expectedMembership ?? "미실행")} | ${cell(d?.candidateRankBeforeLimit)} → ${cell(d?.expectedRank)} | ${cell(d?.heldRankBeforeLimit)} → ${cell(d?.returnedHeldRank)} | ${cell(d?.expectedDisposition ?? row.reason)} | ${cell(d?.competitors.map(c => `${c.itemSeq}: ${JSON.stringify(c.comparisonToExpectedBest)}`).join("; "))} |`);
  }
  lines.push("", "## 안전 지표", "", "```json", JSON.stringify(report.groups.map(g => ({ condition: g.condition, ...g.safety })), null, 2), "```", "",
    "## 해석 제한", "", "- 사람 상태/로고/분할선은 기록만 보존. 실제 문자열이 없는 면은 상태나 배열을 바꾸지 않았습니다.",
    "- 모든 순위와 경쟁 근거는 현재 재구성입니다. 공식 문자열은 정답에 가까운 반사실 입력이지 사진 판독 정답이 아닙니다.",
    "- 5제품·1제품 표는 보조 진단이며 최소 표본 gate를 완화하거나 전체 점수를 대체하지 않습니다.",
    "- 원래 관찰, 사람 원문/비고, 변경 필드, 미실행 사유, variant별 근거 및 코드·입력 해시는 같은 폴더 report.json에 있습니다.",
    "- holdout 개선 실험/새 모델 호출 없음. 최종 성능 확인에는 새로운 미사용 자료가 필요합니다.", "");
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length === 3 && process.argv[2] === "--help") console.log("Offline fixed validation comparison: --readings <ignored human-input-*/readings.json>. No API key/server/inference. Requires original local fixtures, run-9EINEQ, prior audit and pre-edit baseline. Writes a fresh ignored report. Exit 0 is not recognition success.");
  else if (process.argv.length !== 4 || process.argv[2] !== "--readings") { console.error("human_oracle_invalid_arguments"); process.exitCode = 1; }
  else {
    globalThis.fetch = async () => { throw new Error("human_oracle_network_forbidden"); };
    runHumanOracle(process.argv[3]!).then(result => console.log(JSON.stringify(result))).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : "";
      console.error(/^human_oracle_[a-z_]+$/.test(reason) ? reason : "human_oracle_local_input_missing_or_invalid"); process.exitCode = 1;
    });
  }
}
