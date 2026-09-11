// Cloudflare-compatible upload contract. No fs, Sharp, credentials or image persistence.
import { createHash } from "node:crypto";
import { pillPhotoRequest, pillPhotoOcrRequest, extractPreparedPillPhotos } from "./pill-photo-provider.ts";
import { comparePillPhotoFeatures } from "./pill-photo-features.ts";
import { searchPillCandidateChunks, type PillSearchResult } from "./pill-identification.ts";
import type { OfficialPillItem } from "./official-pill-catalog.ts";
export type { PillSearchResult, PillCandidate } from "./pill-identification.ts";
import { PILL_WEB_PREPROCESSING_VERSION, PILL_WEB_MAX_BODY_BYTES, PILL_WEB_IMAGE_NAMES } from "./pill-photo-web-contract.ts";
export * from "./pill-photo-web-contract.ts";
export type PillWebResult = {
  status: "completed"; comparison: ReturnType<typeof comparePillPhotoFeatures>;
  catalog: { version: string; verifiedAt: string; totalCount: number };
  preprocessingVersion: typeof PILL_WEB_PREPROCESSING_VERSION;
};

/** Validate browser JPEG framing/dimensions and reject metadata; the provider still decodes pixels. */
export function validatePillWebJpeg(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes.length > 512 * 1024 || bytes[0] !== 255 || bytes[1] !== 216
    || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw new Error("invalid_photo");
  let at = 2; let width = 0; let height = 0;
  while (at < bytes.length - 2) {
    if (bytes[at++] !== 255) throw new Error("invalid_photo");
    while (bytes[at] === 255) at++;
    const marker = bytes[at++];
    if (marker === 218) {
      if (!width || !height) throw new Error("invalid_photo");
      return { width, height };
    }
    if (marker === undefined || marker === 225 || marker === 237 || marker === 254) throw new Error("invalid_photo");
    const length = ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
    if (length < 2 || at + length > bytes.length - 2) throw new Error("invalid_photo");
    if ([192, 193, 194].includes(marker)) {
      if (length < 8 || width) throw new Error("invalid_photo");
      height = (bytes[at + 3]! << 8) | bytes[at + 4]!;
      width = (bytes[at + 5]! << 8) | bytes[at + 6]!;
      if (width < 64 || height < 64 || width > 1024 || height > 1024) throw new Error("invalid_photo");
    }
    at += length;
  }
  throw new Error("invalid_photo");
}
export async function parsePillWebUpload(form: FormData) {
  if (form.get("consent") !== "true" || form.get("version") !== PILL_WEB_PREPROCESSING_VERSION) throw new Error("consent_required");
  const allowed = new Set([...PILL_WEB_IMAGE_NAMES, "consent", "version"]);
  const keys = [...form.keys()];
  if (keys.length !== allowed.size || new Set(keys).size !== keys.length || keys.some(key => !allowed.has(key))) throw new Error("invalid_photo");
  const images: Record<string, Buffer> = {};
  let total = 0;
  for (const name of PILL_WEB_IMAGE_NAMES) {
    const file = form.get(name);
    if (!(file instanceof File) || file.type !== "image/jpeg" || file.size > 512 * 1024) throw new Error("invalid_photo");
    total += file.size;
    if (total > PILL_WEB_MAX_BODY_BYTES) throw new Error("invalid_photo");
    const bytes = Buffer.from(await file.arrayBuffer());
    const size = validatePillWebJpeg(bytes);
    if (!name.endsWith("context") && (size.width !== 768 || size.height !== 768)) throw new Error("invalid_photo");
    images[name] = bytes;
  }
  const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  if (digest(images["front-context"]!) === digest(images["back-context"]!)) throw new Error("duplicate_photo");
  return images;
}
export async function analyzePillWebPhotos(images: Record<string, Buffer>, options: {
  apiKey: string; model: string; catalog: { version: string; verifiedAt: string; totalCount: number };
  chunks: () => AsyncIterable<readonly OfficialPillItem[]>; fetchImpl?: typeof fetch;
}): Promise<PillWebResult> {
  const side = (name: string) => ({ context: images[`${name}-context`]!, alignedColor: images[`${name}-color-0`]! });
  const views = (side: string, kind: string) => [0, 90, 180, 270].map(angle => images[`${side}-${kind}-${angle}`]!) as [Buffer, Buffer, Buffer, Buffer];
  const extraction = await extractPreparedPillPhotos({ ok: true, sourceSha256: [], preprocessing: [], requests: {
    vision: pillPhotoRequest(side("front"), side("back"), options.model),
    ocrFront: pillPhotoOcrRequest(views("front", "color"), views("front", "contrast"), options.model),
    ocrBack: pillPhotoOcrRequest(views("back", "color"), views("back", "contrast"), options.model),
  } }, { apiKey: options.apiKey, allowExternalTransfer: true, executionMode: "parallel", fetchImpl: options.fetchImpl });
  if (!extraction.ok) throw new Error(extraction.reason);
  // Apply the same pair/artifact gates before reading any catalog chunks.
  let comparison = comparePillPhotoFeatures(extraction.features, { items: [], totalCount: 0, completeness: "complete", version: options.catalog.version });
  if (comparison.status === "searched") {
    const search: PillSearchResult = await searchPillCandidateChunks(comparison.observation,
      { ...options.catalog, completeness: "complete" }, options.chunks(), { limit: 10, maxVariants: 3000 });
    if (search.status === "unavailable") throw new Error("catalog_unavailable");
    comparison = { ...comparison, search };
  }
  return { status: "completed", comparison, catalog: options.catalog, preprocessingVersion: PILL_WEB_PREPROCESSING_VERSION };
}
