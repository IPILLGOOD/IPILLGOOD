// Node-only evaluation data. Never import this loader in a production route or live fallback.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadFrozenPillPhotoFixture, readBoundedFixtureFile } from "./pill-photo-fixture.ts";
import { PILL_PHOTO_FILES } from "./pill-photo-review.ts";

export const PILL_PHOTO_EVALUATION_VERSION = "pill-photo-capture-eval-2026-09-01-v1";
export const PILL_PHOTO_EVALUATION_DIRECTORY = fileURLToPath(new URL("./pill-photo-evaluation/", import.meta.url));

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const itemSeqSchema = z.string().regex(/^\d{9}$/);
const imagePathSchema = z.string().regex(/^images\/capture-[vh]-0[1-4]-[ab]\.png$/);
const sourcePathSchema = z.string().regex(/^\d{5}\/IMG_\d{8}_\d{6}\.png$/);
const expectedObservationSchema = z.object({
  form: z.enum(["tablet", "capsule"]),
  shape: z.enum(["타원형", "장방형"]),
  colors: z.array(z.string().min(1)).min(1).max(2),
  frontImprint: z.string().min(1).nullable(),
  backImprint: z.string().min(1).nullable(),
}).strict();
const productSchema = z.object({
  receipt: z.string().regex(/^\d{5}$/),
  expectedItemSeq: itemSeqSchema,
  expectedObservation: expectedObservationSchema,
}).strict();
const imageSchema = z.object({
  path: imagePathSchema,
  sourcePath: sourcePathSchema,
  sourceIndex: z.number().int().min(1).max(40),
  officialSide: z.enum(["front", "back"]),
  sha256: digestSchema,
  bytes: z.number().int().positive().max(2 * 1024 * 1024),
}).strict();
const caseSchema = z.object({
  id: z.string().regex(/^capture-[vh]-0[1-4]$/),
  split: z.enum(["validation", "holdout"]),
  receipt: z.string().regex(/^\d{5}$/),
  expectedItemSeq: itemSeqSchema,
  photos: z.array(imagePathSchema).length(2),
}).strict();
const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  fixtureVersion: z.literal(PILL_PHOTO_EVALUATION_VERSION),
  purpose: z.literal("feature_extraction_and_candidate_recall_evaluation"),
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  catalogFixtureVersion: z.literal("pill-photo-shared-2026-08-31-v1"),
  scope: z.object({
    productCount: z.literal(4),
    caseCount: z.literal(8),
    imageCount: z.literal(16),
    claim: z.literal("capture_level_repeatability_only"),
    limitations: z.array(z.string().min(1)).length(3),
  }).strict(),
  products: z.array(productSchema).length(4),
  images: z.array(imageSchema).length(16),
  cases: z.array(caseSchema).length(8),
  rights: z.object({
    checkedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    statedScope: z.literal("이용허락범위 제한 없음"),
    imageMetadataUrl: z.string().url(),
    imageDownloadNotice: z.string().url(),
    catalogMetadataUrl: z.string().url(),
  }).strict(),
}).strict();

export type PillPhotoEvaluationManifest = z.infer<typeof manifestSchema>;
export type PillPhotoEvaluationSplit = PillPhotoEvaluationManifest["cases"][number]["split"];

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const resolveImage = (relativePath: string) => join(PILL_PHOTO_EVALUATION_DIRECTORY, ...relativePath.split("/"));

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateManifestRelationships(manifest: PillPhotoEvaluationManifest) {
  const productByReceipt = new Map(manifest.products.map((product) => [product.receipt, product]));
  const imageByPath = new Map(manifest.images.map((image) => [image.path, image]));
  if (productByReceipt.size !== 4 || imageByPath.size !== 16) throw new Error("evaluation_fixture_duplicate_entry");
  if (new Set(manifest.products.map((product) => product.expectedItemSeq)).size !== 4) throw new Error("evaluation_fixture_duplicate_product");
  if (new Set(manifest.images.map((image) => image.sha256)).size !== 16) throw new Error("evaluation_fixture_duplicate_image");
  if (manifest.images.some((image) => PILL_PHOTO_FILES.some((existing) => existing.sha256 === image.sha256))) {
    throw new Error("evaluation_fixture_overlaps_development_images");
  }

  const usedPhotos = new Set<string>();
  for (const fixtureCase of manifest.cases) {
    const product = productByReceipt.get(fixtureCase.receipt);
    const photos = fixtureCase.photos.map((path) => imageByPath.get(path));
    if (!product || product.expectedItemSeq !== fixtureCase.expectedItemSeq || photos.some((photo) => !photo)) {
      throw new Error("evaluation_fixture_case_mapping_invalid");
    }
    if (photos.some((photo) => !photo!.sourcePath.startsWith(`${fixtureCase.receipt}/`))) {
      throw new Error("evaluation_fixture_receipt_path_mismatch");
    }
    if (new Set(photos.map((photo) => photo!.officialSide)).size !== 2) {
      throw new Error("evaluation_fixture_requires_opposite_sides");
    }
    for (const path of fixtureCase.photos) {
      if (usedPhotos.has(path)) throw new Error("evaluation_fixture_photo_reused");
      usedPhotos.add(path);
    }
  }
  if (usedPhotos.size !== manifest.images.length) throw new Error("evaluation_fixture_unreferenced_image");

  for (const split of ["validation", "holdout"] as const) {
    const cases = manifest.cases.filter((fixtureCase) => fixtureCase.split === split);
    if (cases.length !== 4 || new Set(cases.map((fixtureCase) => fixtureCase.expectedItemSeq)).size !== 4) {
      throw new Error("evaluation_fixture_split_unbalanced");
    }
  }
}

async function validateOfficialLabels(manifest: PillPhotoEvaluationManifest) {
  const frozen = await loadFrozenPillPhotoFixture();
  if (frozen.manifest.fixtureVersion !== manifest.catalogFixtureVersion) throw new Error("evaluation_fixture_catalog_version_mismatch");
  for (const product of manifest.products) {
    const matches = frozen.snapshot.items.filter((item) => item.itemSeq === product.expectedItemSeq);
    const expected = product.expectedObservation;
    if (!matches.some((item) => item.form === expected.form && item.shape === expected.shape
      && sameStrings(item.colors, expected.colors) && item.front.imprint === expected.frontImprint
      && item.back.imprint === expected.backImprint)) {
      throw new Error("evaluation_fixture_official_label_mismatch");
    }
  }
}

/** Fixed Git fixture only. It validates labels separately and returns label-free model inputs. */
export async function loadPillPhotoEvaluationFixture() {
  const rawManifest = await readBoundedFixtureFile(join(PILL_PHOTO_EVALUATION_DIRECTORY, "manifest.json"), 64 * 1024);
  const manifest = manifestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawManifest)));
  validateManifestRelationships(manifest);
  await validateOfficialLabels(manifest);

  for (const image of manifest.images) {
    const bytes = await readBoundedFixtureFile(resolveImage(image.path), image.bytes);
    if (bytes.length !== image.bytes || sha256(bytes) !== image.sha256) throw new Error("evaluation_fixture_image_hash_mismatch");
  }

  const inferenceInputs = manifest.cases.map((fixtureCase) => ({
    id: fixtureCase.id,
    split: fixtureCase.split,
    photos: fixtureCase.photos.map(resolveImage),
  }));
  return { manifest, inferenceInputs };
}
