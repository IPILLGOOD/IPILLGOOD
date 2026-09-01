// Node-only, reviewed PUBLIC fixtures only. Do not expose this experiment as a user-upload API (#61/#88).
import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { PILL_PHOTO_FILES, PILL_PHOTO_REVIEW_VERSION } from "../test-support/pill-photo-review.ts";
import { PILL_PHOTO_INSTRUCTIONS, PILL_PHOTO_PROMPT_VERSION, pillPhotoFeaturesSchema, type PillPhotoFeatures } from "./pill-photo-features.ts";

export const PILL_PHOTO_PREPROCESSING_VERSION = "public-rgba-alpha-bounds-white-1024-v1";
export const PILL_PHOTO_MASK_POLICY_VERSION = "reviewed-alpha-solidity-v1";
export const MIN_REVIEWED_PILL_MASK_SOLIDITY = 0.92;
const ENDPOINT = "https://api.openai.com/v1/responses";
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_OUTPUT_TEXT = 16 * 1024;
export const PILL_PHOTO_TIMEOUT_MS = 45_000;
type PhotoFailure = "transfer_not_confirmed" | "unreviewed_photo" | "invalid_photo" | "duplicate_photo" | "not_configured" | "refused" | "incomplete_response" | "invalid_response" | "access_denied" | "rate_limited" | "provider_unavailable" | "timeout" | "network_error";
type Usage = { inputTokens: number; outputTokens: number };
export type PhotoExtractionResult =
  | { ok: true; features: PillPhotoFeatures; usage: Usage | null }
  | { ok: false; reason: PhotoFailure };

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

export function pillPhotoRequest(first: Buffer, second: Buffer, model: string) {
  return {
    model, store: false, max_output_tokens: 2400, reasoning: { effort: "low" },
    instructions: PILL_PHOTO_INSTRUCTIONS,
    input: [{ role: "user", content: [
      { type: "input_text", text: "Image A (first view):" },
      { type: "input_image", image_url: `data:image/png;base64,${first.toString("base64")}`, detail: "high" },
      { type: "input_text", text: "Image B (second view):" },
      { type: "input_image", image_url: `data:image/png;base64,${second.toString("base64")}`, detail: "high" },
    ] }],
    text: { format: { type: "json_schema", name: "pill_visible_features", strict: true, schema: z.toJSONSchema(pillPhotoFeaturesSchema) } },
  };
}

export function parsePillPhotoResponse(value: unknown): PhotoExtractionResult {
  if (!value || typeof value !== "object") return { ok: false, reason: "invalid_response" };
  const response = value as { status?: unknown; output?: unknown; usage?: unknown };
  if (response.status !== "completed") return { ok: false, reason: "incomplete_response" };
  if (!Array.isArray(response.output)) return { ok: false, reason: "invalid_response" };
  const texts: string[] = [];
  for (const raw of response.output) {
    if (!raw || typeof raw !== "object") return { ok: false, reason: "invalid_response" };
    const item = raw as { type?: unknown; content?: unknown; role?: unknown; status?: unknown };
    if (item.type === "reasoning") continue;
    if (item.type !== "message" || item.role !== "assistant" || item.status !== "completed" || !Array.isArray(item.content)) {
      return { ok: false, reason: "invalid_response" };
    }
    for (const part of item.content) {
      if (part?.type === "refusal") return { ok: false, reason: "refused" };
      if (part?.type !== "output_text" || typeof part.text !== "string") return { ok: false, reason: "invalid_response" };
      texts.push(part.text);
    }
  }
  if (texts.length !== 1 || texts[0]!.length > MAX_OUTPUT_TEXT) return { ok: false, reason: "invalid_response" };
  try {
    const parsed = pillPhotoFeaturesSchema.safeParse(JSON.parse(texts[0]!));
    if (!parsed.success) return { ok: false, reason: "invalid_response" };
    const usage = z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }).safeParse(response.usage);
    return { ok: true, features: parsed.data, usage: usage.success ? { inputTokens: usage.data.input_tokens, outputTokens: usage.data.output_tokens } : null };
  } catch { return { ok: false, reason: "invalid_response" }; }
}

async function boundedResponse(response: Response): Promise<unknown> {
  const sizeHeader = response.headers.get("content-length");
  if (!/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "")
    || sizeHeader !== null && (!/^\d+$/.test(sizeHeader) || Number(sizeHeader) > MAX_RESPONSE_BYTES) || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("invalid_response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_RESPONSE_BYTES) throw new Error("invalid_response");
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

/** All current network paths enforce the compiled public-image hash allowlist and explicit opt-in. */
export async function extractReviewedPillPhotos(
  photos: readonly [Uint8Array, Uint8Array],
  options: { allowExternalTransfer?: boolean; apiKey?: string; model?: string; fetchImpl?: typeof fetch } = {},
): Promise<PhotoExtractionResult> {
  if (options.allowExternalTransfer !== true) return { ok: false, reason: "transfer_not_confirmed" };
  if (!Array.isArray(photos) || photos.length !== 2 || photos.some((bytes) => reviewedPhotoIndex(bytes) < 0)) return { ok: false, reason: "unreviewed_photo" };
  if (reviewedPhotoIndex(photos[0]) === reviewedPhotoIndex(photos[1])) return { ok: false, reason: "duplicate_photo" };
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const model = options.model ?? process.env.OPENAI_MODEL ?? "gpt-5.6-luna";
  if (!apiKey?.trim() || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,100}$/.test(model)) return { ok: false, reason: "not_configured" };
  let prepared: [Buffer, Buffer];
  try { prepared = [await prepareReviewedPillPhoto(photos[0]), await prepareReviewedPillPhoto(photos[1])]; }
  catch { return { ok: false, reason: "invalid_photo" }; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PILL_PHOTO_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)(ENDPOINT, {
      method: "POST", redirect: "error", signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(pillPhotoRequest(prepared[0], prepared[1], model)),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, reason: response.status === 401 || response.status === 403 ? "access_denied" : response.status === 429 ? "rate_limited" : "provider_unavailable" };
    }
    if (response.redirected || response.url && response.url !== ENDPOINT) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, reason: "invalid_response" };
    }
    try { return parsePillPhotoResponse(await boundedResponse(response)); }
    catch { return { ok: false, reason: controller.signal.aborted ? "timeout" : "invalid_response" }; }
  } catch { return { ok: false, reason: controller.signal.aborted ? "timeout" : "network_error" }; }
  finally { clearTimeout(timer); }
}

export const pillPhotoExperimentVersions = {
  review: PILL_PHOTO_REVIEW_VERSION, preprocessing: PILL_PHOTO_PREPROCESSING_VERSION,
  prompt: PILL_PHOTO_PROMPT_VERSION, maskPolicy: PILL_PHOTO_MASK_POLICY_VERSION,
} as const;
