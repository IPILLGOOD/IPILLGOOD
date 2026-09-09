// Explicit, validation-only local experiment. No user upload/API route or production default.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve, relative, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { prepareReviewedPillPhotoRequests } from "../src/pill-photo-experiment.ts";
import { comparePillPhotoFeatures, pillPhotoFeaturesSchema } from "../src/pill-photo-features.ts";
import { loadPillPhotoPhoneValidationFixture } from "../test-support/pill-photo-phone-validation.ts";
import { loadFrozenPillPhotoFixture, readBoundedFixtureFile } from "../test-support/pill-photo-fixture.ts";
import { diagnosePillPhotoValidation } from "../test-support/pill-photo-diagnostics.ts";
import { diagnosePillSearch } from "../test-support/pill-photo-search-diagnostics.ts";
import { summarizePillPhotoCaseScores, type PillPhotoCaseScore } from "../test-support/pill-photo-score.ts";
import { buildCandidateReviewPool } from "../test-support/pill-photo-candidate-pool.ts";
import { applyCandidateReview, buildCandidateReviewRequest, parseCandidateReviewResponse,
  CANDIDATE_REVIEW_PROTOCOL as PROTOCOL } from "../test-support/pill-photo-candidate-review.ts";
import { requestCandidateReview, CANDIDATE_REVIEW_MAX_REQUEST_BYTES,
  PILL_PHOTO_CANDIDATE_TRANSPORT_VERSION } from "../test-support/pill-photo-candidate-transport.ts";
import { trialSha256 as hash, PILL_PHOTO_TRIAL_CASE_IDS as IDS, PILL_PHOTO_TRIAL_PROTOCOL as BASE,
  assertCurrentPillPhotoTrialProtocol, describePillPhotoTrialPreparation } from "../test-support/pill-photo-trial.ts";
import { readPillPhotoDiagnosticRuns } from "./pill-photo-diagnose.ts";
import { fingerprintAuditInputs } from "./pill-photo-audit-baseline.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUTPUT = join(ROOT, "verification-artifacts/pill-photo-candidate-review");
const SOURCE = "verification-artifacts/pill-photo-trials/run-9EINEQ";
const BASELINE = "verification-artifacts/pill-photo-audit/baseline-zIf2Sd/baseline.json";
const BASELINE_HASH = "76602845d23400335199aafec211db8b877a8fc61450336a801e674d46dc3ffd";
const hashObject = (value: unknown) => hash(JSON.stringify(value));
const check = (ok: boolean, reason: string) => { if (!ok) throw Error(`candidate_review_${reason}`); };
const CODE = ["backend/scripts/pill-photo-candidate-review.ts", "backend/test-support/pill-photo-candidate-review.ts",
  "backend/test-support/pill-photo-candidate-pool.ts", "backend/test-support/pill-photo-candidate-transport.ts",
  "backend/src/pill-identification.ts", "backend/src/pill-photo-features.ts", "backend/src/pill-photo-ocr.ts",
  "backend/src/pill-photo-experiment.ts", "backend/src/pill-photo-preprocessing.ts", "backend/src/pill-form-policy.ts",
  "backend/src/official-pill-catalog.ts", "backend/test-support/pill-photo-score.ts",
  "backend/test-support/pill-photo-trial.ts", "backend/test-support/pill-photo-diagnostics.ts",
  "backend/test-support/pill-photo-search-diagnostics.ts", "backend/package.json", "package-lock.json"];
async function fingerprintCode() { return Promise.all(CODE.map(async path => ({ path, sha256: hash(await readBoundedFixtureFile(join(ROOT, path), 4 * 1024 * 1024)) })) ); }
async function readJson(path: string, max = 4 * 1024 * 1024) {
  const bytes = await readBoundedFixtureFile(path, max);
  return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown, sha256: hash(bytes) };
}
async function save(directory: string, name: string, value: unknown) { await writeFile(join(directory, name), JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 }); }

export function parseCandidateReviewArgs(args: string[]) {
  if (args.length === 1 && args[0] === "prepare") return { mode: "prepare" as const };
  if (args.length === 4 && args[0] === "run" && args[1] === "--plan" && args[3] === "--allow-validation-transfer") {
    const directory = resolve(ROOT, args[2]!);
    check(resolve(directory, "..") === resolve(OUTPUT) && /^plan-[a-zA-Z0-9_-]+$/.test(basename(directory)), "plan_path_invalid");
    return { mode: "run" as const, directory };
  }
  throw Error("candidate_review_invalid_arguments");
}

async function prepareData() {
  assertCurrentPillPhotoTrialProtocol();
  const protectedFiles = await fingerprintAuditInputs(), code = await fingerprintCode();
  const baselineFile = await readJson(join(ROOT, BASELINE), 32 * 1024 * 1024);
  check(baselineFile.sha256 === BASELINE_HASH, "baseline_changed");
  const baseline = z.object({ rows: z.array(z.object({ features: pillPhotoFeaturesSchema, result: z.unknown() })).length(84) }).parse(baselineFile.value);
  const frozen = await loadFrozenPillPhotoFixture(), validation = await loadPillPhotoPhoneValidationFixture();
  for (const row of baseline.rows) check(isDeepStrictEqual(comparePillPhotoFeatures(row.features, frozen.catalog), row.result), "search_behavior_changed");
  const historicalFile = await readJson(join(ROOT, SOURCE, "condition.json"));
  const historical = z.object({ protocol: z.unknown(), catalogSha256: z.string(), cases: z.array(z.object({ id: z.string(),
    sourceSha256: z.array(z.string()), preprocessing: z.unknown(), requests: z.array(z.object({ stage: z.string(), bodySha256: z.string(), images: z.unknown() })) })).length(6) }).parse(historicalFile.value);
  check(isDeepStrictEqual(historical.protocol, BASE) && historical.catalogSha256 === frozen.manifest.catalog.sha256, "historical_settings_changed");
  check(isDeepStrictEqual(validation.manifest.cases.map(c => c.id), IDS), "six_validation_cases_required");
  const prepared = new Map<string, Extract<Awaited<ReturnType<typeof prepareReviewedPillPhotoRequests>>, { ok: true }>>();
  const descriptions = [];
  const images = new Map<string, Buffer>();
  for (const entry of validation.inferenceInputs) {
    const photos = await Promise.all(entry.photos.map(path => readBoundedFixtureFile(path, 5 * 1024 * 1024))) as [Buffer, Buffer];
    const value = await prepareReviewedPillPhotoRequests(photos, { photoSet: "phone_validation", model: BASE.model, ocrModel: BASE.ocrModel, visionPromptVersion: BASE.visionPrompt });
    if (!value.ok) throw Error("candidate_review_image_preparation_failed");
    const description = await describePillPhotoTrialPreparation(value), old = historical.cases.find(c => c.id === entry.id)!;
    check(isDeepStrictEqual(old.sourceSha256, value.sourceSha256) && isDeepStrictEqual(old.preprocessing, value.preprocessing)
      && description.manifest.requests.every((r, i) => r.bodySha256 === old.requests[i]?.bodySha256 && isDeepStrictEqual(r.images, old.requests[i]?.images)), "historical_request_changed");
    prepared.set(entry.id, value); descriptions.push({ id: entry.id, ...description.manifest });
    for (const [sha256, bytes] of description.images) images.set(sha256, bytes);
  }
  const tasks = [], runs = [];
  for (const repetition of [1, 2, 3]) {
    const sourceRun = `${SOURCE}/repeat-${repetition}`, [loaded] = await readPillPhotoDiagnosticRuns([join(ROOT, sourceRun)]);
    const diagnosis = diagnosePillPhotoValidation(loaded!.saved, validation.manifest, frozen.catalog);
    check(isDeepStrictEqual(diagnosis.rows.map(r => r.id), IDS) && diagnosis.rows.every(r => r.signalStatus === "verified"), "verified_source_required");
    check(isDeepStrictEqual(diagnosis.pipeline, { mode: "vision_ocr", preprocessingVersion: BASE.preprocessing,
      visionVersion: BASE.visionPrompt, model: BASE.model, ocrModel: BASE.ocrModel, ocrVersion: BASE.ocrPrompt, fusionVersion: BASE.fusion }), "source_pipeline_changed");
    runs.push({ sourceRun, hashes: loaded!.inputHashes, pipeline: diagnosis.pipeline });
    for (const row of diagnosis.rows) {
      const original = row.observedPhotoFeatures?.fused;
      check(!!original, "source_features_missing");
      const pool = buildCandidateReviewPool(original, frozen.catalog);
      const request = pool.status === "ready" ? buildCandidateReviewRequest(prepared.get(row.id)!, original!, pool) : null;
      tasks.push({ caseId: row.id, repetition, sourceRun, original: original!, pool, request });
    }
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", windowsHide: true }).trim();
  const condition = { protocol: PROTOCOL, head, code, runtime: process.version,
    transportVersion: PILL_PHOTO_CANDIDATE_TRANSPORT_VERSION, maxRequestBytes: CANDIDATE_REVIEW_MAX_REQUEST_BYTES,
    catalogSha256: frozen.manifest.catalog.sha256,
    catalogVersion: frozen.catalog.version, fixtureSha256: hashObject(validation.manifest), baselineSha256: baselineFile.sha256,
    historicalConditionSha256: historicalFile.sha256, protectedFiles, runs, descriptions,
    tasks: tasks.map(t => ({ caseId: t.caseId, repetition: t.repetition, sourceRun: t.sourceRun, originalSha256: hashObject(t.original),
      poolStatus: t.pool.status, poolReason: t.pool.reason, eligibleProductCount: t.pool.eligibleProductCount,
      poolTruncated: t.pool.truncated, cards: t.pool.cards, bindings: t.pool.bindings,
      requestBytes: t.request?.requestBytes ?? null,
      bodySha256: t.request?.bodySha256 ?? null, imageSha256: t.request?.imageSha256 ?? [] })) };
  async function verifyUnchanged() {
    check(isDeepStrictEqual(protectedFiles, await fingerprintAuditInputs()), "protected_inputs_changed");
    check(isDeepStrictEqual(code, await fingerprintCode()), "code_changed");
    for (const row of baseline.rows) check(isDeepStrictEqual(comparePillPhotoFeatures(row.features, frozen.catalog), row.result), "search_behavior_changed");
    check((await readJson(join(ROOT, SOURCE, "condition.json"))).sha256 === historicalFile.sha256, "historical_settings_changed");
  }
  await verifyUnchanged();
  return { tasks, condition, images, validation, frozen, verifyUnchanged };
}

export async function prepareCandidateReview() {
  const data = await prepareData();
  await mkdir(OUTPUT, { recursive: true });
  const directory = await mkdtemp(join(OUTPUT, "plan-"));
  await mkdir(join(directory, "images"));
  for (const [sha256, bytes] of data.images) await writeFile(join(directory, "images", `${sha256}.png`), bytes, { flag: "wx", mode: 0o600 });
  await save(directory, "plan.json", { schemaVersion: "pill-candidate-review-plan.v1", createdAt: new Date().toISOString(),
    conditionSha256: hashObject(data.condition), condition: data.condition });
  // Private post-search audit; these expected identities are never present in request bodies.
  await save(directory, "coverage.json", data.tasks.map(t => {
    const expected = data.validation.manifest.products.find(p => p.id === t.caseId)!.expectedItemSeq;
    return { caseId: t.caseId, repetition: t.repetition, expectedInReviewPool: t.pool.bindings.some(b => b.itemSeq === expected),
      baseline: diagnosePillSearch(t.original, data.frozen.catalog, expected) };
  }));
  await data.verifyUnchanged();
  return { status: "prepared", directory: relative(ROOT, directory), planned: 18,
    eligibleRequests: data.tasks.filter(t => t.request).length,
    largestRequestBytes: Math.max(...data.tasks.map(t => t.request?.requestBytes ?? 0)),
    maxRequestBytes: CANDIDATE_REVIEW_MAX_REQUEST_BYTES, externalRequests: 0 };
}

type Diagnosis = ReturnType<typeof diagnosePillSearch>;
function scoreRow(id: string, expectedItemSeq: string, diagnosis: Diagnosis | null,
  outcome: "ok" | "failed" | "abstained", reason: string | null): PillPhotoCaseScore {
  return { id, expectedItemSeq, extractionStatus: outcome === "failed" ? "failed" : "ok", failureReason: outcome === "failed" ? reason : null,
    comparisonStatus: diagnosis?.comparisonStatus ?? (outcome === "abstained" ? "review_abstained" : null),
    comparisonReason: diagnosis?.comparisonReason ?? reason, searchStatus: diagnosis?.searchStatus ?? null,
    expectedRank: diagnosis?.expectedRank ?? null, expectedHeld: diagnosis?.expectedHeld ?? false,
    candidateItemSeqs: diagnosis?.safety.candidateItemSeqs ?? [], heldCandidateItemSeqs: diagnosis?.safety.heldCandidateItemSeqs ?? [],
    strongCandidateItemSeqs: diagnosis?.safety.strongCandidateItemSeqs ?? [],
    strongWrongCandidateItemSeqs: diagnosis?.safety.strongCandidateItemSeqs.filter(s => s !== expectedItemSeq) ?? [],
    needsRetake: diagnosis?.safety.needsRetake ?? reason === "needs_retake" };
}

export async function runCandidateReview(directory: string) {
  const planFile = await readJson(join(directory, "plan.json"), 32 * 1024 * 1024);
  const plan = z.object({ schemaVersion: z.literal("pill-candidate-review-plan.v1"), conditionSha256: z.string(), condition: z.unknown() }).parse(planFile.value);
  const data = await prepareData();
  check(hashObject(plan.condition) === plan.conditionSha256 && isDeepStrictEqual(plan.condition, data.condition), "plan_changed");
  for (const [sha256, bytes] of data.images) check(hash(await readBoundedFixtureFile(join(directory, "images", `${sha256}.png`), 5 * 1024 * 1024)) === hash(bytes), "plan_image_changed");
  // Key loading occurs only after explicit CLI authorization and every binding check. Never logged.
  if (!process.env.OPENAI_API_KEY) process.loadEnvFile(join(ROOT, "front/.env.local"));
  const key = process.env.OPENAI_API_KEY?.trim();
  check(!!key, "key_missing");
  const runDirectory = await mkdtemp(join(OUTPUT, "run-"));
  const startedAt = new Date().toISOString();
  await save(runDirectory, "condition.json", { planDirectory: relative(ROOT, directory), planSha256: planFile.sha256, condition: data.condition,
    authorizedScope: "v4-validation-12-preprocessed-photos-only", startedAt, maximumRequests: 18, concurrency: 2, retries: 0 });
  let attempts = 0, requests = 0;
  const rows: Array<Record<string, unknown> & { caseId: string; repetition: number; baselineScore: PillPhotoCaseScore; reviewedScore: PillPhotoCaseScore }> = [];
  async function execute(index: number) {
    const task = data.tasks[index]!, id = `${task.caseId}-r${task.repetition}`;
    const expected = data.validation.manifest.products.find(p => p.id === task.caseId)!.expectedItemSeq;
    const baselineDiagnosis = diagnosePillSearch(task.original, data.frozen.catalog, expected);
    const baselineScore = scoreRow(id, expected, baselineDiagnosis, "ok", null);
    let reviewedDiagnosis: Diagnosis | null = null;
    let outcome: "ok" | "failed" | "abstained" = "ok", reason: string | null = null;
    let application: ReturnType<typeof applyCandidateReview> | null = null;
    let parsed: ReturnType<typeof parseCandidateReviewResponse> | null = null;
    let transport: Omit<Awaited<ReturnType<typeof requestCandidateReview>>, "rawText"> | null = null;
    if (!task.request) { reviewedDiagnosis = baselineDiagnosis; reason = task.pool.reason; }
    else {
      check(attempts < PROTOCOL.maximumRequests && hashObject(task.request.body) === task.request.bodySha256, "request_guard_failed");
      attempts++;
      await save(runDirectory, `started-${id}.json`, { id, index, startedAt: new Date().toISOString(), requestSha256: task.request.bodySha256,
        imageSha256: task.request.imageSha256, requestBytes: task.request.requestBytes,
        candidateRefs: task.pool.cards.map(c => c.ref) });
      const result = await requestCandidateReview(task.request.body, key!);
      if (result.trace.dispatched) requests++;
      const { rawText, ...rest } = result; transport = rest;
      if (rawText !== null) await writeFile(join(runDirectory, `response-${id}.json`), rawText, { flag: "wx", mode: 0o600 });
      if (!result.ok) { outcome = "failed"; reason = result.reason; }
      else {
        parsed = parseCandidateReviewResponse(result.value, task.pool);
        if (!parsed.ok) { outcome = "failed"; reason = parsed.reason; }
        else {
          application = applyCandidateReview(task.original, task.pool, parsed.review);
          reason = application.reason;
          if (application.features) reviewedDiagnosis = diagnosePillSearch(application.features, data.frozen.catalog, expected);
          else outcome = "abstained";
        }
      }
    }
    const row = { caseId: task.caseId, repetition: task.repetition, sourceRun: task.sourceRun,
      original: task.original, sourceProvenance: "stored_fused_features",
      responseProvenance: !task.request ? "not_requested_original_safety_gate"
        : transport?.trace.dispatched ? "new_candidate_conditioned_inference_attempt"
          : "not_dispatched_local_transport_rejection",
      poolBindings: task.pool.bindings, expectedInReviewPool: task.pool.bindings.some(b => b.itemSeq === expected),
      requestSha256: task.request?.bodySha256 ?? null, transport, parsed, application, outcome, reason,
      baselineDiagnosis, reviewedDiagnosis, baselineScore, reviewedScore: scoreRow(id, expected, reviewedDiagnosis, outcome, reason) };
    await save(runDirectory, `case-${id}.json`, row);
    rows.push(row);
    console.log(JSON.stringify({ caseId: task.caseId, repetition: task.repetition, outcome, reason,
      before: baselineScore.expectedRank, after: row.reviewedScore.expectedRank, attemptedReviews: attempts, requests }));
  }
  // At most two independent cases in flight; schedule and planned denominator are fixed, no reruns/cherry-picking.
  for (let i = 0; i < data.tasks.length; i += 2) await Promise.all([execute(i), ...(i + 1 < data.tasks.length ? [execute(i + 1)] : [])]);
  rows.sort((a, b) => a.repetition - b.repetition || a.caseId.localeCompare(b.caseId));
  check(rows.length === 18, "incomplete_run");
  await data.verifyUnchanged();
  const summaries = ["all_six", "without_historical_v05", "historical_v05_only"].flatMap(group => {
    const selected = rows.filter(r => group === "all_six" || (r.caseId === "v4-v05") === (group === "historical_v05_only"));
    return (["baselineScore", "reviewedScore"] as const).map(condition => ({ group, condition,
      uniqueProducts: new Set(selected.map(r => r.caseId)).size, repeatedObservations: selected.length,
      metrics: summarizePillPhotoCaseScores(selected.map(r => r[condition])), officialPassDecision: null }));
  });
  const report = { schemaVersion: "pill-candidate-review-report.v2", startedAt, finishedAt: new Date().toISOString(),
    condition: data.condition, attemptedReviews: attempts, requests, summaries, rows, officialPassDecision: null,
    preservation: { baselineComparisons: 84, storedCrossCombinations: 72, protectedFiles: data.condition.protectedFiles.length },
    limitations: ["Additional candidate-conditioned pass on historical frozen first-pass observations, not new end-to-end/blind evaluation.",
      "Candidate references can bias transcription; these are not independent OCR confirmations. Changed readings never upgrade visibility to clear.",
      "Original global image/pair safety and search rules unchanged. Candidate checks are diagnostics, not product rankings.",
      "50-product/100-variant bound chosen for this validation development experiment; missing candidates cannot be recovered by shortlist-only recognition.",
      "All failures and abstentions remain in the 18-observation denominator. Six unique products, not eighteen.",
      "requests counts fetch dispatch attempts, not local validation failures or proof of provider receipt/billing; attemptedReviews includes local rejects.",
      "Small normal-photo set cannot establish logo/unreadable/unsafe-photo safety. No v5 tuning or new blind-performance claim.",
      "5/1 subgroups do not replace official six-product gates; official acceptance is not decided here."] };
  await save(runDirectory, "report.json", report);
  const lines = ["# 공식 후보 참고 사진 재판독", "", "저장 1차 관찰 고정 + 새 2차 요청. 새 블라인드 평가/운영 승인 아님.", "",
    "| 범위 | 조건 | 제품/관측 | @1 | @5 | @20 | 강한 오답 | 재촬영 노출 |", "|---|---|---|---|---|---|---|---|"];
  for (const s of summaries) lines.push(`| ${s.group} | ${s.condition} | ${s.uniqueProducts}/${s.repeatedObservations} | ${["1","5","20"].map(k => `${s.metrics.recallAt[k]!.hits}/${s.metrics.totalCases}`).join(" | ")} | ${s.metrics.strongWrongCandidateCount} | ${s.metrics.retakeCandidateExposureCaseCount} |`);
  lines.push("", "| 사례/회차 | 원래→재판독 순위 | 상태 |", "|---|---|---|");
  for (const r of rows) lines.push(`| ${r.caseId}/${r.repetition} | ${r.baselineScore.expectedRank ?? "—"}→${r.reviewedScore.expectedRank ?? "—"} | ${r.outcome}: ${r.reason} |`);
  lines.push("", ...report.limitations.map(s => `- ${s}`), "");
  await writeFile(join(runDirectory, "report.md"), lines.join("\n"), { flag: "wx", mode: 0o600 });
  return { status: "completed", directory: relative(ROOT, runDirectory), attemptedReviews: attempts, requests, summaries, officialPassDecision: null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length === 3 && process.argv[2] === "--help") console.log("prepare (offline); run --plan <generated plan directory> --allow-validation-transfer (at most 18 new API requests, v4 validation only). No holdout/arbitrary model/photo paths. Exit 0 means completed experiment, NOT accuracy acceptance.");
  else Promise.resolve().then(async () => { const args = parseCandidateReviewArgs(process.argv.slice(2));
    return args.mode === "prepare" ? await prepareCandidateReview() : await runCandidateReview(args.directory); })
    .then(result => console.log(JSON.stringify(result))).catch(() => { console.error("candidate_review_stopped_inspect_private_logs_no_automatic_retry"); process.exitCode = 1; });
}
