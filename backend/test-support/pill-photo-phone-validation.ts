// Node-only local smartphone validation data. Never import this loader in a production route.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { z } from "zod";
import { loadFrozenPillPhotoFixture, readBoundedFixtureFile } from "./pill-photo-fixture.ts";
import { officialPillRecordDigest } from "./pill-photo-label-audit.ts";
import { loadPillPhotoEvaluationFixture } from "./pill-photo-evaluation.ts";
import { PILL_PHOTO_FILES } from "./pill-photo-review.ts";
import { loadPillPhotoUnseenEvaluationFixture } from "./pill-photo-unseen-evaluation.ts";

export const PILL_PHOTO_PHONE_VALIDATION_VERSION = "pill-photo-phone-validation-local-2026-09-02-v4";
export const PILL_PHOTO_PHONE_HOLDOUT_VERSION = "pill-photo-phone-holdout-local-2026-09-02-v5";
export const PILL_PHOTO_PHONE_VALIDATION_DIRECTORY = fileURLToPath(
  new URL("../../verification-artifacts/pill-photo-v4-intake/validation/", import.meta.url),
);
export const PILL_PHOTO_PHONE_HOLDOUT_DIRECTORY = fileURLToPath(
  new URL("../../verification-artifacts/pill-photo-v4-intake/holdout/", import.meta.url),
);

const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const itemSeqSchema = z.string().regex(/^\d{9}$/);
const idSchema = z.string().regex(/^v4-[vh]0[1-6]$/);
const imagePathSchema = z.string().regex(/^v4-[vh]0[1-6]-side-[ab]\.jpg$/);
const sideSchema = z.enum(["front", "back"]);
const captureSideSchema = z.enum(["side-a", "side-b"]);
const officialSurfaceSchema = z.object({
  rawImprint: z.string().min(1).nullable(),
  imprint: z.string().min(1).nullable(),
  scoreLine: z.enum(["none", "single", "cross", "other", "unknown"]),
  mark: z.string().min(1).nullable(),
}).strict();
const expectedObservationSchema = z.object({
  form: z.enum(["tablet", "capsule"]),
  formName: z.string().min(1),
  shape: z.string().min(1),
  colors: z.array(z.string().min(1)).min(1).max(2),
  front: officialSurfaceSchema,
  back: officialSurfaceSchema,
}).strict();
const appearanceHistorySchema = z.object({
  status: z.literal("verified_historical_variant"),
  photoAppearance: z.string().min(1),
  photoDimensionsMm: z.object({
    longAxis: z.number().positive(), shortAxis: z.number().positive(), thickness: z.number().positive(),
  }).strict(),
  currentAppearance: z.string().min(1),
  currentDimensionsMm: z.object({
    longAxis: z.number().positive(), shortAxis: z.number().positive(), thickness: z.number().positive(),
  }).strict(),
  appearanceChangedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  manufacturerEvidenceUrl: z.string().url(),
  identificationHistoryUrl: z.string().url(),
  evaluationRule: z.string().min(1),
}).strict();
const productSchema = z.object({
  id: idSchema,
  providedName: z.string().min(1),
  expectedItemSeq: itemSeqSchema,
  officialProductName: z.string().min(1),
  manufacturer: z.string().min(1),
  expectedOfficialRecordSha256: digestSchema,
  expectedObservation: expectedObservationSchema,
  photoMatchesCurrentOfficialAppearance: z.literal(false).optional(),
  appearanceHistory: appearanceHistorySchema.optional(),
  sideMapping: z.object({ "side-a": sideSchema, "side-b": sideSchema }).strict(),
}).strict();
const imageSchema = z.object({
  path: imagePathSchema,
  productId: idSchema,
  captureSide: captureSideSchema,
  officialSide: sideSchema,
  bytes: z.number().int().positive().max(MAX_IMAGE_BYTES),
  width: z.number().int().positive().max(10_000),
  height: z.number().int().positive().max(10_000),
  sha256: digestSchema,
}).strict();
const caseSchema = z.object({
  id: idSchema,
  split: z.enum(["validation", "holdout"]),
  expectedItemSeq: itemSeqSchema,
  photos: z.array(imagePathSchema).length(2),
}).strict();
const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  fixtureVersion: z.enum([PILL_PHOTO_PHONE_VALIDATION_VERSION, PILL_PHOTO_PHONE_HOLDOUT_VERSION]),
  purpose: z.literal("smartphone_photo_feature_extraction_and_candidate_recall_validation"),
  catalogFixtureVersion: z.literal("pill-photo-shared-2026-08-31-v1"),
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scope: z.object({
    split: z.enum(["validation", "holdout"]),
    claim: z.enum(["smartphone_validation_tuning_only", "smartphone_final_holdout_only"]),
    productCount: z.number().int().positive().max(16),
    caseCount: z.number().int().positive().max(16),
    imageCount: z.number().int().positive().max(32),
    historicalAppearanceCaseCount: z.number().int().nonnegative().max(16),
    labelsMayBeUsedForTuning: z.boolean(),
    labelsMayBeSentToModel: z.literal(false),
    gitTracking: z.enum(["ignored_local_intake", "ignored_local_holdout"]),
  }).strict(),
  products: z.array(productSchema).min(1).max(16),
  images: z.array(imageSchema).min(2).max(32),
  cases: z.array(caseSchema).min(1).max(16),
}).strict();

export type PillPhotoPhoneValidationManifest = z.infer<typeof manifestSchema>;

interface PhoneFixtureSpec {
  fixtureVersion: typeof PILL_PHOTO_PHONE_VALIDATION_VERSION | typeof PILL_PHOTO_PHONE_HOLDOUT_VERSION;
  split: "validation" | "holdout";
  idPrefix: "v4-v" | "v4-h";
  claim: "smartphone_validation_tuning_only" | "smartphone_final_holdout_only";
  labelsMayBeUsedForTuning: boolean;
  gitTracking: "ignored_local_intake" | "ignored_local_holdout";
}

const VALIDATION_SPEC: PhoneFixtureSpec = {
  fixtureVersion: PILL_PHOTO_PHONE_VALIDATION_VERSION,
  split: "validation",
  idPrefix: "v4-v",
  claim: "smartphone_validation_tuning_only",
  labelsMayBeUsedForTuning: true,
  gitTracking: "ignored_local_intake",
};
const HOLDOUT_SPEC: PhoneFixtureSpec = {
  fixtureVersion: PILL_PHOTO_PHONE_HOLDOUT_VERSION,
  split: "holdout",
  idPrefix: "v4-h",
  claim: "smartphone_final_holdout_only",
  labelsMayBeUsedForTuning: false,
  gitTracking: "ignored_local_holdout",
};

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const resolveImage = (directory: string, relativePath: string) => join(directory, relativePath);

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateManifestRelationships(
  manifest: PillPhotoPhoneValidationManifest,
  previousImageHashes: ReadonlySet<string>,
  spec: PhoneFixtureSpec,
) {
  const { scope } = manifest;
  if (manifest.fixtureVersion !== spec.fixtureVersion || scope.split !== spec.split
    || scope.claim !== spec.claim || scope.labelsMayBeUsedForTuning !== spec.labelsMayBeUsedForTuning
    || scope.gitTracking !== spec.gitTracking
    || manifest.products.some((product) => !product.id.startsWith(spec.idPrefix))
    || manifest.images.some((image) => !image.productId.startsWith(spec.idPrefix))
    || manifest.cases.some((fixtureCase) => !fixtureCase.id.startsWith(spec.idPrefix) || fixtureCase.split !== spec.split)) {
    throw new Error("phone_validation_fixture_scope_mismatch");
  }
  if (scope.productCount !== manifest.products.length || scope.caseCount !== manifest.cases.length
    || scope.imageCount !== manifest.images.length) throw new Error("phone_validation_fixture_scope_mismatch");
  const productById = new Map(manifest.products.map((product) => [product.id, product]));
  const imageByPath = new Map(manifest.images.map((image) => [image.path, image]));
  if (productById.size !== manifest.products.length || imageByPath.size !== manifest.images.length) {
    throw new Error("phone_validation_fixture_duplicate_entry");
  }
  if (new Set(manifest.products.map((product) => product.expectedItemSeq)).size !== manifest.products.length) {
    throw new Error("phone_validation_fixture_duplicate_product");
  }
  if (new Set(manifest.products.map((product) => product.expectedOfficialRecordSha256)).size !== manifest.products.length) {
    throw new Error("phone_validation_fixture_duplicate_official_record");
  }
  if (new Set(manifest.images.map((image) => image.sha256)).size !== manifest.images.length) {
    throw new Error("phone_validation_fixture_duplicate_image");
  }
  if (manifest.images.some((image) => previousImageHashes.has(image.sha256))) {
    throw new Error("phone_validation_fixture_overlaps_previous_images");
  }
  const historyCases = manifest.products.filter((product) => product.appearanceHistory !== undefined);
  if (historyCases.length !== scope.historicalAppearanceCaseCount
    || manifest.products.some((product) => (product.photoMatchesCurrentOfficialAppearance === false)
      !== (product.appearanceHistory !== undefined))) {
    throw new Error("phone_validation_fixture_history_mismatch");
  }

  const usedPhotos = new Set<string>();
  for (const fixtureCase of manifest.cases) {
    const product = productById.get(fixtureCase.id);
    const photos = fixtureCase.photos.map((path) => imageByPath.get(path));
    if (!product || product.expectedItemSeq !== fixtureCase.expectedItemSeq || photos.some((photo) => !photo)) {
      throw new Error("phone_validation_fixture_case_mapping_invalid");
    }
    if (photos.some((photo) => photo!.productId !== product.id
      || product.sideMapping[photo!.captureSide] !== photo!.officialSide)) {
      throw new Error("phone_validation_fixture_side_mapping_invalid");
    }
    if (new Set(photos.map((photo) => photo!.officialSide)).size !== 2) {
      throw new Error("phone_validation_fixture_requires_opposite_sides");
    }
    for (const path of fixtureCase.photos) {
      if (usedPhotos.has(path)) throw new Error("phone_validation_fixture_photo_reused");
      usedPhotos.add(path);
    }
  }
  if (usedPhotos.size !== manifest.images.length) throw new Error("phone_validation_fixture_unreferenced_image");
}

function validateOfficialLabels(
  manifest: PillPhotoPhoneValidationManifest,
  catalogFixtureVersion: string,
  officialItems: Awaited<ReturnType<typeof loadFrozenPillPhotoFixture>>["snapshot"]["items"],
) {
  if (catalogFixtureVersion !== manifest.catalogFixtureVersion) {
    throw new Error("phone_validation_fixture_catalog_version_mismatch");
  }
  for (const product of manifest.products) {
    const matches = officialItems.filter((item) => item.itemSeq === product.expectedItemSeq);
    if (matches.length !== 1) throw new Error("phone_validation_fixture_official_label_mismatch");
    const item = matches[0]!;
    const expected = product.expectedObservation;
    if (officialPillRecordDigest(item) !== product.expectedOfficialRecordSha256
      || item.productName !== product.officialProductName || item.manufacturer !== product.manufacturer
      || item.form !== expected.form || item.formName !== expected.formName || item.shape !== expected.shape
      || !sameStrings(item.colors, expected.colors)
      || item.front.rawImprint !== expected.front.rawImprint || item.front.imprint !== expected.front.imprint
      || item.front.scoreLine !== expected.front.scoreLine || item.front.mark !== expected.front.mark
      || item.back.rawImprint !== expected.back.rawImprint || item.back.imprint !== expected.back.imprint
      || item.back.scoreLine !== expected.back.scoreLine || item.back.mark !== expected.back.mark) {
      throw new Error("phone_validation_fixture_official_label_mismatch");
    }
  }
}

async function defaultPreviousImageHashes() {
  const [evaluation, unseen] = await Promise.all([
    loadPillPhotoEvaluationFixture(),
    loadPillPhotoUnseenEvaluationFixture(),
  ]);
  return new Set([
    ...PILL_PHOTO_FILES.map((image) => image.sha256),
    ...evaluation.manifest.images.map((image) => image.sha256),
    ...unseen.manifest.images.map((image) => image.sha256),
  ]);
}

async function loadPillPhotoPhoneFixture(spec: PhoneFixtureSpec, options: {
  directory?: string;
  previousImageHashes?: ReadonlySet<string>;
}, defaultDirectory: string) {
  const directory = options.directory ?? defaultDirectory;
  const [rawManifest, frozen, previousImageHashes] = await Promise.all([
    readBoundedFixtureFile(join(directory, "manifest.local.json"), MAX_MANIFEST_BYTES),
    loadFrozenPillPhotoFixture(),
    options.previousImageHashes ? Promise.resolve(options.previousImageHashes) : defaultPreviousImageHashes(),
  ]);
  const manifest = manifestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawManifest)));
  validateManifestRelationships(manifest, previousImageHashes, spec);
  validateOfficialLabels(manifest, frozen.manifest.fixtureVersion, frozen.snapshot.items);

  for (const image of manifest.images) {
    const bytes = await readBoundedFixtureFile(resolveImage(directory, image.path), image.bytes);
    if (bytes.length !== image.bytes || sha256(bytes) !== image.sha256) {
      throw new Error("phone_validation_fixture_image_hash_mismatch");
    }
    const metadata = await sharp(bytes, { limitInputPixels: 25_000_000, failOn: "warning" }).metadata();
    if (metadata.format !== "jpeg" || (metadata.pages ?? 1) !== 1
      || metadata.width !== image.width || metadata.height !== image.height) {
      throw new Error("phone_validation_fixture_image_metadata_mismatch");
    }
  }

  const inferenceInputs = manifest.cases.map((fixtureCase) => ({
    id: fixtureCase.id,
    split: fixtureCase.split,
    photos: fixtureCase.photos.map((path) => resolveImage(directory, path)),
  }));
  return { manifest, inferenceInputs };
}

export async function loadPillPhotoPhoneValidationFixture(options: {
  directory?: string;
  previousImageHashes?: ReadonlySet<string>;
} = {}) {
  return loadPillPhotoPhoneFixture(VALIDATION_SPEC, options, PILL_PHOTO_PHONE_VALIDATION_DIRECTORY);
}

export async function loadPillPhotoPhoneHoldoutFixture(options: {
  directory?: string;
  previousImageHashes?: ReadonlySet<string>;
} = {}) {
  let previousImageHashes = options.previousImageHashes;
  if (!previousImageHashes) {
    const prior = await defaultPreviousImageHashes();
    const validation = await loadPillPhotoPhoneFixture(
      VALIDATION_SPEC,
      { previousImageHashes: prior },
      PILL_PHOTO_PHONE_VALIDATION_DIRECTORY,
    );
    previousImageHashes = new Set([...prior, ...validation.manifest.images.map((image) => image.sha256)]);
  }
  return loadPillPhotoPhoneFixture(
    HOLDOUT_SPEC,
    { ...options, previousImageHashes },
    PILL_PHOTO_PHONE_HOLDOUT_DIRECTORY,
  );
}
