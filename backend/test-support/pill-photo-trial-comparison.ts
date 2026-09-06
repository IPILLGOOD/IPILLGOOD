// Offline comparison of the two fixed v4 trials. No files, labels, images or providers are loaded here.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { PILL_PHOTO_INSTRUCTIONS } from "../src/pill-photo-features.ts";
import { PILL_PHOTO_STRUCTURED_INSTRUCTIONS } from "../src/pill-photo-prompt-profiles.ts";
import { PILL_PHOTO_TRIAL_PROTOCOL } from "./pill-photo-trial.ts";

const CASE_IDS = Array.from({ length: 6 }, (_, index) => `v4-v0${index + 1}`);
const STAGES = ["vision", "ocrFront", "ocrBack"] as const;
const KS = [1, 5, 20] as const;
const CANDIDATE_ID = "validation-structured-observation-v1";
const CANDIDATE_PROMPT = "pill-photo-observation-v4-structured-surfaces";
const REQUIRED_CODE = [
  "backend/src/pill-photo-experiment.ts", "backend/src/pill-photo-features.ts", "backend/src/pill-photo-ocr.ts",
  "backend/src/pill-photo-preprocessing.ts", "backend/src/pill-identification.ts", "backend/src/pill-form-policy.ts",
  "backend/src/official-pill-catalog.ts", "backend/src/pill-catalog-snapshot.ts", "backend/test-support/pill-photo-score.ts",
  "backend/test-support/pill-photo-phone-validation.ts", "backend/test-support/pill-photo-fixture.ts",
  "backend/test-support/pill-photo-evaluation-registry.ts", "backend/test-support/pill-photo-trial.ts",
  "backend/scripts/pill-photo-trial.ts", "package-lock.json",
];
const PROMPT_CODE = "backend/src/pill-photo-prompt-profiles.ts";
const CHANGEABLE_CODE = new Set([
  "backend/src/pill-photo-experiment.ts", "backend/test-support/pill-photo-trial.ts",
  "backend/scripts/pill-photo-trial.ts", PROMPT_CODE,
]);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const fail = (reason: string): never => { throw new Error(`trial_comparison_${reason}`); };
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const tag = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/).refine((value) => !/^sk-/i.test(value));
const dimension = z.number().int().positive().max(25_000_000);
const imageSchema = z.object({
  index: z.number().int().min(0).max(7), sha256: hash,
  path: z.string().regex(/^images\/[a-f0-9]{64}\.png$/), bytes: z.number().int().positive().max(8 * 1024 * 1024),
  width: dimension, height: dimension, detail: z.literal("high"),
}).strict();
const variantSchema = z.object({ width: dimension, height: dimension, channels: z.union([z.literal(1), z.literal(3)]), sha256: hash }).strict();
const preprocessingSchema = z.object({
  version: z.literal("pill-phone-centered-detail-contrast-v1"),
  source: z.object({ width: dimension, height: dimension, format: z.literal("jpeg") }).strict(),
  crop: z.object({ method: z.literal("centered_square_ratio"), ratio: z.literal(0.4),
    bounds: z.object({ left: z.number().int().nonnegative(), top: z.number().int().nonnegative(), width: dimension, height: dimension }).strict(),
  }).strict(),
  orientation: z.object({ method: z.literal("cardinal_ocr_views_only"),
    textOrientationDegreesToEvaluate: z.tuple([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  }).strict(),
  variants: z.object({ context: variantSchema, alignedColor: variantSchema, alignedContrast: variantSchema }).strict(),
}).strict();
const requestSchema = z.object({
  stage: z.enum(STAGES), bodySha256: hash, instructionsSha256: hash, schemaSha256: hash,
  images: z.array(imageSchema).min(4).max(8),
  requestDescription: z.object({
    model: z.literal("gpt-5.6-sol"), store: z.literal(false),
    max_output_tokens: z.union([z.literal(2400), z.literal(1400)]),
    reasoning: z.object({ effort: z.literal("low") }).strict(), instructions: z.string().min(1).max(32 * 1024),
    input: z.tuple([z.object({ role: z.literal("user"), content: z.array(z.discriminatedUnion("type", [
      z.object({ type: z.literal("input_text"), text: z.string().min(1).max(1024) }).strict(),
      imageSchema.extend({ type: z.literal("input_image") }).strict(),
    ])).min(6).max(10) }).strict()]),
    text: z.object({ format: z.object({ type: z.literal("json_schema"),
      name: z.enum(["pill_visible_features", "pill_imprint_ocr_side"]), strict: z.literal(true),
      schema: z.record(z.string().max(200), z.json()),
    }).strict() }).strict(),
  }).strict(),
}).strict();
const conditionSchema = z.object({
  schemaVersion: z.literal("pill-photo-trial-condition.v1"), protocol: z.record(z.string().max(100), z.json()),
  runtime: z.object({ node: tag, platform: tag, arch: tag, sharp: z.record(z.string().max(100), z.string().max(200)) }).strict(),
  code: z.array(z.object({ path: z.string().max(200), sha256: hash }).strict()).min(REQUIRED_CODE.length).max(REQUIRED_CODE.length + 1),
  fixtureVersion: z.literal("pill-photo-phone-validation-local-2026-09-02-v4"), fixtureContentSha256: hash,
  catalogVersion: tag, catalogSha256: hash,
  cases: z.array(z.object({ id: z.string().regex(/^v4-v0[1-6]$/), sourceSha256: z.tuple([hash, hash]),
    preprocessing: z.tuple([preprocessingSchema, preprocessingSchema]), requests: z.array(requestSchema).length(3),
  }).strict()).length(6),
}).strict();
const itemIds = z.array(tag).max(20).refine((values) => new Set(values).size === values.length);
const rank = z.number().int().min(1).max(20).nullable();
const rowSchema = z.object({
  id: z.string().regex(/^v4-v0[1-6]$/), expectedItemSeq: tag, extractionStatus: z.literal("ok"), failureReason: z.null(),
  comparisonStatus: tag, comparisonReason: tag, searchStatus: tag.nullable(), expectedRank: rank,
  expectedHeld: z.boolean(), candidateItemSeqs: itemIds, heldCandidateItemSeqs: itemIds,
  strongCandidateItemSeqs: itemIds, strongWrongCandidateItemSeqs: itemIds, needsRetake: z.boolean(),
}).strict();
const hits = z.number().int().min(0).max(6);
const safetySchema = z.object({ repetition: z.number().int().min(1).max(3),
  strongWrongCandidates: z.number().int().min(0).max(120), retakeCandidateExposureCases: hits,
}).strict();
const summarySchema = z.object({
  status: z.literal("complete"), conditionSha256: hash, requestIntents: z.literal(54),
  responseModels: z.array(z.object({ stage: z.enum(STAGES), value: tag.nullable() }).strict()).length(54),
  completedRepetitions: z.literal(3), productionReadinessClaim: z.literal(false),
  comparison: z.object({
    independentProducts: z.literal(6), repeatedEvaluations: z.literal(18), allRepetitionsPassed: z.boolean(),
    providerDeterminismClaim: z.literal(false), safetyByRepetition: z.array(safetySchema).length(3),
    recall: z.array(z.object({ k: z.union([z.literal(1), z.literal(5), z.literal(20)]),
      hitsByRepetition: z.tuple([hits, hits, hits]), denominatorPerRepetition: z.literal(6), minHits: hits, maxHits: hits,
    }).strict()).length(3),
    rows: z.array(z.object({ id: z.string().regex(/^v4-v0[1-6]$/), ranks: z.tuple([rank, rank, rank]),
      changed: z.boolean(), results: z.array(rowSchema).length(3),
    }).strict()).length(6),
  }).strict(),
}).strict();
type Condition = z.infer<typeof conditionSchema>;
type Row = z.infer<typeof rowSchema>;

function boundedJson(value: unknown, maximum: number): string {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string" || Buffer.byteLength(serialized) > maximum) return fail("input_too_large_or_invalid");
    return serialized;
  } catch { return fail("input_too_large_or_invalid"); }
}
const exposure = (row: Row) => Number(row.needsRetake && row.candidateItemSeqs.length + row.heldCandidateItemSeqs.length > 0);
function verifyRequests(condition: Condition, candidate: boolean) {
  for (const entry of condition.cases) for (const [index, request] of entry.requests.entries()) {
    const vision = index === 0;
    const body = request.requestDescription;
    const placements = body.input[0].content.flatMap((part) => {
      if (part.type !== "input_image") return [];
      return [{ index: part.index, sha256: part.sha256, path: part.path, bytes: part.bytes,
        width: part.width, height: part.height, detail: part.detail }];
    });
    if (request.stage !== STAGES[index] || request.images.length !== (vision ? 4 : 8)
      || body.max_output_tokens !== (vision ? 2400 : 1400)
      || body.text.format.name !== (vision ? "pill_visible_features" : "pill_imprint_ocr_side")
      || body.input[0].content.length !== request.images.length + 2
      || !isDeepStrictEqual(placements, request.images)
      || placements.some((image, slot) => image.index !== slot || image.path !== `images/${image.sha256}.png`)
      || request.instructionsSha256 !== sha256(body.instructions)
      || request.schemaSha256 !== sha256(JSON.stringify(body.text.format))) return fail("request_fingerprint_mismatch");
    if (vision && body.instructions !== (candidate ? PILL_PHOTO_STRUCTURED_INSTRUCTIONS : PILL_PHOTO_INSTRUCTIONS)) {
      return fail("unexpected_vision_instructions");
    }
  }
}

function parseCondition(value: unknown, candidate: boolean) {
  const conditionJson = boundedJson(value, 2 * 1024 * 1024);
  const conditionResult = conditionSchema.safeParse(value);
  if (!conditionResult.success) return fail("invalid_condition");
  const condition = conditionResult.data;
  const protocol = candidate ? { ...PILL_PHOTO_TRIAL_PROTOCOL, id: CANDIDATE_ID, visionPrompt: CANDIDATE_PROMPT } : PILL_PHOTO_TRIAL_PROTOCOL;
  if (!isDeepStrictEqual(condition.protocol, protocol)) return fail("unexpected_protocol");
  if (!isDeepStrictEqual(condition.cases.map((entry) => entry.id), CASE_IDS)
    || new Set(condition.cases.flatMap((entry) => entry.sourceSha256)).size !== 12) return fail("case_or_request_order_mismatch");
  const paths = new Set(condition.code.map((file) => file.path));
  if (paths.size !== condition.code.length || REQUIRED_CODE.some((path) => !paths.has(path))
    || [...paths].some((path) => !REQUIRED_CODE.includes(path) && path !== PROMPT_CODE)
    || candidate && !paths.has(PROMPT_CODE)) return fail("code_manifest_invalid");
  verifyRequests(condition, candidate);
  return { condition, conditionSha256: sha256(conditionJson) };
}

function parseRun(value: { condition: unknown; summary: unknown }, candidate: boolean) {
  const { condition, conditionSha256 } = parseCondition(value.condition, candidate);
  boundedJson(value.summary, 512 * 1024);
  const summaryResult = summarySchema.safeParse(value.summary);
  if (!summaryResult.success) return fail("incomplete_or_invalid_summary");
  const summary = summaryResult.data;
  if (summary.conditionSha256 !== conditionSha256) return fail("condition_hash_mismatch");
  if (!isDeepStrictEqual(summary.comparison.rows.map((row) => row.id), CASE_IDS)
    || summary.responseModels.some((response, index) => response.stage !== STAGES[index % 3])) return fail("case_or_request_order_mismatch");
  const rows = summary.comparison.rows.map((entry) => {
    if (!isDeepStrictEqual(entry.ranks, entry.results.map((row) => row.expectedRank))
      || entry.results.some((row) => row.id !== entry.id || row.expectedItemSeq !== entry.results[0]!.expectedItemSeq)) return fail("row_score_mismatch");
    for (const row of entry.results) {
      const expectedIndex = row.candidateItemSeqs.indexOf(row.expectedItemSeq);
      if (row.expectedRank !== (expectedIndex < 0 ? null : expectedIndex + 1)
        || row.expectedHeld !== row.heldCandidateItemSeqs.includes(row.expectedItemSeq)
        || row.strongCandidateItemSeqs.some((item) => !row.candidateItemSeqs.includes(item))
        || !isDeepStrictEqual(row.strongWrongCandidateItemSeqs, row.strongCandidateItemSeqs.filter((item) => item !== row.expectedItemSeq))
        || row.needsRetake !== (row.comparisonStatus === "needs_retake" || row.searchStatus === "needs_retake")) return fail("row_score_mismatch");
    }
    return entry.results;
  });
  if (new Set(rows.map((row) => row[0]!.expectedItemSeq)).size !== 6) return fail("independent_products_mismatch");
  const recall = KS.map((k) => {
    const hitsByRepetition = [0, 1, 2].map((repeat) => rows.filter((row) => row[repeat]!.expectedRank !== null && row[repeat]!.expectedRank! <= k).length);
    return { k, hitsByRepetition, denominatorPerRepetition: 6, minHits: Math.min(...hitsByRepetition), maxHits: Math.max(...hitsByRepetition) };
  });
  const safetyByRepetition = [0, 1, 2].map((repeat) => ({ repetition: repeat + 1,
    strongWrongCandidates: rows.reduce((sum, row) => sum + row[repeat]!.strongWrongCandidateItemSeqs.length, 0),
    retakeCandidateExposureCases: rows.reduce((sum, row) => sum + exposure(row[repeat]!), 0),
  }));
  const safetyPassed = safetyByRepetition.every((repeat) => repeat.strongWrongCandidates === 0 && repeat.retakeCandidateExposureCases === 0);
  const allRepetitionsPassed = safetyPassed && recall[1]!.minHits === 6;
  if (!isDeepStrictEqual(summary.comparison.recall, recall)
    || !isDeepStrictEqual(summary.comparison.safetyByRepetition, safetyByRepetition)
    || summary.comparison.allRepetitionsPassed !== allRepetitionsPassed) return fail("summary_metrics_mismatch");
  return { condition, summary, rows, safetyPassed, allRepetitionsPassed, safetyByRepetition,
    recall: recall.map((metric) => ({ ...metric, totalHits: metric.hitsByRepetition.reduce((sum, value) => sum + value, 0), totalEvaluations: 18 })),
  };
}

function compareConditions(baseline: Condition, candidate: Condition) {
  const unchangedFields = ["runtime", "fixtureVersion", "fixtureContentSha256", "catalogVersion", "catalogSha256"] as const;
  if (unchangedFields.some((field) => !isDeepStrictEqual(baseline[field], candidate[field]))) return fail("non_prompt_condition_changed");
  const baselineCode = new Map(baseline.code.map((file) => [file.path, file.sha256]));
  const codeChanges = candidate.code.flatMap((file) => {
    const previous = baselineCode.get(file.path) ?? null;
    if (previous === file.sha256) return [];
    if (!CHANGEABLE_CODE.has(file.path)) return fail("protected_code_changed");
    return [{ path: file.path, beforeSha256: previous, afterSha256: file.sha256 }];
  });
  for (const [index, previous] of baseline.cases.entries()) {
    const next = candidate.cases[index]!;
    if (!isDeepStrictEqual(previous.sourceSha256, next.sourceSha256)
      || !isDeepStrictEqual(previous.preprocessing, next.preprocessing)) return fail("input_or_preprocessing_changed");
    for (const [stageIndex, previousRequest] of previous.requests.entries()) {
      const nextRequest = next.requests[stageIndex]!;
      if (stageIndex !== 0) {
        if (!isDeepStrictEqual(previousRequest, nextRequest)) return fail("request_contract_changed");
      } else {
        const { instructions: beforeInstructions, ...previousBody } = previousRequest.requestDescription;
        const { instructions: afterInstructions, ...nextBody } = nextRequest.requestDescription;
        if (beforeInstructions === afterInstructions || !isDeepStrictEqual(previousBody, nextBody) || !isDeepStrictEqual(previousRequest.images, nextRequest.images)
          || previousRequest.schemaSha256 !== nextRequest.schemaSha256
          || previousRequest.bodySha256 === nextRequest.bodySha256) return fail("request_contract_changed");
      }
    }
  }
  return { unchangedFields, codeChanges };
}

/** Pre-live check: accepts a baseline condition.json and a candidate plan.condition without any results. */
export function assertPillPhotoTrialComparisonConditions(before: unknown, after: unknown) {
  const baseline = parseCondition(before, false), candidate = parseCondition(after, true);
  return { schemaVersion: "pill-photo-trial-comparison-conditions.v1", externalRequests: 0,
    beforeConditionSha256: baseline.conditionSha256, afterConditionSha256: candidate.conditionSha256,
    beforeProtocol: baseline.condition.protocol.id, afterProtocol: candidate.condition.protocol.id,
    casesCompared: 6, requestStagesCompared: 18, onlyVisionInstructionsChanged: true,
    ...compareConditions(baseline.condition, candidate.condition),
    fullRequestBodyHashesRecomputed: false,
  };
}

/** Checks recorded conditions and recomputes all metrics; it cannot attest to unrecorded provider state or image bytes. */
export function comparePillPhotoTrialRuns(before: { condition: unknown; summary: unknown }, after: { condition: unknown; summary: unknown }) {
  const baseline = parseRun(before, false), candidate = parseRun(after, true);
  const { unchangedFields, codeChanges } = compareConditions(baseline.condition, candidate.condition);
  const rows = CASE_IDS.map((id, index) => {
    const previous = baseline.rows[index]!, next = candidate.rows[index]!;
    if (previous[0]!.expectedItemSeq !== next[0]!.expectedItemSeq) return fail("expected_product_changed");
    return { id, beforeRanks: previous.map((row) => row.expectedRank), afterRanks: next.map((row) => row.expectedRank),
      beforeVaried: previous.some((row) => !isDeepStrictEqual(row, previous[0])),
      afterVaried: next.some((row) => !isDeepStrictEqual(row, next[0])),
      repetitions: previous.map((row, repeat) => ({ repetition: repeat + 1, before: row, after: next[repeat]!,
        changed: !isDeepStrictEqual(row, next[repeat]),
        strongWrongCandidateDelta: next[repeat]!.strongWrongCandidateItemSeqs.length - row.strongWrongCandidateItemSeqs.length,
        retakeCandidateExposureDelta: exposure(next[repeat]!) - exposure(row),
      })),
    };
  });
  const checks = { bothTrialsComplete: true, candidateSafetyPassed: candidate.safetyPassed,
    recallAt5MinimumNotLower: candidate.recall[1]!.minHits >= baseline.recall[1]!.minHits,
    recallAt5TotalNotLower: candidate.recall[1]!.totalHits >= baseline.recall[1]!.totalHits,
    recallAt1TotalNotLower: candidate.recall[0]!.totalHits >= baseline.recall[0]!.totalHits,
    recallAt1Or5TotalIncreased: candidate.recall[0]!.totalHits > baseline.recall[0]!.totalHits || candidate.recall[1]!.totalHits > baseline.recall[1]!.totalHits,
  };
  const responseTags = (run: typeof baseline) => STAGES.map((stage) => ({ stage,
    values: [...new Set(run.summary.responseModels.filter((entry) => entry.stage === stage).map((entry) => entry.value))],
  }));
  return { schemaVersion: "pill-photo-trial-comparison.v1", externalRequests: 0, independentProducts: 6,
    repeatedEvaluationsPerCondition: 18, productionReadinessClaim: false, generalizationClaim: false,
    decision: candidate.safetyPassed ? Object.values(checks).every(Boolean) ? "promising_validation_only" : "no_clear_gain" : "candidate_safety_failure",
    checks,
    metadata: { beforeConditionSha256: baseline.summary.conditionSha256, afterConditionSha256: candidate.summary.conditionSha256,
      beforeProtocol: baseline.condition.protocol.id, afterProtocol: candidate.condition.protocol.id,
      beforeVisionPrompt: baseline.condition.protocol.visionPrompt, afterVisionPrompt: candidate.condition.protocol.visionPrompt,
      unchangedFields, codeChanges, beforeResponseModels: responseTags(baseline), afterResponseModels: responseTags(candidate),
      responseModelSequenceChanged: !isDeepStrictEqual(baseline.summary.responseModels, candidate.summary.responseModels),
      modelSnapshotPinned: false, providerDeterminismClaim: false,
    },
    recall: KS.map((k, index) => ({ k, before: baseline.recall[index]!, after: candidate.recall[index]!,
      totalHitDelta: candidate.recall[index]!.totalHits - baseline.recall[index]!.totalHits,
      minimumHitDelta: candidate.recall[index]!.minHits - baseline.recall[index]!.minHits,
    })),
    safety: { beforePassed: baseline.safetyPassed, afterPassed: candidate.safetyPassed,
      before: baseline.safetyByRepetition, after: candidate.safetyByRepetition }, rows,
    limits: ["Six validation products only; repeated evaluations are not independent new products or statistical significance.",
      "Fresh OCR responses and unpinned provider state can vary; this comparison does not isolate all response changes to the Vision prompt.",
      "Checks establish consistency of saved records, not independent attestation that requests occurred.",
      "Image bytes are absent from request descriptions, so complete request body hashes cannot be recomputed here; OCR hashes are checked for equality."],
  };
}
