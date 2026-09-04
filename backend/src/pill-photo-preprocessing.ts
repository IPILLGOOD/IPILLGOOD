// Deterministic preprocessing for reviewed public evaluation images only.
// External-transfer callers must still enforce their own fixed source allowlist before using these buffers.
import { createHash } from "node:crypto";
import sharp from "sharp";

export const PILL_PHOTO_VARIANT_PREPROCESSING_VERSION = "pill-photo-alpha-pca-detail-contrast-v1";
export const PILL_PHONE_PHOTO_PREPROCESSING_VERSION = "pill-phone-centered-detail-contrast-v1";
export const PILL_PHOTO_CONTEXT_MAX_EDGE = 1280;
export const PILL_PHOTO_DETAIL_EDGE = 1600;
export const PILL_PHONE_PHOTO_DETAIL_EDGE = 1024;
export const PILL_PHOTO_MIN_AXIS_ELONGATION = 1.2;
export const PILL_PHONE_PHOTO_CENTER_CROP_RATIO = 0.4;
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_PIXELS = 25_000_000;
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 } as const;
const WHITE = { r: 255, g: 255, b: 255 } as const;

export interface ValidatedPillPhotoExpectation {
  bytes: number;
  sha256: string;
}

export interface PillPhotoVariantInfo {
  width: number;
  height: number;
  channels: number;
  sha256: string;
}

export interface PillPhotoPreprocessingMetadata {
  version: string;
  source: {
    width: number;
    height: number;
    alphaBounds: { left: number; top: number; width: number; height: number };
  };
  orientation: {
    method: "alpha_weighted_principal_axis";
    textOrientationDegreesToEvaluate: readonly [0, 90, 180, 270];
    axisAngleDegrees: number;
    appliedRotationDegrees: number;
    elongation: number;
    minimumElongation: number;
    applied: boolean;
    reason: "elongated_mask" | "round_or_uncertain_mask";
  };
  variants: {
    context: PillPhotoVariantInfo;
    alignedColor: PillPhotoVariantInfo;
    alignedContrast: PillPhotoVariantInfo;
  };
}

export interface PillPhotoPreprocessingVariants {
  context: Buffer;
  alignedColor: Buffer;
  alignedContrast: Buffer;
  metadata: PillPhotoPreprocessingMetadata;
}

export interface PillPhonePhotoPreprocessingMetadata {
  version: typeof PILL_PHONE_PHOTO_PREPROCESSING_VERSION;
  source: { width: number; height: number; format: "jpeg" };
  crop: {
    method: "centered_square_ratio";
    ratio: number;
    bounds: { left: number; top: number; width: number; height: number };
  };
  orientation: {
    method: "cardinal_ocr_views_only";
    textOrientationDegreesToEvaluate: readonly [0, 90, 180, 270];
  };
  variants: {
    context: PillPhotoVariantInfo;
    alignedColor: PillPhotoVariantInfo;
    alignedContrast: PillPhotoVariantInfo;
  };
}

export interface PillPhonePhotoPreprocessingVariants {
  context: Buffer;
  alignedColor: Buffer;
  alignedContrast: Buffer;
  metadata: PillPhonePhotoPreprocessingMetadata;
}

export type PillPhotoOcrRotationViews = readonly [Buffer, Buffer, Buffer, Buffer];

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const rounded = (value: number) => Number(value.toFixed(6));

async function variantInfo(bytes: Buffer): Promise<PillPhotoVariantInfo> {
  const metadata = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "warning" }).metadata();
  if (metadata.format !== "png" || metadata.hasAlpha || !metadata.width || !metadata.height || !metadata.channels) {
    throw new Error("invalid_preprocessed_photo");
  }
  return { width: metadata.width, height: metadata.height, channels: metadata.channels, sha256: sha256(bytes) };
}

/** Hash/size validation is mandatory; the expectation must come from a reviewed, fixed manifest. */
export async function prepareValidatedPillPhotoVariants(
  input: Uint8Array,
  expected: ValidatedPillPhotoExpectation,
): Promise<PillPhotoPreprocessingVariants> {
  if (!(input instanceof Uint8Array) || input.length < 1 || input.length > MAX_INPUT_BYTES
    || !Number.isSafeInteger(expected.bytes) || expected.bytes < 1 || expected.bytes > MAX_INPUT_BYTES
    || !/^[a-f0-9]{64}$/.test(expected.sha256)
    || input.length !== expected.bytes || sha256(input) !== expected.sha256) {
    throw new Error("unreviewed_photo");
  }

  const source = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "warning" });
  const sourceMetadata = await source.metadata();
  if (sourceMetadata.format !== "png" || !sourceMetadata.hasAlpha || (sourceMetadata.pages ?? 1) !== 1
    || !sourceMetadata.width || !sourceMetadata.height) throw new Error("invalid_photo");
  const { data, info } = await source.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4 || info.width * info.height > MAX_INPUT_PIXELS) throw new Error("invalid_photo");

  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  let totalWeight = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * info.channels;
      const alpha = data[offset + 3]!;
      if (alpha === 0) {
        // Remove hidden RGB so transparent trim and rotation cannot reveal source metadata pixels.
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
        continue;
      }
      const weight = alpha / 255;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      totalWeight += weight;
      sumX += x * weight;
      sumY += y * weight;
      sumXX += x * x * weight;
      sumYY += y * y * weight;
      sumXY += x * y * weight;
    }
  }
  if (right < left || bottom < top || totalWeight <= 0) throw new Error("invalid_photo");

  const meanX = sumX / totalWeight;
  const meanY = sumY / totalWeight;
  const varianceX = Math.max(0, sumXX / totalWeight - meanX * meanX);
  const varianceY = Math.max(0, sumYY / totalWeight - meanY * meanY);
  const covariance = sumXY / totalWeight - meanX * meanY;
  const discriminant = Math.sqrt((varianceX - varianceY) ** 2 + 4 * covariance ** 2);
  const major = Math.max(0, (varianceX + varianceY + discriminant) / 2);
  const minor = Math.max(0, (varianceX + varianceY - discriminant) / 2);
  const elongation = minor > 0 ? Math.sqrt(major / minor) : Number.POSITIVE_INFINITY;
  const axisAngleDegrees = 0.5 * Math.atan2(2 * covariance, varianceX - varianceY) * 180 / Math.PI;
  const rotationApplied = Number.isFinite(elongation) && elongation >= PILL_PHOTO_MIN_AXIS_ELONGATION;
  const appliedRotationDegrees = rotationApplied ? -axisAngleDegrees : 0;
  const bounds = { left, top, width: right - left + 1, height: bottom - top + 1 };
  const margin = Math.max(8, Math.min(128, Math.round(Math.max(bounds.width, bounds.height) * 0.05)));

  // Re-encode the sanitized crop before variants: EXIF/XMP/text chunks and hidden RGB are removed.
  const cropped = await sharp(data, { raw: info }).extract(bounds).png({ compressionLevel: 9 }).toBuffer();
  const trimmedContext = sharp(cropped, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "warning" })
    .trim({ background: TRANSPARENT, threshold: 1, margin });
  const alignedBase = await sharp(cropped, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "warning" })
    .rotate(appliedRotationDegrees, { background: TRANSPARENT })
    .trim({ background: TRANSPARENT, threshold: 1, margin })
    .png({ compressionLevel: 9 })
    .toBuffer();

  const context = await trimmedContext
    .flatten({ background: WHITE })
    .resize({ width: PILL_PHOTO_CONTEXT_MAX_EDGE, height: PILL_PHOTO_CONTEXT_MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const alignedColor = await sharp(alignedBase, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "warning" })
    .flatten({ background: WHITE })
    .resize({ width: PILL_PHOTO_DETAIL_EDGE, height: PILL_PHOTO_DETAIL_EDGE, fit: "inside" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const alignedContrast = await sharp(alignedBase, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "warning" })
    .flatten({ background: WHITE })
    .resize({ width: PILL_PHOTO_DETAIL_EDGE, height: PILL_PHOTO_DETAIL_EDGE, fit: "inside" })
    .greyscale()
    .normalise({ lower: 1, upper: 99 })
    .sharpen({ sigma: 1, m1: 1, m2: 2, x1: 2, y2: 10, y3: 20 })
    .toColourspace("b-w")
    .png({ compressionLevel: 9 })
    .toBuffer();

  const [contextInfo, alignedColorInfo, alignedContrastInfo] = await Promise.all([
    variantInfo(context), variantInfo(alignedColor), variantInfo(alignedContrast),
  ]);
  return {
    context,
    alignedColor,
    alignedContrast,
    metadata: {
      version: PILL_PHOTO_VARIANT_PREPROCESSING_VERSION,
      source: { width: info.width, height: info.height, alphaBounds: bounds },
      orientation: {
        method: "alpha_weighted_principal_axis",
        // A mask principal axis has no text direction, and some official imprints run across the pill axis.
        // The OCR stage must therefore evaluate all four cardinal orientations of the aligned buffer.
        textOrientationDegreesToEvaluate: [0, 90, 180, 270],
        axisAngleDegrees: rounded(axisAngleDegrees),
        appliedRotationDegrees: rounded(appliedRotationDegrees),
        elongation: Number.isFinite(elongation) ? rounded(elongation) : Number.MAX_SAFE_INTEGER,
        minimumElongation: PILL_PHOTO_MIN_AXIS_ELONGATION,
        applied: rotationApplied,
        reason: rotationApplied ? "elongated_mask" : "round_or_uncertain_mask",
      },
      variants: { context: contextInfo, alignedColor: alignedColorInfo, alignedContrast: alignedContrastInfo },
    },
  };
}

/**
 * Initial smartphone baseline. It removes metadata and uses a fixed center crop only;
 * no label, imprint, color, or product information influences the crop. A later
 * segmentation version may replace this after the baseline is recorded.
 */
export async function prepareValidatedPhonePillPhotoVariants(
  input: Uint8Array,
  expected: ValidatedPillPhotoExpectation,
): Promise<PillPhonePhotoPreprocessingVariants> {
  if (!(input instanceof Uint8Array) || input.length < 1 || input.length > MAX_INPUT_BYTES
    || !Number.isSafeInteger(expected.bytes) || expected.bytes < 1 || expected.bytes > MAX_INPUT_BYTES
    || !/^[a-f0-9]{64}$/.test(expected.sha256)
    || input.length !== expected.bytes || sha256(input) !== expected.sha256) {
    throw new Error("unreviewed_photo");
  }
  const source = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "warning" });
  const metadata = await source.metadata();
  if (metadata.format !== "jpeg" || metadata.hasAlpha || (metadata.pages ?? 1) !== 1
    || !metadata.width || !metadata.height || metadata.width * metadata.height > MAX_INPUT_PIXELS) {
    throw new Error("invalid_photo");
  }

  // Auto-orient from pixels, then re-read dimensions so EXIF cannot affect later stages.
  const oriented = await source.rotate().jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer();
  const orientedMetadata = await sharp(oriented, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "warning" }).metadata();
  if (!orientedMetadata.width || !orientedMetadata.height) throw new Error("invalid_photo");
  const cropEdge = Math.max(64, Math.floor(Math.min(orientedMetadata.width, orientedMetadata.height)
    * PILL_PHONE_PHOTO_CENTER_CROP_RATIO));
  const bounds = {
    left: Math.floor((orientedMetadata.width - cropEdge) / 2),
    top: Math.floor((orientedMetadata.height - cropEdge) / 2),
    width: cropEdge,
    height: cropEdge,
  };
  const detailBase = sharp(oriented, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "warning" }).extract(bounds);
  const context = await sharp(oriented, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "warning" })
    .resize({ width: PILL_PHOTO_CONTEXT_MAX_EDGE, height: PILL_PHOTO_CONTEXT_MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const alignedColor = await detailBase
    .clone()
    .resize({ width: PILL_PHONE_PHOTO_DETAIL_EDGE, height: PILL_PHONE_PHOTO_DETAIL_EDGE, fit: "inside" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const alignedContrast = await detailBase
    .clone()
    .resize({ width: PILL_PHONE_PHOTO_DETAIL_EDGE, height: PILL_PHONE_PHOTO_DETAIL_EDGE, fit: "inside" })
    .greyscale()
    .normalise({ lower: 1, upper: 99 })
    .sharpen({ sigma: 1, m1: 1, m2: 2, x1: 2, y2: 10, y3: 20 })
    .toColourspace("b-w")
    .png({ compressionLevel: 9 })
    .toBuffer();
  const [contextInfo, alignedColorInfo, alignedContrastInfo] = await Promise.all([
    variantInfo(context), variantInfo(alignedColor), variantInfo(alignedContrast),
  ]);
  return {
    context,
    alignedColor,
    alignedContrast,
    metadata: {
      version: PILL_PHONE_PHOTO_PREPROCESSING_VERSION,
      source: { width: orientedMetadata.width, height: orientedMetadata.height, format: "jpeg" },
      crop: { method: "centered_square_ratio", ratio: PILL_PHONE_PHOTO_CENTER_CROP_RATIO, bounds },
      orientation: { method: "cardinal_ocr_views_only", textOrientationDegreesToEvaluate: [0, 90, 180, 270] },
      variants: { context: contextInfo, alignedColor: alignedColorInfo, alignedContrast: alignedContrastInfo },
    },
  };
}

/** OCR must not assume that the pill axis is the text axis or that the principal-axis direction is upright. */
export async function preparePillPhotoOcrRotationViews(alignedView: Uint8Array): Promise<PillPhotoOcrRotationViews> {
  const metadata = await sharp(alignedView, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "warning" }).metadata();
  if (metadata.format !== "png" || metadata.hasAlpha || ![1, 3].includes(metadata.channels ?? 0) || !metadata.width || !metadata.height) {
    throw new Error("invalid_preprocessed_photo");
  }
  const rotations = await Promise.all([0, 90, 180, 270].map((degrees) => {
    if (degrees === 0) return Buffer.from(alignedView);
    const rotated = sharp(alignedView, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "warning" }).rotate(degrees);
    return (metadata.channels === 1 ? rotated.toColourspace("b-w") : rotated)
      .png({ compressionLevel: 9 }).toBuffer();
  }));
  return [rotations[0]!, rotations[1]!, rotations[2]!, rotations[3]!];
}
