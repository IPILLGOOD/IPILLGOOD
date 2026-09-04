// Node-only evaluation data. Never import this loader in a production route or live fallback.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadPillPhotoEvaluationFixture } from "./pill-photo-evaluation.ts";
import { loadFrozenPillPhotoFixture, readBoundedFixtureFile } from "./pill-photo-fixture.ts";
import { auditPillPhotoOfficialLabels } from "./pill-photo-label-audit.ts";
import { PILL_PHOTO_FILES } from "./pill-photo-review.ts";

export const PILL_PHOTO_UNSEEN_EVALUATION_VERSION = "pill-photo-unseen-product-eval-2026-09-02-v3";
export const PILL_PHOTO_UNSEEN_EVALUATION_DIRECTORY = fileURLToPath(
  new URL("./pill-photo-unseen-evaluation/", import.meta.url),
);

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const itemSeqSchema = z.string().regex(/^\d{9}$/);
const sourceGroupSchema = z.string().regex(/^\d{5}$/);
const imagePathSchema = z.string().regex(/^images\/unseen-[vh]-0[1-4]-[ab]\.png$/);
const sourcePathSchema = z.string().regex(/^\d{5}\/IMG_\d{8}_\d{6}\.png$/);
const caseIdSchema = z.string().regex(/^unseen-[vh]-0[1-4]$/);
const mappingEvidenceUrlSchema = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && ["health.kr", "www.health.kr"].includes(url.hostname)
    && url.pathname === "/searchDrug/result_take.asp" && /^[a-zA-Z0-9]+$/.test(url.searchParams.get("drug_cd") ?? "");
});
const expectedObservationSchema = z.object({
  form: z.enum(["tablet", "capsule"]),
  shape: z.enum(["원형", "타원형", "장방형"]),
  colors: z.array(z.string().min(1)).min(1).max(2),
  frontImprint: z.string().min(1).nullable(),
  backImprint: z.string().min(1).nullable(),
}).strict();
const productSchema = z.object({
  sourceGroup: sourceGroupSchema,
  expectedItemSeq: itemSeqSchema,
  mappingEvidenceUrl: mappingEvidenceUrlSchema,
  expectedOfficialRecordSha256: digestSchema,
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
  id: caseIdSchema,
  split: z.enum(["validation", "holdout"]),
  sourceGroup: sourceGroupSchema,
  expectedItemSeq: itemSeqSchema,
  photos: z.array(imagePathSchema).length(2),
}).strict();
const manifestSchema = z.object({
  schemaVersion: z.literal(3),
  fixtureVersion: z.literal(PILL_PHOTO_UNSEEN_EVALUATION_VERSION),
  purpose: z.literal("feature_extraction_and_candidate_recall_evaluation"),
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  catalogFixtureVersion: z.literal("pill-photo-shared-2026-08-31-v1"),
  scope: z.object({
    productCount: z.literal(7),
    caseCount: z.literal(7),
    imageCount: z.literal(14),
    claim: z.literal("unseen_product_generalization_pilot"),
    limitations: z.array(z.string().min(1)).length(4),
  }).strict(),
  splitPolicy: z.object({
    selectedBeforeInference: z.literal(true),
    disjointProducts: z.literal(true),
    validationProductCount: z.literal(4),
    holdoutProductCount: z.literal(3),
    holdoutStatus: z.literal("sealed_unopened"),
  }).strict(),
  products: z.array(productSchema).length(7),
  images: z.array(imageSchema).length(14),
  cases: z.array(caseSchema).length(7),
  rights: z.object({
    checkedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    statedScope: z.literal("이용허락범위 제한 없음"),
    imageMetadataUrl: z.string().url(),
    imageDownloadNotice: z.string().url(),
    catalogMetadataUrl: z.string().url(),
  }).strict(),
}).strict();

export type PillPhotoUnseenEvaluationManifest = z.infer<typeof manifestSchema>;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const resolveImage = (relativePath: string) => join(
  PILL_PHOTO_UNSEEN_EVALUATION_DIRECTORY,
  ...relativePath.split("/"),
);

function validateManifestRelationships(
  manifest: PillPhotoUnseenEvaluationManifest,
  previousImageHashes: ReadonlySet<string>,
) {
  const productByGroup = new Map(manifest.products.map((product) => [product.sourceGroup, product]));
  const imageByPath = new Map(manifest.images.map((image) => [image.path, image]));
  if (productByGroup.size !== 7 || imageByPath.size !== 14) throw new Error("unseen_evaluation_fixture_duplicate_entry");
  if (new Set(manifest.products.map((product) => product.expectedItemSeq)).size !== 7) {
    throw new Error("unseen_evaluation_fixture_duplicate_product");
  }
  if (new Set(manifest.products.map((product) => product.mappingEvidenceUrl)).size !== 7) {
    throw new Error("unseen_evaluation_fixture_duplicate_mapping_evidence");
  }
  if (new Set(manifest.products.map((product) => product.expectedOfficialRecordSha256)).size !== 7) {
    throw new Error("unseen_evaluation_fixture_duplicate_official_record");
  }
  if (new Set(manifest.images.map((image) => image.sha256)).size !== 14) {
    throw new Error("unseen_evaluation_fixture_duplicate_image");
  }
  if (manifest.images.some((image) => previousImageHashes.has(image.sha256))) {
    throw new Error("unseen_evaluation_fixture_overlaps_previous_images");
  }

  const usedPhotos = new Set<string>();
  for (const fixtureCase of manifest.cases) {
    const product = productByGroup.get(fixtureCase.sourceGroup);
    const photos = fixtureCase.photos.map((path) => imageByPath.get(path));
    if (!product || product.expectedItemSeq !== fixtureCase.expectedItemSeq || photos.some((photo) => !photo)) {
      throw new Error("unseen_evaluation_fixture_case_mapping_invalid");
    }
    if (photos.some((photo) => !photo!.sourcePath.startsWith(`${fixtureCase.sourceGroup}/`))) {
      throw new Error("unseen_evaluation_fixture_source_path_mismatch");
    }
    if (new Set(photos.map((photo) => photo!.officialSide)).size !== 2) {
      throw new Error("unseen_evaluation_fixture_requires_opposite_sides");
    }
    for (const path of fixtureCase.photos) {
      if (usedPhotos.has(path)) throw new Error("unseen_evaluation_fixture_photo_reused");
      usedPhotos.add(path);
    }
  }
  if (usedPhotos.size !== manifest.images.length) throw new Error("unseen_evaluation_fixture_unreferenced_image");

  const validation = manifest.cases.filter((fixtureCase) => fixtureCase.split === "validation");
  const holdout = manifest.cases.filter((fixtureCase) => fixtureCase.split === "holdout");
  if (validation.length !== 4 || holdout.length !== 3) throw new Error("unseen_evaluation_fixture_split_unbalanced");
  const validationItems = new Set(validation.map((fixtureCase) => fixtureCase.expectedItemSeq));
  const holdoutItems = new Set(holdout.map((fixtureCase) => fixtureCase.expectedItemSeq));
  if (validationItems.size !== 4 || holdoutItems.size !== 3 || [...validationItems].some((itemSeq) => holdoutItems.has(itemSeq))) {
    throw new Error("unseen_evaluation_fixture_split_product_overlap");
  }
}

async function validateOfficialLabels(manifest: PillPhotoUnseenEvaluationManifest) {
  const frozen = await loadFrozenPillPhotoFixture();
  if (frozen.manifest.fixtureVersion !== manifest.catalogFixtureVersion) {
    throw new Error("unseen_evaluation_fixture_catalog_version_mismatch");
  }
  const products = manifest.products.map(({ sourceGroup, ...product }) => ({ receipt: sourceGroup, ...product }));
  const audit = auditPillPhotoOfficialLabels(products, frozen.snapshot.items);
  if (!audit.ok) throw new Error("unseen_evaluation_fixture_official_label_mismatch");
}

/** Fixed Git fixture only. It validates labels separately and returns label-free model inputs. */
export async function loadPillPhotoUnseenEvaluationFixture() {
  const [rawManifest, previousEvaluation] = await Promise.all([
    readBoundedFixtureFile(join(PILL_PHOTO_UNSEEN_EVALUATION_DIRECTORY, "manifest.json"), 64 * 1024),
    loadPillPhotoEvaluationFixture(),
  ]);
  const manifest = manifestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawManifest)));
  const previousImageHashes = new Set([
    ...PILL_PHOTO_FILES.map((image) => image.sha256),
    ...previousEvaluation.manifest.images.map((image) => image.sha256),
  ]);
  validateManifestRelationships(manifest, previousImageHashes);
  await validateOfficialLabels(manifest);

  for (const image of manifest.images) {
    const bytes = await readBoundedFixtureFile(resolveImage(image.path), image.bytes);
    if (bytes.length !== image.bytes || sha256(bytes) !== image.sha256) {
      throw new Error("unseen_evaluation_fixture_image_hash_mismatch");
    }
  }

  const inferenceInputs = manifest.cases.map((fixtureCase) => ({
    id: fixtureCase.id,
    split: fixtureCase.split,
    photos: fixtureCase.photos.map(resolveImage),
  }));
  return { manifest, inferenceInputs };
}
