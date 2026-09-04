import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  PILL_PHOTO_PHONE_HOLDOUT_DIRECTORY,
  PILL_PHOTO_PHONE_HOLDOUT_VERSION,
  PILL_PHOTO_PHONE_VALIDATION_DIRECTORY,
  PILL_PHOTO_PHONE_VALIDATION_VERSION,
  type PillPhotoPhoneValidationManifest,
} from "./pill-photo-phone-validation.ts";

export const PILL_PHOTO_PHONE_EVALUATION_RECORD_VERSION = "pill-photo-phone-evaluation-record.v1";
export const PILL_PHOTO_PHONE_EVALUATION_RECORD_PATH = fileURLToPath(
  new URL("./pill-photo-phone-evaluation/results-2026-09-02.json", import.meta.url),
);

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const splitSchema = z.enum(["validation", "holdout"]);
const metricsSchema = z.object({
  totalCases: z.literal(6),
  evaluatedCases: z.literal(6),
  recallAt1: z.object({ hits: z.number().int().min(0).max(6), total: z.literal(6) }).strict(),
  recallAt5: z.object({ hits: z.number().int().min(0).max(6), total: z.literal(6) }).strict(),
  recallAt20: z.object({ hits: z.number().int().min(0).max(6), total: z.literal(6) }).strict(),
  strongWrongCandidates: z.number().int().nonnegative(),
  retakeCandidateExposureCases: z.number().int().nonnegative(),
}).strict();

const fixtureRecordSchema = z.object({
  split: splitSchema,
  fixtureVersion: z.string().min(1),
  manifestSchemaVersion: z.literal(1),
  catalogFixtureVersion: z.string().min(1),
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  counts: z.object({ products: z.literal(6), cases: z.literal(6), images: z.literal(12) }).strict(),
  imageSha256: z.array(digestSchema).length(12),
  productIdentitySha256: z.array(digestSchema).length(6),
  officialRecordSha256: z.array(digestSchema).length(6),
}).strict();

const runRecordSchema = z.object({
  id: z.string().min(1),
  split: splitSchema,
  fixtureVersion: z.string().min(1),
  createdAt: z.string().datetime(),
  requests: z.literal(18),
  scorePolicyVersion: z.string().min(1),
  pipeline: z.object({
    model: z.string().min(1),
    ocrModel: z.string().min(1),
    preprocessingVersion: z.string().min(1),
    visionPromptVersion: z.string().min(1),
    ocrPromptVersion: z.string().min(1),
    fusionVersion: z.string().min(1),
    searchVersion: z.string().min(1),
    catalogVersion: z.string().min(1),
  }).strict(),
  metrics: metricsSchema,
  passedAtRun: z.boolean(),
}).strict();

const evaluationRecordSchema = z.object({
  schemaVersion: z.literal(PILL_PHOTO_PHONE_EVALUATION_RECORD_VERSION),
  productionReadinessClaim: z.literal(false),
  currentMinimumCasesForPass: z.literal(6),
  rawInputs: z.object({
    gitTracked: z.literal(false),
    cleanCheckoutMode: z.literal("metadata_only_without_private_photos_or_raw_model_outputs"),
    fullReplayRequirement: z.literal("team_private_fixture_plus_openai_api_key"),
  }).strict(),
  fixtures: z.array(fixtureRecordSchema).length(2),
  runs: z.array(runRecordSchema).length(3),
}).strict();

export type PillPhotoPhoneEvaluationRecord = z.infer<typeof evaluationRecordSchema>;
export type PillPhotoPhonePrivateFixtureState = "available" | "metadata_only";

function assertUnique(values: readonly string[], error: string) {
  if (new Set(values).size !== values.length) throw new Error(error);
}

function validateRecordRelationships(record: PillPhotoPhoneEvaluationRecord) {
  const validation = record.fixtures.find((fixture) => fixture.split === "validation");
  const holdout = record.fixtures.find((fixture) => fixture.split === "holdout");
  if (!validation || !holdout
    || validation.fixtureVersion !== PILL_PHOTO_PHONE_VALIDATION_VERSION
    || holdout.fixtureVersion !== PILL_PHOTO_PHONE_HOLDOUT_VERSION) {
    throw new Error("phone_evaluation_record_fixture_mismatch");
  }
  const imageHashes = record.fixtures.flatMap((fixture) => fixture.imageSha256);
  const productHashes = record.fixtures.flatMap((fixture) => fixture.productIdentitySha256);
  const officialHashes = record.fixtures.flatMap((fixture) => fixture.officialRecordSha256);
  assertUnique(imageHashes, "phone_evaluation_record_duplicate_image");
  assertUnique(productHashes, "phone_evaluation_record_duplicate_product");
  assertUnique(officialHashes, "phone_evaluation_record_duplicate_official_record");
  if (record.runs.filter((run) => run.split === "validation").length !== 2
    || record.runs.filter((run) => run.split === "holdout").length !== 1
    || record.runs.some((run) => run.fixtureVersion
      !== record.fixtures.find((fixture) => fixture.split === run.split)?.fixtureVersion)) {
    throw new Error("phone_evaluation_record_run_mismatch");
  }
}

export async function loadPillPhotoPhoneEvaluationRecord(): Promise<PillPhotoPhoneEvaluationRecord> {
  const bytes = await readFile(PILL_PHOTO_PHONE_EVALUATION_RECORD_PATH);
  if (bytes.length > 64 * 1024) throw new Error("phone_evaluation_record_too_large");
  const parsed = evaluationRecordSchema.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  if (!parsed.success) throw new Error("phone_evaluation_record_invalid");
  validateRecordRelationships(parsed.data);
  return parsed.data;
}

async function fixtureState(directory: string): Promise<PillPhotoPhonePrivateFixtureState> {
  return access(join(directory, "manifest.local.json"))
    .then(() => "available" as const, () => "metadata_only" as const);
}

export async function inspectPillPhotoPhonePrivateFixtureState(options: {
  validationDirectory?: string;
  holdoutDirectory?: string;
} = {}) {
  const [validation, holdout] = await Promise.all([
    fixtureState(options.validationDirectory ?? PILL_PHOTO_PHONE_VALIDATION_DIRECTORY),
    fixtureState(options.holdoutDirectory ?? PILL_PHOTO_PHONE_HOLDOUT_DIRECTORY),
  ]);
  return { validation, holdout };
}

export function productIdentitySha256(itemSeq: string) {
  return createHash("sha256").update(itemSeq, "utf8").digest("hex");
}

export function fixtureIdentitySummary(manifest: PillPhotoPhoneValidationManifest) {
  return {
    imageSha256: manifest.images.map((image) => image.sha256),
    productIdentitySha256: manifest.products.map((product) => productIdentitySha256(product.expectedItemSeq)),
    officialRecordSha256: manifest.products.map((product) => product.expectedOfficialRecordSha256),
  };
}
