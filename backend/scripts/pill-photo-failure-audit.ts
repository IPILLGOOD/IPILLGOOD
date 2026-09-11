// One bounded offline audit of the already-recorded v4/v5 runs. No API, env file, live flag or new inference.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { comparePillPhotoFeatures, tracePillPhotoFeatures, pillPhotoFeaturesSchema, type PillPhotoFeatures } from "../src/pill-photo-features.ts";
import { PILL_SEARCH_RULES_VERSION } from "../src/pill-identification.ts";
import { loadFrozenPillPhotoFixture, readBoundedFixtureFile } from "../test-support/pill-photo-fixture.ts";
import { loadPillPhotoPhoneValidationFixture, loadPillPhotoPhoneHoldoutFixture } from "../test-support/pill-photo-phone-validation.ts";
import { loadPillPhotoPhoneEvaluationRecord, fixtureIdentitySummary } from "../test-support/pill-photo-phone-evaluation-record.ts";
import { crossReplayPillPhotoSignals } from "../test-support/pill-photo-signal-cross.ts";
import { parsePillPhotoScoreInput, scorePillPhotoEvaluation, PILL_PHOTO_SCORE_POLICY_VERSION } from "../test-support/pill-photo-score.ts";
import { diagnosePillSearch, compareHistoricalPillRow } from "../test-support/pill-photo-search-diagnostics.ts";
import { createHumanReadingTemplate, injectOracleImprintStrings, officialOracleReadings, summarizeOracleGroups } from "../test-support/pill-photo-oracle.ts";
import { readPillPhotoDiagnosticRuns } from "./pill-photo-diagnose.ts";
import { fingerprintAuditInputs } from "./pill-photo-audit-baseline.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUTPUT = join(ROOT, "verification-artifacts/pill-photo-audit");
const BASE_TRIAL = "verification-artifacts/pill-photo-trials/run-9EINEQ";
const OTHER_TRIAL = "verification-artifacts/pill-photo-trials/run-Ao0hXp";
const HISTORY_RUN = "verification-artifacts/pill-photo-evaluation/run-zEpDgX";
const HISTORY_SCORE = "verification-artifacts/pill-photo-score/score-E06wJf/report.json";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const invariant = (ok: boolean, reason: string) => { if (!ok) throw new Error(`audit_${reason}`); };
const fileHash = z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
const baselineSchema = z.object({ schemaVersion: z.literal("pill-photo-behavior-baseline.v1"), createdAt: z.string(),
  head: z.string().regex(/^[a-f0-9]{40}$/), runtime: z.string(), externalRequests: z.literal(0),
  catalogVersion: z.string(), catalogSha256: z.string(), inputFiles: z.array(fileHash), code: z.array(fileHash),
  crossDirectory: z.string(), rows: z.array(z.object({ id: z.string(), scope: z.string(), features: pillPhotoFeaturesSchema, result: z.unknown() })).length(84) });
async function json(path: string, max = 8 * 1024 * 1024) {
  const bytes = await readBoundedFixtureFile(path, max);
  return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown, sha256: hash(bytes) };
}
const currentCodePaths = ["backend/src/pill-identification.ts", "backend/src/pill-photo-features.ts", "backend/src/pill-photo-failures.ts",
  "backend/src/pill-photo-ocr.ts", "backend/src/pill-photo-experiment.ts", "backend/src/pill-photo-pipeline.ts", "backend/src/pill-photo-preprocessing.ts",
  "backend/src/pill-photo-prompt-profiles.ts", "backend/test-support/pill-photo-score.ts", "backend/test-support/pill-photo-diagnostics.ts",
  "backend/test-support/pill-photo-search-diagnostics.ts", "backend/test-support/pill-photo-oracle.ts", "backend/test-support/pill-photo-signal-cross.ts",
  "backend/scripts/pill-photo-failure-audit.ts", "backend/scripts/pill-photo-audit-baseline.ts", "backend/scripts/pill-photo-diagnose.ts"];
const codeFingerprint = () => Promise.all(currentCodePaths.map(async path => ({ path,
  sha256: hash(await readBoundedFixtureFile(join(ROOT, path), 512 * 1024)) })));
const preservedBaselineIds = [1, 2, 3].flatMap(repeat => ["V0O0", "V1O0", "V0O1", "V1O1"].flatMap(cell =>
  Array.from({ length: 6 }, (_, index) => `${repeat}/${cell}/v4-v0${index + 1}`)));
interface OracleAuditRow {
  caseId: string; repetition: number; condition: string; sourceRun: string; sourceCreatedAt: string;
  pairedBaselineId: string; injectionPoint: string; historicalAppearance: boolean; executed: boolean; reason: string;
  originalObservation: PillPhotoFeatures | null; observation: PillPhotoFeatures | null;
  changedFields: ReturnType<typeof injectOracleImprintStrings>["changedFields"];
  attemptedChanges: ReturnType<typeof injectOracleImprintStrings>["attemptedChanges"];
  stateChanges: never[]; contractConflicts: ReturnType<typeof injectOracleImprintStrings>["contractConflicts"];
  unavailableOfficialSides: string[]; reference: ReturnType<typeof officialOracleReadings> | null;
  diagnosis: ReturnType<typeof diagnosePillSearch> | null; provenance: string;
}

export async function runPillFailureAudit(baselinePath: string) {
  const resolved = resolve(baselinePath), location = relative(OUTPUT, resolved).replaceAll("\\", "/");
  invariant(/^baseline-[a-zA-Z0-9]+\/baseline\.json$/.test(location), "baseline_location_invalid");
  const baselineFile = await json(resolved, 32 * 1024 * 1024), baseline = baselineSchema.parse(baselineFile.value);
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", windowsHide: true }).trim();
  const code = await codeFingerprint();
  const protectedInputs = await fingerprintAuditInputs();
  invariant(isDeepStrictEqual(protectedInputs, baseline.inputFiles), "protected_inputs_changed_before_replay");
  invariant(new Set(baseline.rows.map(row => row.id)).size === 84
    && preservedBaselineIds.every(id => baseline.rows.some(row => row.id === id)), "baseline_cases_invalid");
  const frozen = await loadFrozenPillPhotoFixture();
  invariant(frozen.catalog.version === baseline.catalogVersion && frozen.manifest.catalog.sha256 === baseline.catalogSha256, "catalog_changed");
  // Gate 1: SAME inputs/current before-edit baseline vs now. Stop before oracle or historical analysis on ANY public change.
  const behaviorRows = baseline.rows.map(row => {
    const plain = comparePillPhotoFeatures(row.features, frozen.catalog);
    const traced = tracePillPhotoFeatures(row.features, frozen.catalog);
    return { id: row.id, scope: row.scope, publicResultEqual: isDeepStrictEqual(plain, row.result),
      traceResultEqual: isDeepStrictEqual(traced.comparison, plain) };
  });
  invariant(behaviorRows.every(row => row.publicResultEqual && row.traceResultEqual), "unexpected_search_behavior_change");
  console.log(JSON.stringify({ stage: "behavior_preserved", rows: behaviorRows.length }));

  const validation = await loadPillPhotoPhoneValidationFixture();
  const v4Manifest = { ...validation.manifest, minimumCasesForPass: { validation: 6, holdout: 6 } };
  const pairs = [];
  for (const repeat of [1, 2, 3]) {
    const sources = await readPillPhotoDiagnosticRuns([join(ROOT, BASE_TRIAL, `repeat-${repeat}`), join(ROOT, OTHER_TRIAL, `repeat-${repeat}`)]);
    pairs.push({ baseline: sources[0]!.saved, candidate: sources[1]!.saved });
  }
  // This is a new before/after instrumentation audit, NOT the old code-bound cross CLI.
  // Its input fingerprints were frozen before edits. The original CLI's stronger code-binding guard remains intact.
  const cross = crossReplayPillPhotoSignals(pairs, validation.manifest, frozen.catalog);
  for (const repetition of cross.repetitions) for (const cell of repetition.cells) for (const row of cell.observations) {
    const saved = baseline.rows.find(saved => saved.id === `${repetition.repetition}/${cell.id}/${row.id}`)!;
    invariant(isDeepStrictEqual(saved.features, row.features), "fusion_behavior_changed");
  }
  console.log(JSON.stringify({ stage: "cross_fusion_preserved", combinations: 72 }));

  // One baseline for every case/repetition. All interventions are AFTER fusion and strings-only.
  const oracleRows: OracleAuditRow[] = [];
  const baselineScores = [];
  for (const [index, pair] of pairs.entries()) {
    const input = parsePillPhotoScoreInput(pair.baseline.features, v4Manifest, "validation");
    baselineScores.push(scorePillPhotoEvaluation(input, v4Manifest, frozen.catalog, "validation"));
    for (const row of input.cases) {
      const product = validation.manifest.products.find(product => product.id === row.id)!;
      const reference = officialOracleReadings(validation.manifest, row.id, frozen.catalog);
      const injection = row.extraction.status === "ok"
        ? injectOracleImprintStrings(row.extraction.features, reference.readings, "official_catalog") : null;
      for (const condition of ["original", "official_strings_only", "human_strings_only"] as const) {
        const features = row.extraction.status !== "ok" ? null : condition === "original" ? row.extraction.features
          : condition === "official_strings_only" ? injection?.features ?? null : null;
        oracleRows.push({ caseId: row.id, repetition: index + 1, condition,
          sourceRun: `${BASE_TRIAL}/repeat-${index + 1}`, sourceCreatedAt: input.createdAt,
          pairedBaselineId: `${index + 1}/original/${row.id}`, injectionPoint: "after_fusion_final_features",
          historicalAppearance: !!product.appearanceHistory, executed: features !== null,
          reason: row.extraction.status !== "ok" ? row.extraction.reason : condition === "human_strings_only" ? "no_verified_human_readings"
            : condition === "official_strings_only" ? injection!.status : "saved_final_features_fixed",
          originalObservation: row.extraction.status === "ok" ? row.extraction.features : null,
          observation: features, changedFields: condition === "official_strings_only" ? injection?.changedFields ?? [] : [],
          attemptedChanges: condition === "official_strings_only" ? injection?.attemptedChanges ?? [] : [],
          stateChanges: [], contractConflicts: condition === "official_strings_only" ? injection?.contractConflicts ?? [] : [],
          unavailableOfficialSides: condition === "official_strings_only" ? injection?.unavailableSides ?? [] : [],
          reference: condition === "official_strings_only" ? reference : null,
          diagnosis: features ? diagnosePillSearch(features, frozen.catalog, product.expectedItemSeq) : null,
          provenance: condition === "original" ? "saved_observation_current_search_reconstruction"
            : condition === "official_strings_only" ? "counterfactual_not_photo_accuracy" : "not_executed_missing_human_evidence" });
      }
    }
  }
  const oracleGroups = ["original", "official_strings_only", "human_strings_only"].map(condition => ({ condition,
    groups: summarizeOracleGroups(oracleRows.filter(row => row.condition === condition).map(row => ({
      caseId: row.caseId, repetition: row.repetition, condition, executed: row.executed, rank: row.diagnosis?.expectedRank ?? null,
    })), 3) }));
  console.log(JSON.stringify({ stage: "validation_oracle_completed", plannedRows: oracleRows.length,
    humanExecuted: 0, independentProducts: 6, repetitions: 3 }));

  // Historical v5 is NOT accepted by the validation-only diagnostic loader. Use only scorer + search pure functions.
  const holdout = await loadPillPhotoPhoneHoldoutFixture();
  const v5Manifest = { ...holdout.manifest, minimumCasesForPass: { validation: 6, holdout: 6 } };
  const historicalFeaturesFile = await json(join(ROOT, HISTORY_RUN, "features.json"));
  const historicalReportFile = await json(join(ROOT, HISTORY_SCORE));
  const historicalInput = parsePillPhotoScoreInput(historicalFeaturesFile.value, v5Manifest, "holdout");
  const historicalReport = z.object({ fixtureVersion: z.string(), split: z.literal("holdout"), createdAt: z.string(),
    policyVersion: z.string(), pipeline: z.unknown(), catalogVersion: z.string(), metrics: z.unknown(),
    rows: z.array(z.record(z.string(), z.unknown())).length(6) }).passthrough().parse(historicalReportFile.value);
  const ledger = await loadPillPhotoPhoneEvaluationRecord();
  const historicalLedger = ledger.runs.find(run => run.split === "holdout" && run.createdAt === historicalInput.createdAt);
  invariant(!!historicalLedger && historicalReport.fixtureVersion === historicalInput.fixtureVersion
    && historicalReport.createdAt === historicalInput.createdAt
    && isDeepStrictEqual(historicalReport.pipeline, historicalInput.pipeline)
    && historicalReport.catalogVersion === frozen.catalog.version, "historical_metadata_mismatch");
  const savedIdentity = ledger.fixtures.find(fixture => fixture.split === "holdout")!;
  invariant(isDeepStrictEqual(fixtureIdentitySummary(holdout.manifest), {
    imageSha256: savedIdentity.imageSha256, productIdentitySha256: savedIdentity.productIdentitySha256,
    officialRecordSha256: savedIdentity.officialRecordSha256,
  }), "historical_fixture_identity_mismatch");
  const currentScore = scorePillPhotoEvaluation(historicalInput, v5Manifest, frozen.catalog, "holdout");
  const historicalRows = [];
  for (const [index, row] of historicalInput.cases.entries()) {
    const rawFile = await json(join(ROOT, HISTORY_RUN, `case-${row.id}.json`));
    const raw = z.object({ id: z.string(), extraction: z.object({ ok: z.boolean(), features: pillPhotoFeaturesSchema.optional(),
      reason: z.string().optional(), signals: z.unknown().optional() }).passthrough() }).strict().parse(rawFile.value);
    invariant(raw.id === row.id && historicalReport.rows[index]!.id === row.id, "historical_case_mismatch");
    invariant(row.extraction.status === "ok" ? raw.extraction.ok && isDeepStrictEqual(raw.extraction.features, row.extraction.features)
      : !raw.extraction.ok && raw.extraction.reason === row.extraction.reason, "historical_saved_features_mismatch");
    const product = holdout.manifest.products.find(product => product.id === row.id)!;
    historicalRows.push({ caseId: row.id, sourceRun: HISTORY_RUN, condition: "historical_final_features_fixed_current_search",
      changedFields: [], finalObservation: row.extraction.status === "ok" ? row.extraction.features : null,
      A_stored: { provenance: "historical_stored_fact", reportRow: historicalReport.rows[index],
        savedStructuredSignals: raw.extraction.signals ?? null, rawCaseSha256: rawFile.sha256 },
      B_reconstructed: { provenance: "current_reconstruction", scoreRow: currentScore.rows[index],
        diagnosis: row.extraction.status === "ok" ? diagnosePillSearch(row.extraction.features, frozen.catalog, product.expectedItemSeq) : null },
      comparison: compareHistoricalPillRow(historicalReport.rows[index]!, { ...currentScore.rows[index]! }),
      C_unavailable: ["Original HTTP response envelopes", "Actual transmitted preprocessed image bytes/hashes/resolutions",
        "Per-rotation readings", "Historical internal pre-limit ranking and detailed rejection trace"],
      interpretation: "Fixed final features only. Saved signals are shown as historical facts, not re-fused or treated as HTTP originals. No physical cause is established." });
  }

  invariant(isDeepStrictEqual(protectedInputs, await fingerprintAuditInputs()), "protected_inputs_changed_during_audit");
  invariant(isDeepStrictEqual(code, await codeFingerprint()), "code_changed_during_audit");
  invariant((await json(resolved, 32 * 1024 * 1024)).sha256 === baselineFile.sha256, "baseline_modified");
  const report = { schemaVersion: "pill-photo-failure-audit.v1", createdAt: new Date().toISOString(),
    externalRequests: 0, newInference: false, productionReadinessClaim: false, blindEvaluationClaim: false,
    runtime: process.version, currentHead: head, currentCode: code, beforeInstrumentationCode: baseline.code,
    baseline: { path: relative(ROOT, resolved), sha256: baselineFile.sha256, head: baseline.head, createdAt: baseline.createdAt },
    protectedInputs, inputsUnchanged: true,
    behaviorPreservation: { compared: behaviorRows.length, publicResultsEqual: true, traceResultsEqual: true,
      savedCrossFeaturesEqual: 72, rows: behaviorRows,
      scope: "Before/after instrumentation, NOT historical-version comparison. Full public outputs include candidates, order, grades, variants, held pools, status and metrics." },
    intendedDiagnosticChanges: ["Trace the existing full search; remove the expected-only eligibility probe; report separate candidate/held ranks and membership.",
      "Diagnostic safety uses the scorer definition, including held exposure and nested retake status.",
      "All known extraction failures including invalid_request are accepted as failures; six-case denominator and official gates unchanged.",
      "Saved feature replay requires no API key; new inference requires key/approval. Immutable ledger wording retained as historical data."],
    validation: { fixtureVersion: v4Manifest.fixtureVersion, baselineTrial: BASE_TRIAL, pairedRepetitions: 3,
      baselineScores, groups: oracleGroups, rows: oracleRows, humanReadingEvidence: { availableCases: 0, reviewedSides: 0, executedRows: 0,
        status: "not_reviewed; not equivalent to reviewed_unreadable", template: "human-readings.template.json" },
      limits: ["All cases use all three repetitions of one fixed baseline; no best run per case.",
        "All interventions use the final merged observation, strings only. No visibility/no-imprint/quality/safety upgrades.",
        "Official oracle is not photo recognition performance. Contract-conflicting conditions are unexecuted, not repaired or excluded from planned counts.",
        "Historical v4-v05 official text is not the true reading of the photographed old appearance.",
        "6/5/1 are descriptive grouped diagnostics only; official minimum-six policy has not been relaxed."] },
    historicalV5: { mode: "posthoc_development_diagnostic_not_new_blind_evaluation", split: "holdout",
      sourceFeatures: { path: `${HISTORY_RUN}/features.json`, sha256: historicalFeaturesFile.sha256 },
      sourceReport: { path: HISTORY_SCORE, sha256: historicalReportFile.sha256 },
      A_stored: { report: historicalReportFile.value, recordedLedger: historicalLedger, originalCodeCommit: "not_recorded_in_bound_run",
        originalCodeFilesSha256: "not_recorded_in_bound_run", rawHttpResponses: "not_recorded", originalImageMetadata: holdout.manifest.images,
        originalImagesAreNotProofOfTransmittedImageBytes: true },
      B_reconstructed: { inputPolicy: "fixed_stored_final_features_no_refusion", scorePolicyVersion: PILL_PHOTO_SCORE_POLICY_VERSION,
        searchRulesVersion: PILL_SEARCH_RULES_VERSION, catalogVersion: frozen.catalog.version, catalogSha256: frozen.manifest.catalog.sha256,
        rows: currentScore.rows, metrics: currentScore.metrics, notAnOfficialNewPassDecision: true },
      rows: historicalRows, allSavedFieldsEqual: historicalRows.every(row => row.comparison.savedFieldsEqual),
      versionNotes: ["Historical capture-candidate-recall-v1 vs current minimum-sample v2 policy; six cases retained.",
        "Historical code commit is not attested by the saved run; the ledger supplies a rules version, not a complete code hash.",
        "Even if visible outputs agree, new internal ranks/reasons remain current reconstructions."],
      developmentUseRecorded: true,
      finalEvaluationRequirement: "This failure analysis informs development. A new untouched independently collected set is required for final claims.",
      forbiddenInterpretations: ["No v5 oracle or new improvement condition", "No claim of a new blind pass", "No definitive attribution to crop, lighting or hallucination"] },
    pending: ["Verified human photo-only readings with reviewer/time and per-side status", "A new untouched final-evaluation set after selecting an improvement"],
  };
  await mkdir(OUTPUT, { recursive: true });
  const directory = await mkdtemp(join(OUTPUT, "analysis-"));
  await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
  await writeFile(join(directory, "report.html"), renderFailureAudit(report), { flag: "wx", mode: 0o600 });
  await writeFile(join(directory, "human-readings.template.json"), JSON.stringify(createHumanReadingTemplate(validation.manifest), null, 2), { flag: "wx", mode: 0o600 });
  return { directory, behaviorRows: behaviorRows.length, protectedInputs: protectedInputs.length, validationGroups: oracleGroups,
    historicalSavedFieldsEqual: report.historicalV5.allSavedFieldsEqual, historicalCurrentMetrics: currentScore.metrics };
}

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export function renderFailureAudit(report: AuditRenderInput) {
  const rank = (value: number | null | undefined) => value ?? "없음";
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>실패 진단 · 오프라인</title><style>body{font:16px/1.6 system-ui;max-width:1250px;margin:2rem auto;padding:1rem;color:#173f38}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #b7c8c0;padding:.5rem;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{margin:1rem 0}</style><h1>알약 사진 실패 진단</h1><p>새 API 요청 0 · 인식 개선 적용 없음 · 새 블라인드 평가 아님 · 비공개 로컬 자료</p><h2>동작 보존</h2><p>전체 공개 응답 ${report.behaviorPreservation.compared}건 일치 · 저장 교차 조합 72건 결합 특징 일치 · 원본 ${report.protectedInputs.length}파일 변경 없음</p><h2>Validation 각인 문자열 오라클</h2><p>같은 run-9EINEQ 3회, 최종 결합 뒤 문자열만 변경. 사람 판독 조건은 자료 미확보로 미실행. v4-v05는 과거 외형이며 현재 공식 문자열을 실제 판독 정답으로 해석하지 않습니다.</p><pre>${escape(JSON.stringify(report.validation.groups, null, 2))}</pre><table><tr><th>사례/회차</th><th>조건</th><th>후보/보류</th><th>전체 후보 순위 → 반환</th><th>보류 전체 → 반환</th><th>처리 사유</th></tr>${report.validation.rows.map(row => `<tr><td>${escape(row.caseId)} / ${row.repetition}</td><td>${escape(row.condition)}</td><td>${escape(row.diagnosis?.expectedMembership ?? "미실행")}</td><td>${rank(row.diagnosis?.candidateRankBeforeLimit)} → ${rank(row.diagnosis?.expectedRank)}</td><td>${rank(row.diagnosis?.heldRankBeforeLimit)} → ${rank(row.diagnosis?.returnedHeldRank)}</td><td>${escape(row.diagnosis?.expectedDisposition ?? row.reason)}</td></tr>`).join("")}</table>${report.validation.rows.map(row => `<details><summary>${escape(row.caseId)} / ${row.repetition} / ${escape(row.condition)}: 관찰·주입·경쟁 근거</summary><pre>${escape(JSON.stringify(row, null, 2))}</pre></details>`).join("")}<h2>v5 역사적 결과와 현재 재구성</h2><p>당시 recall@1/5/20 = 2/6 원본 보존. 최종 특징 고정, 재결합·오라클 없음. 새 내부 순위는 모두 현재 재구성입니다.</p><table><tr><th>사례</th><th>A 당시 반환 순위</th><th>B 현재 전체 → 반환 순위</th><th>후보/보류</th><th>현재 처리 사유</th><th>기록 필드 일치</th></tr>${report.historicalV5.rows.map(row => `<tr><td>${escape(row.caseId)}</td><td>${escape(row.A_stored.reportRow?.expectedRank ?? "없음")}</td><td>${rank(row.B_reconstructed.diagnosis?.candidateRankBeforeLimit)} → ${rank(row.B_reconstructed.diagnosis?.expectedRank)}</td><td>${escape(row.B_reconstructed.diagnosis?.expectedMembership ?? "실패")}</td><td>${escape(row.B_reconstructed.diagnosis?.expectedDisposition ?? "추출 실패")}</td><td>${row.comparison.savedFieldsEqual}</td></tr>`).join("")}</table>${report.historicalV5.rows.map(row => `<details><summary>${escape(row.caseId)}: A 당시 사실 / B 현재 재구성 / C 확인 불가</summary><pre>${escape(JSON.stringify(row, null, 2))}</pre></details>`).join("")}<details><summary>버전·입력 해시·변경 의도·제약·미확보 자료</summary><pre>${escape(JSON.stringify({ currentHead: report.currentHead, currentCode: report.currentCode, baseline: report.baseline, protectedInputs: report.protectedInputs, intendedDiagnosticChanges: report.intendedDiagnosticChanges, pending: report.pending, history: { ...report.historicalV5, rows: undefined } }, null, 2))}</pre></details></html>`;
}
// Only the fields needed by the renderer; all additional JSON details remain in the actual report.
interface AuditRenderInput {
  behaviorPreservation: { compared: number }; protectedInputs: { path: string; sha256: string }[];
  validation: { groups: unknown; rows: { caseId: string; repetition: number; condition: string; reason: string;
    diagnosis: ReturnType<typeof diagnosePillSearch> | null }[] };
  historicalV5: { rows: { caseId: string; A_stored: { reportRow: Record<string, unknown> | undefined };
    B_reconstructed: { diagnosis: ReturnType<typeof diagnosePillSearch> | null }; comparison: { savedFieldsEqual: boolean } }[] };
  currentHead: string; currentCode: unknown; baseline: unknown; intendedDiagnosticChanges: string[]; pending: string[];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === "--help" && process.argv.length === 3) console.log("Offline fixed v4/v5 audit: --baseline <pre-edit baseline.json>. No API key/server/transfer. Requires private saved inputs. Writes a fresh ignored report; exit 0 means audit ran, not recognition passed.");
  else if (process.argv.length !== 4 || process.argv[2] !== "--baseline") { console.error("audit_invalid_arguments"); process.exitCode = 1; }
  else {
    globalThis.fetch = async () => { throw new Error("audit_network_forbidden"); };
    runPillFailureAudit(process.argv[3]!).then(result => console.log(JSON.stringify(result))).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      console.error(/^audit_[a-z_]+$/.test(message) ? message : "audit_local_input_missing_or_invalid"); process.exitCode = 1;
    });
  }
}
