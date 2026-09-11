// Node-only image preprocessing facade. Worker callers use pill-photo-web.
import { createHash } from "node:crypto";
import { preparePhonePillPhotoVariants, preparePillPhotoOcrRotationViews,
  type PillPhotoPreprocessingVariants, type PillPhonePhotoPreprocessingVariants } from "./pill-photo-preprocessing.ts";
import { pillPhotoRequest, pillPhotoOcrRequest, type PreparedPillPhotoRequests } from "./pill-photo-provider.ts";
import type { PillPhotoFailure as PhotoFailure } from "./pill-photo-failures.ts";
import type { PillPhotoVisionPromptVersion } from "./pill-photo-prompt-profiles.ts";
import type { PillPhotoOcrPromptVersion, PillPhotoOcrImageCount } from "./pill-photo-ocr.ts";
export * from "./pill-photo-provider.ts";
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
function requestsWithinLimit(requests: readonly unknown[]) {
  return requests.every((request) => Buffer.byteLength(JSON.stringify(request), "utf8") <= 32 * 1024 * 1024);
}

/** Shared transforms and builders; callers own input provenance and validation. Never transmits. */
export async function preparePillPhotoVariantRequests(
  photos: readonly [Uint8Array, Uint8Array],
  variants: readonly [PillPhotoPreprocessingVariants | PillPhonePhotoPreprocessingVariants, PillPhotoPreprocessingVariants | PillPhonePhotoPreprocessingVariants],
  options: { model: string; ocrModel: string; visionPromptVersion?: PillPhotoVisionPromptVersion;
    ocrPromptVersion?: PillPhotoOcrPromptVersion; ocrImageCount?: PillPhotoOcrImageCount },
): Promise<PreparedPillPhotoRequests> {
  if (options.ocrImageCount !== undefined && options.ocrImageCount !== 4 && options.ocrImageCount !== 8) {
    throw new Error("invalid_ocr_image_count");
  }
  // Both comparison modes perform identical preprocessing; only the request attachments differ.
  const ocrViews = [];
  for (const variant of variants) {
    ocrViews.push({ color: await preparePillPhotoOcrRotationViews(variant.alignedColor),
      contrast: await preparePillPhotoOcrRotationViews(variant.alignedContrast) });
  }
  return { ok: true, sourceSha256: photos.map((bytes) => digest(bytes)),
    preprocessing: variants.map((entry) => entry.metadata),
    requests: {
      vision: pillPhotoRequest(variants[0], variants[1], options.model, options.visionPromptVersion),
      ocrFront: pillPhotoOcrRequest(ocrViews[0]!.color, ocrViews[0]!.contrast, options.ocrModel, options.ocrPromptVersion, options.ocrImageCount),
      ocrBack: pillPhotoOcrRequest(ocrViews[1]!.color, ocrViews[1]!.contrast, options.ocrModel, options.ocrPromptVersion, options.ocrImageCount),
    } };
}

/** Explicit local input: validate new JPEG bytes without registering them in evaluation fixtures. */
export async function preparePhonePillPhotoRequests(
  photos: readonly [Uint8Array, Uint8Array],
  options: { model: string; ocrModel: string; ocrImageCount?: PillPhotoOcrImageCount },
): Promise<PreparedPillPhotoRequests | { ok: false; reason: PhotoFailure }> {
  if (options.ocrImageCount !== undefined && options.ocrImageCount !== 4 && options.ocrImageCount !== 8) {
    return { ok: false, reason: "invalid_request" };
  }
  if (!Array.isArray(photos) || photos.length !== 2
    || photos.some((bytes) => !(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > MAX_INPUT_BYTES)) {
    return { ok: false, reason: "invalid_photo" };
  }
  if (![options.model, options.ocrModel].every((value) => typeof value === "string"
    && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,100}$/.test(value) && !/^sk-/i.test(value))) {
    return { ok: false, reason: "not_configured" };
  }
  // Snapshot caller bytes before asynchronous decoding, so hashes identify the transformed pixels.
  const sources = [Buffer.from(photos[0]), Buffer.from(photos[1])] as const;
  if (digest(sources[0]) === digest(sources[1])) return { ok: false, reason: "duplicate_photo" };
  try {
    const variants = [await preparePhonePillPhotoVariants(sources[0]), await preparePhonePillPhotoVariants(sources[1])] as const;
    const prepared = await preparePillPhotoVariantRequests(sources, variants, options);
    if (!requestsWithinLimit(Object.values(prepared.requests))) {
      return { ok: false, reason: "invalid_photo" };
    }
    return prepared;
  } catch { return { ok: false, reason: "invalid_photo" }; }
}
