// Node-only evaluation logic. This scores saved features after inference; it never calls a model or API.
import { z } from "zod";
import { comparePillPhotoFeatures, pillPhotoFeaturesSchema } from "../src/pill-photo-features.ts";
import type { PillCatalog } from "../src/pill-identification.ts";
import {
  PILL_PHOTO_EVALUATION_VERSION,
  type PillPhotoEvaluationManifest,
  type PillPhotoEvaluationSplit,
} from "./pill-photo-evaluation.ts";

export const PILL_PHOTO_SCORE_SCHEMA_VERSION = "pill-photo-score.v1";
export const PILL_PHOTO_SCORE_POLICY_VERSION = "capture-candidate-recall-v1";
export const PILL_PHOTO_RECALL_KS = [1, 5, 20] as const;
export const PILL_PHOTO_REQUIRED_RECALL_K = 5;

const safeVersionSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/)
  .refine((value) => !/^sk-/i.test(value), "secret_like_version");
const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
}).strict();
const extractionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), features: pillPhotoFeaturesSchema, usage: usageSchema.nullable() }).strict(),
  z.object({
    status: z.literal("failed"),
    reason: z.enum([
      "invalid_photo", "refused", "incomplete_response", "invalid_response", "access_denied",
      "rate_limited", "provider_unavailable", "timeout", "network_error", "ocr_failed", "fusion_failed",
    ]),
  }).strict(),
]);
const scoreInputSchema = z.object({
  schemaVersion: z.literal(PILL_PHOTO_SCORE_SCHEMA_VERSION),
  fixtureVersion: z.literal(PILL_PHOTO_EVALUATION_VERSION),
  split: z.enum(["validation", "holdout"]),
  createdAt: z.string().datetime(),
  requests: z.number().int().nonnegative().max(32),
  pipeline: z.object({
    mode: z.enum(["vision", "vision_ocr"]),
    preprocessingVersion: safeVersionSchema,
    visionVersion: safeVersionSchema,
    model: safeVersionSchema.nullable(),
    ocrModel: safeVersionSchema.nullable().optional(),
    ocrVersion: safeVersionSchema.nullable(),
    fusionVersion: safeVersionSchema.nullable(),
  }).strict(),
  cases: z.array(z.object({
    id: z.string().regex(/^capture-[vh]-0[1-4]$/),
    extraction: extractionSchema,
  }).strict()).length(4),
}).strict();

export type PillPhotoScoreInput = z.infer<typeof scoreInputSchema>;

export interface PillPhotoCaseScore {
  id: string;
  expectedItemSeq: string;
  extractionStatus: "ok" | "failed";
  failureReason: string | null;
  comparisonStatus: string | null;
  comparisonReason: string | null;
  searchStatus: string | null;
  expectedRank: number | null;
  expectedHeld: boolean;
  candidateItemSeqs: string[];
  heldCandidateItemSeqs: string[];
  strongCandidateItemSeqs: string[];
  strongWrongCandidateItemSeqs: string[];
  needsRetake: boolean;
}

export interface PillPhotoRecallMetric {
  k: number;
  hits: number;
  total: number;
  rate: number;
}

export interface PillPhotoScoreSummary {
  totalCases: number;
  evaluatedCases: number;
  notEvaluatedCaseIds: string[];
  recallAt: Record<string, PillPhotoRecallMetric>;
  strongCandidateCount: number;
  strongCandidateCaseIds: string[];
  strongWrongCandidateCount: number;
  strongWrongCaseIds: string[];
  retakeCandidateExposureCaseCount: number;
  retakeCandidateExposureCaseIds: string[];
  expectedHeldCaseIds: string[];
}

function expectedCases(manifest: PillPhotoEvaluationManifest, split: PillPhotoEvaluationSplit) {
  return manifest.cases.filter((fixtureCase) => fixtureCase.split === split);
}

export function parsePillPhotoScoreInput(
  value: unknown,
  manifest: PillPhotoEvaluationManifest,
  requiredSplit?: PillPhotoEvaluationSplit,
): PillPhotoScoreInput {
  const parsed = scoreInputSchema.safeParse(value);
  if (!parsed.success || requiredSplit && parsed.data.split !== requiredSplit) throw new Error("invalid_evaluation_input");
  const expected = expectedCases(manifest, parsed.data.split);
  if (expected.length !== 4 || parsed.data.cases.some((entry, index) => entry.id !== expected[index]?.id)) {
    throw new Error("evaluation_case_mismatch");
  }
  return parsed.data;
}

export function summarizePillPhotoCaseScores(rows: PillPhotoCaseScore[]): PillPhotoScoreSummary {
  const total = rows.length;
  if (!total || new Set(rows.map((row) => row.id)).size !== total) throw new Error("evaluation_case_mismatch");
  const notEvaluatedCaseIds = rows.filter((row) => row.extractionStatus !== "ok" || row.comparisonStatus === null).map((row) => row.id);
  const recallAt = Object.fromEntries(PILL_PHOTO_RECALL_KS.map((k) => {
    const hits = rows.filter((row) => row.expectedRank !== null && row.expectedRank <= k).length;
    return [String(k), { k, hits, total, rate: Number((hits / total).toFixed(6)) }];
  }));
  const strongCandidateCaseIds = rows.filter((row) => row.strongCandidateItemSeqs.length > 0).map((row) => row.id);
  const strongWrongCaseIds = rows.filter((row) => row.strongWrongCandidateItemSeqs.length > 0).map((row) => row.id);
  const retakeCandidateExposureCaseIds = rows.filter((row) => row.needsRetake
    && row.candidateItemSeqs.length + row.heldCandidateItemSeqs.length > 0).map((row) => row.id);
  return {
    totalCases: total,
    evaluatedCases: total - notEvaluatedCaseIds.length,
    notEvaluatedCaseIds,
    recallAt,
    strongCandidateCount: rows.reduce((sum, row) => sum + row.strongCandidateItemSeqs.length, 0),
    strongCandidateCaseIds,
    strongWrongCandidateCount: rows.reduce((sum, row) => sum + row.strongWrongCandidateItemSeqs.length, 0),
    strongWrongCaseIds,
    retakeCandidateExposureCaseCount: retakeCandidateExposureCaseIds.length,
    retakeCandidateExposureCaseIds,
    expectedHeldCaseIds: rows.filter((row) => row.expectedHeld).map((row) => row.id),
  };
}

export function scorePillPhotoEvaluation(
  value: unknown,
  manifest: PillPhotoEvaluationManifest,
  catalog: PillCatalog,
  requiredSplit?: PillPhotoEvaluationSplit,
) {
  const input = parsePillPhotoScoreInput(value, manifest, requiredSplit);
  const inputById = new Map(input.cases.map((entry) => [entry.id, entry]));
  const rows: PillPhotoCaseScore[] = expectedCases(manifest, input.split).map((fixtureCase) => {
    const entry = inputById.get(fixtureCase.id)!;
    if (entry.extraction.status === "failed") {
      return {
        id: fixtureCase.id,
        expectedItemSeq: fixtureCase.expectedItemSeq,
        extractionStatus: "failed",
        failureReason: entry.extraction.reason,
        comparisonStatus: null,
        comparisonReason: null,
        searchStatus: null,
        expectedRank: null,
        expectedHeld: false,
        candidateItemSeqs: [],
        heldCandidateItemSeqs: [],
        strongCandidateItemSeqs: [],
        strongWrongCandidateItemSeqs: [],
        needsRetake: false,
      };
    }
    const comparison = comparePillPhotoFeatures(entry.extraction.features, catalog);
    const search = comparison.search;
    const candidateItemSeqs = search?.candidates.map((candidate) => candidate.itemSeq) ?? [];
    const heldCandidateItemSeqs = search?.heldCandidates.map((candidate) => candidate.itemSeq) ?? [];
    const strongCandidateItemSeqs = search?.candidates
      .filter((candidate) => candidate.grade === "strong")
      .map((candidate) => candidate.itemSeq) ?? [];
    const expectedIndex = candidateItemSeqs.indexOf(fixtureCase.expectedItemSeq);
    return {
      id: fixtureCase.id,
      expectedItemSeq: fixtureCase.expectedItemSeq,
      extractionStatus: "ok",
      failureReason: null,
      comparisonStatus: comparison.status,
      comparisonReason: comparison.reason,
      searchStatus: search?.status ?? null,
      expectedRank: expectedIndex >= 0 ? expectedIndex + 1 : null,
      expectedHeld: heldCandidateItemSeqs.includes(fixtureCase.expectedItemSeq),
      candidateItemSeqs,
      heldCandidateItemSeqs,
      strongCandidateItemSeqs,
      strongWrongCandidateItemSeqs: strongCandidateItemSeqs.filter((itemSeq) => itemSeq !== fixtureCase.expectedItemSeq),
      needsRetake: comparison.status === "needs_retake" || search?.status === "needs_retake",
    };
  });
  const metrics = summarizePillPhotoCaseScores(rows);
  const requiredRecall = metrics.recallAt[String(PILL_PHOTO_REQUIRED_RECALL_K)]!;
  const gates = {
    allCasesEvaluated: { passed: metrics.evaluatedCases === metrics.totalCases, required: metrics.totalCases, observed: metrics.evaluatedCases },
    recallAt5: { passed: requiredRecall.hits === requiredRecall.total, required: requiredRecall.total, observed: requiredRecall.hits },
    noStrongWrongCandidates: { passed: metrics.strongWrongCandidateCount === 0, maximum: 0, observed: metrics.strongWrongCandidateCount },
    noRetakeCandidateExposure: { passed: metrics.retakeCandidateExposureCaseCount === 0, maximum: 0, observed: metrics.retakeCandidateExposureCaseCount },
  };
  return {
    schemaVersion: PILL_PHOTO_SCORE_SCHEMA_VERSION,
    policyVersion: PILL_PHOTO_SCORE_POLICY_VERSION,
    fixtureVersion: input.fixtureVersion,
    split: input.split,
    createdAt: input.createdAt,
    pipeline: input.pipeline,
    requests: input.requests,
    catalogVersion: catalog.version,
    scope: "capture_level_repeatability_only" as const,
    productionReadinessClaim: false,
    recallKs: [...PILL_PHOTO_RECALL_KS],
    metrics,
    gates,
    passed: Object.values(gates).every((gate) => gate.passed),
    rows,
  };
}
