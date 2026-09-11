// Node-only, fixed and reviewed evaluation fixtures only. Do not expose this experiment as a user-upload API (#61/#88).
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { PillPhotoFailure as PhotoFailure } from "./pill-photo-failures.ts";
import { PILL_PHOTO_FILES, PILL_PHOTO_REVIEW_VERSION } from "../test-support/pill-photo-review.ts";
import { PILL_PHOTO_PROMPT_VERSION, type PillPhotoFeatures } from "./pill-photo-features.ts";
import { pillPhotoVisionInstructions, type PillPhotoVisionPromptVersion } from "./pill-photo-prompt-profiles.ts";
import {
  PILL_PHOTO_FUSION_VERSION,
  PILL_PHOTO_OCR_PROMPT_VERSION,
  pillPhotoOcrInstructions,
  type PillPhotoOcrPromptVersion,
} from "./pill-photo-ocr.ts";
import {
  PILL_PHOTO_VARIANT_PREPROCESSING_VERSION,
  PILL_PHONE_PHOTO_PREPROCESSING_VERSION,
  prepareValidatedPhonePillPhotoVariants,
  prepareValidatedPillPhotoVariants,
  type ValidatedPillPhotoExpectation,
  type PillPhotoPreprocessingVariants,
  type PillPhonePhotoPreprocessingVariants,
} from "./pill-photo-preprocessing.ts";
import {
  preparePillPhotoVariantRequests, extractPreparedPillPhotoOcr, extractPreparedPillPhotos,
  type PreparedPillPhotoRequests, type PhotoExtractionResult, type PhotoOcrExtractionResult, type PillPhotoRequestTrace,
} from "./pill-photo-pipeline.ts";
export {
  PILL_PHOTO_TIMEOUT_MS, pillPhotoRequest, pillPhotoOcrRequest, parsePillPhotoResponse, parsePillPhotoOcrResponse,
  type PillPhotoRequestStage, type PillPhotoRequestTrace, type PreparedPillPhotoRequests,
  type PhotoExtractionSignals, type PhotoExtractionResult, type PhotoOcrExtractionResult,
} from "./pill-photo-pipeline.ts";

export const PILL_PHOTO_PREVIEW_PREPROCESSING_VERSION = "public-rgba-alpha-bounds-white-1024-v1";
export const PILL_PHOTO_PREPROCESSING_VERSION = PILL_PHOTO_VARIANT_PREPROCESSING_VERSION;
export const PILL_PHOTO_MASK_POLICY_VERSION = "reviewed-alpha-solidity-v1";
export const MIN_REVIEWED_PILL_MASK_SOLIDITY = 0.92;
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
type RequestObserver = (event: PillPhotoRequestTrace) => Promise<void>;
export type ReviewedPillPhotoSet = "development" | "evaluation" | "unseen_evaluation" | "phone_validation" | "phone_holdout";
type ReviewedPillPhotoExpectation = ValidatedPillPhotoExpectation & { path: string };
let evaluationPhotoAllowlistPromise: Promise<readonly ReviewedPillPhotoExpectation[]> | undefined;
let unseenEvaluationPhotoAllowlistPromise: Promise<readonly ReviewedPillPhotoExpectation[]> | undefined;
let phoneValidationPhotoAllowlistPromise: Promise<readonly ReviewedPillPhotoExpectation[]> | undefined;
let phoneHoldoutPhotoAllowlistPromise: Promise<readonly ReviewedPillPhotoExpectation[]> | undefined;

function evaluationPhotoAllowlist() {
  evaluationPhotoAllowlistPromise ??= import("../test-support/pill-photo-evaluation.ts")
    .then(({ loadPillPhotoEvaluationFixture }) => loadPillPhotoEvaluationFixture())
    .then(({ manifest }) => manifest.images);
  return evaluationPhotoAllowlistPromise;
}

function unseenEvaluationPhotoAllowlist() {
  unseenEvaluationPhotoAllowlistPromise ??= import("../test-support/pill-photo-unseen-evaluation.ts")
    .then(({ loadPillPhotoUnseenEvaluationFixture }) => loadPillPhotoUnseenEvaluationFixture())
    .then(({ manifest }) => manifest.images);
  return unseenEvaluationPhotoAllowlistPromise;
}

function phoneValidationPhotoAllowlist() {
  phoneValidationPhotoAllowlistPromise ??= import("../test-support/pill-photo-phone-validation.ts")
    .then(({ loadPillPhotoPhoneValidationFixture }) => loadPillPhotoPhoneValidationFixture())
    .then(({ manifest }) => manifest.images);
  return phoneValidationPhotoAllowlistPromise;
}

function phoneHoldoutPhotoAllowlist() {
  phoneHoldoutPhotoAllowlistPromise ??= import("../test-support/pill-photo-phone-validation.ts")
    .then(({ loadPillPhotoPhoneHoldoutFixture }) => loadPillPhotoPhoneHoldoutFixture())
    .then(({ manifest }) => manifest.images);
  return phoneHoldoutPhotoAllowlistPromise;
}
export function reviewedPhotoIndex(bytes: Uint8Array): number {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_INPUT_BYTES) return -1;
  const hash = createHash("sha256").update(bytes).digest("hex");
  return PILL_PHOTO_FILES.findIndex((file) => file.sha256 === hash && file.bytes === bytes.length);
}

export interface ReviewedPhotoMaskAssessment {
  status: "accepted" | "suspicious";
  reason: "low_alpha_solidity" | null;
  alphaSolidity: number;
  minimumSolidity: number;
  policyVersion: string;
}

function convexHull(points: Array<readonly [number, number]>) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (origin: readonly [number, number], a: readonly [number, number], b: readonly [number, number]) =>
    (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]);
  const half = (input: Array<readonly [number, number]>) => {
    const result: Array<readonly [number, number]> = [];
    for (const point of input) {
      while (result.length >= 2 && cross(result[result.length - 2]!, result[result.length - 1]!, point) <= 0) result.pop();
      result.push(point);
    }
    return result;
  };
  return [...half(sorted).slice(0, -1), ...half(sorted.reverse()).slice(0, -1)];
}

function polygonArea(points: Array<readonly [number, number]>) {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    twiceArea += current[0] * next[1] - current[1] * next[0];
  }
  return Math.abs(twiceArea) / 2;
}

/** Reviewed transparent PNGs only: a deep concavity is treated as a possible erased/cut-out region. */
export async function assessReviewedPhotoMask(bytes: Uint8Array): Promise<ReviewedPhotoMaskAssessment> {
  if (reviewedPhotoIndex(bytes) < 0) throw new Error("unreviewed_photo");
  const image = sharp(bytes, { limitInputPixels: 25_000_000, failOn: "warning" });
  const metadata = await image.metadata();
  if (metadata.format !== "png" || !metadata.hasAlpha || (metadata.pages ?? 1) !== 1) throw new Error("invalid_photo");
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const edgePoints: Array<readonly [number, number]> = [];
  let alphaPixels = 0;
  for (let y = 0; y < info.height; y++) {
    let first = -1;
    let last = -1;
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + 3] === 0) continue;
      alphaPixels++;
      if (first < 0) first = x;
      last = x;
    }
    if (first >= 0) {
      edgePoints.push([first, y]);
      if (last !== first) edgePoints.push([last, y]);
    }
  }
  const hullArea = edgePoints.length >= 3 ? polygonArea(convexHull(edgePoints)) : 0;
  if (!alphaPixels || hullArea <= 0) throw new Error("invalid_photo");
  const alphaSolidity = Math.min(1, Number((alphaPixels / hullArea).toFixed(6)));
  const suspicious = alphaSolidity < MIN_REVIEWED_PILL_MASK_SOLIDITY;
  return {
    status: suspicious ? "suspicious" : "accepted",
    reason: suspicious ? "low_alpha_solidity" : null,
    alphaSolidity,
    minimumSolidity: MIN_REVIEWED_PILL_MASK_SOLIDITY,
    policyVersion: PILL_PHOTO_MASK_POLICY_VERSION,
  };
}

export function applyReviewedPhotoMaskGate(features: PillPhotoFeatures, assessments: ReviewedPhotoMaskAssessment[]): PillPhotoFeatures {
  return assessments.some((assessment) => assessment.status === "suspicious")
    ? { ...features, imageArtifact: "present" }
    : features;
}

/** Only crops fully transparent outside pixels. No inpainting, recoloring, contrast or rotations. */
export async function prepareReviewedPillPhoto(bytes: Uint8Array): Promise<Buffer> {
  if (reviewedPhotoIndex(bytes) < 0) throw new Error("unreviewed_photo");
  const image = sharp(bytes, { limitInputPixels: 25_000_000, failOn: "warning" });
  const metadata = await image.metadata();
  if (metadata.format !== "png" || !metadata.hasAlpha || (metadata.pages ?? 1) !== 1) throw new Error("invalid_photo");
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + 3] !== 0) {
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
  }
  if (right < left || bottom < top) throw new Error("invalid_photo");
  // Encoding from raw pixels drops EXIF/XMP/text metadata and transparent hidden RGB pixels.
  return sharp(data, { raw: info }).extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .flatten({ background: "#ffffff" }).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .png().toBuffer();
}

/** Fixed public development allowlist wrapper. The current model request still uses the historical single view. */
export async function prepareReviewedPillPhotoVariants(bytes: Uint8Array) {
  const index = reviewedPhotoIndex(bytes);
  if (index < 0) throw new Error("unreviewed_photo");
  return prepareValidatedPillPhotoVariants(bytes, PILL_PHOTO_FILES[index]!);
}

/** Keyless/offline preparation. The SAME reviewed bytes, transforms and builders are used by live extraction. */
export async function prepareReviewedPillPhotoRequests(
  photos: readonly [Uint8Array, Uint8Array],
  options: { model: string; ocrModel: string; photoSet?: ReviewedPillPhotoSet; visionPromptVersion?: PillPhotoVisionPromptVersion;
    ocrPromptVersion?: PillPhotoOcrPromptVersion },
) {
  const failure = (reason: PhotoFailure) => ({ ok: false as const, reason });
  if (!Array.isArray(photos) || photos.length !== 2) return failure("unreviewed_photo");
  const photoSet = options.photoSet ?? "development";
  const visionPromptVersion = options.visionPromptVersion ?? PILL_PHOTO_PROMPT_VERSION;
  const ocrPromptVersion = options.ocrPromptVersion ?? PILL_PHOTO_OCR_PROMPT_VERSION;
  try { pillPhotoVisionInstructions(visionPromptVersion); pillPhotoOcrInstructions(ocrPromptVersion); }
  catch { return failure("invalid_request"); }
  // New prompt experiments are not allowed to consume frozen/unseen evaluation sets.
  if ((visionPromptVersion !== PILL_PHOTO_PROMPT_VERSION || ocrPromptVersion !== PILL_PHOTO_OCR_PROMPT_VERSION)
    && photoSet !== "development" && photoSet !== "phone_validation") {
    return failure("invalid_request");
  }
  let expectations: readonly [ReviewedPillPhotoExpectation, ReviewedPillPhotoExpectation];
  if (photoSet === "development") {
    const indexes = [reviewedPhotoIndex(photos[0]), reviewedPhotoIndex(photos[1])] as const;
    if (indexes.some((index) => index < 0)) return failure("unreviewed_photo");
    if (indexes[0] === indexes[1]) return failure("duplicate_photo");
    expectations = [PILL_PHOTO_FILES[indexes[0]]!, PILL_PHOTO_FILES[indexes[1]]!];
  } else if (photoSet === "evaluation" || photoSet === "unseen_evaluation"
    || photoSet === "phone_validation" || photoSet === "phone_holdout") {
    try {
      const allowlist = photoSet === "unseen_evaluation" ? await unseenEvaluationPhotoAllowlist()
        : photoSet === "phone_validation" ? await phoneValidationPhotoAllowlist()
          : photoSet === "phone_holdout" ? await phoneHoldoutPhotoAllowlist()
          : await evaluationPhotoAllowlist();
      const entries = photos.map((bytes) => {
        const digest = createHash("sha256").update(bytes).digest("hex");
        return allowlist.find((image) => image.bytes === bytes.length && image.sha256 === digest);
      });
      if (!entries[0] || !entries[1]) return failure("unreviewed_photo");
      if (entries[0].path === entries[1].path) return failure("duplicate_photo");
      expectations = [entries[0], entries[1]];
    } catch { return failure("unreviewed_photo"); }
  } else return failure("unreviewed_photo");
  const { model, ocrModel } = options;
  if (![model, ocrModel].every((value) => /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,100}$/.test(value) && !/^sk-/i.test(value))) return failure("not_configured");
  let prepared: [
    PillPhotoPreprocessingVariants | PillPhonePhotoPreprocessingVariants,
    PillPhotoPreprocessingVariants | PillPhonePhotoPreprocessingVariants,
  ];
  try {
    const prepare = photoSet === "phone_validation" || photoSet === "phone_holdout"
      ? prepareValidatedPhonePillPhotoVariants
      : prepareValidatedPillPhotoVariants;
    prepared = [await prepare(photos[0], expectations[0]), await prepare(photos[1], expectations[1])];
    return await preparePillPhotoVariantRequests(photos, prepared, { model, ocrModel, visionPromptVersion, ocrPromptVersion });
  } catch { return failure("invalid_photo"); }
}

/**
 * OCR-only experiment entry point: rechecks original reviewed bytes and never sends the prepared Vision request.
 * No environment credential lookup; callers must explicitly opt in and provide the key.
 */
export async function extractReviewedPillPhotoOcr(
  photos: readonly [Uint8Array, Uint8Array],
  options: { allowExternalTransfer?: boolean; apiKey?: string; ocrModel?: string; photoSet?: ReviewedPillPhotoSet;
    ocrPromptVersion?: PillPhotoOcrPromptVersion; fetchImpl?: typeof fetch;
    onPrepared?: (prepared: PreparedPillPhotoRequests) => Promise<void>; onRequestTrace?: RequestObserver } = {},
): Promise<PhotoOcrExtractionResult> {
  if (options.allowExternalTransfer !== true) return { ok: false, reason: "transfer_not_confirmed" };
  const prepared = await prepareReviewedPillPhotoRequests(photos, {
    model: options.ocrModel ?? "gpt-5.6-sol", ocrModel: options.ocrModel ?? "gpt-5.6-sol",
    photoSet: options.photoSet, ocrPromptVersion: options.ocrPromptVersion,
  });
  if (!prepared.ok) return prepared;
  if (!options.apiKey?.trim()) return { ok: false, reason: "not_configured" };
  await options.onPrepared?.(structuredClone(prepared));
  return extractPreparedPillPhotoOcr(prepared, options);
}

/** Every network path enforces a fixed reviewed-manifest hash allowlist and explicit opt-in. */
export async function extractReviewedPillPhotos(
  photos: readonly [Uint8Array, Uint8Array],
  options: { allowExternalTransfer?: boolean; apiKey?: string; model?: string; ocrModel?: string; fetchImpl?: typeof fetch;
    visionPromptVersion?: PillPhotoVisionPromptVersion;
    ocrPromptVersion?: PillPhotoOcrPromptVersion;
    photoSet?: ReviewedPillPhotoSet; onPrepared?: (prepared: PreparedPillPhotoRequests) => Promise<void>;
    onRequestTrace?: RequestObserver } = {},
): Promise<PhotoExtractionResult> {
  if (options.allowExternalTransfer !== true) return { ok: false, reason: "transfer_not_confirmed" };
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const prepared = await prepareReviewedPillPhotoRequests(photos, {
    visionPromptVersion: options.visionPromptVersion,
    ocrPromptVersion: options.ocrPromptVersion,
    photoSet: options.photoSet, model: options.model ?? process.env.OPENAI_MODEL ?? "gpt-5.6-luna",
    ocrModel: options.ocrModel ?? process.env.OPENAI_OCR_MODEL ?? "gpt-5.6-sol",
  });
  if (!prepared.ok) return prepared;
  if (!apiKey?.trim()) return { ok: false, reason: "not_configured" };
  // Callbacks receive a copy and cannot modify the buffers/requests subsequently transmitted.
  await options.onPrepared?.(structuredClone(prepared));
  return extractPreparedPillPhotos(prepared, { ...options, apiKey });
}

export const pillPhotoExperimentVersions = {
  review: PILL_PHOTO_REVIEW_VERSION, preprocessing: PILL_PHOTO_PREPROCESSING_VERSION,
  phonePreprocessing: PILL_PHONE_PHOTO_PREPROCESSING_VERSION,
  prompt: PILL_PHOTO_PROMPT_VERSION, ocrPrompt: PILL_PHOTO_OCR_PROMPT_VERSION,
  fusion: PILL_PHOTO_FUSION_VERSION, maskPolicy: PILL_PHOTO_MASK_POLICY_VERSION,
} as const;
