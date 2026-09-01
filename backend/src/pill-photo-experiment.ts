// Node-only, reviewed PUBLIC fixtures only. Do not expose this experiment as a user-upload API (#61/#88).
import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { PILL_PHOTO_FILES, PILL_PHOTO_REVIEW_VERSION } from "../test-support/pill-photo-review.ts";
import { PILL_PHOTO_INSTRUCTIONS, PILL_PHOTO_PROMPT_VERSION, pillPhotoFeaturesSchema, type PillPhotoFeatures } from "./pill-photo-features.ts";
import {
  PILL_PHOTO_FUSION_VERSION,
  PILL_PHOTO_OCR_INSTRUCTIONS,
  PILL_PHOTO_OCR_PROMPT_VERSION,
  PILL_PHOTO_OCR_SCHEMA_VERSION,
  fusePillPhotoSignals,
  pillPhotoOcrFeaturesSchema,
  pillPhotoOcrSideResponseSchema,
  type PillPhotoFusionEvidence,
  type PillPhotoOcrFeatures,
  type PillPhotoOcrSideResponse,
} from "./pill-photo-ocr.ts";
import {
  PILL_PHOTO_VARIANT_PREPROCESSING_VERSION,
  preparePillPhotoOcrRotationViews,
  prepareValidatedPillPhotoVariants,
  type ValidatedPillPhotoExpectation,
  type PillPhotoOcrRotationViews,
  type PillPhotoPreprocessingVariants,
} from "./pill-photo-preprocessing.ts";

export const PILL_PHOTO_PREVIEW_PREPROCESSING_VERSION = "public-rgba-alpha-bounds-white-1024-v1";
export const PILL_PHOTO_PREPROCESSING_VERSION = PILL_PHOTO_VARIANT_PREPROCESSING_VERSION;
export const PILL_PHOTO_MASK_POLICY_VERSION = "reviewed-alpha-solidity-v1";
export const MIN_REVIEWED_PILL_MASK_SOLIDITY = 0.92;
const ENDPOINT = "https://api.openai.com/v1/responses";
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_OUTPUT_TEXT = 16 * 1024;
const MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024;
export const PILL_PHOTO_TIMEOUT_MS = 90_000;
type PhotoFailure = "transfer_not_confirmed" | "unreviewed_photo" | "invalid_photo" | "duplicate_photo" | "not_configured" | "refused" | "incomplete_response" | "invalid_response" | "invalid_request" | "access_denied" | "rate_limited" | "provider_unavailable" | "timeout" | "network_error" | "ocr_failed" | "fusion_failed";
type Usage = { inputTokens: number; outputTokens: number };
export type ReviewedPillPhotoSet = "development" | "evaluation";
type ReviewedPillPhotoExpectation = ValidatedPillPhotoExpectation & { path: string };
let evaluationPhotoAllowlistPromise: Promise<readonly ReviewedPillPhotoExpectation[]> | undefined;

function evaluationPhotoAllowlist() {
  evaluationPhotoAllowlistPromise ??= import("../test-support/pill-photo-evaluation.ts")
    .then(({ loadPillPhotoEvaluationFixture }) => loadPillPhotoEvaluationFixture())
    .then(({ manifest }) => manifest.images);
  return evaluationPhotoAllowlistPromise;
}
export interface PhotoExtractionSignals {
  vision: { features: PillPhotoFeatures; usage: Usage | null };
  ocr: { features: PillPhotoOcrFeatures; usage: Usage | null };
  fusion: PillPhotoFusionEvidence;
}
export type PhotoExtractionResult =
  | { ok: true; features: PillPhotoFeatures; usage: Usage | null; signals?: PhotoExtractionSignals }
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

/** Fixed public development allowlist wrapper. The current model request still uses the historical single view. */
export async function prepareReviewedPillPhotoVariants(bytes: Uint8Array) {
  const index = reviewedPhotoIndex(bytes);
  if (index < 0) throw new Error("unreviewed_photo");
  return prepareValidatedPillPhotoVariants(bytes, PILL_PHOTO_FILES[index]!);
}

const inputImage = (bytes: Buffer) => ({
  type: "input_image" as const,
  image_url: `data:image/png;base64,${bytes.toString("base64")}`,
  detail: "high" as const,
});

/** General visual observation over context and aligned-color views. The repeated views are one pill per side. */
export function pillPhotoRequest(
  first: Pick<PillPhotoPreprocessingVariants, "context" | "alignedColor">,
  second: Pick<PillPhotoPreprocessingVariants, "context" | "alignedColor">,
  model: string,
) {
  return {
    model, store: false, max_output_tokens: 2400, reasoning: { effort: "low" },
    instructions: PILL_PHOTO_INSTRUCTIONS,
    input: [{ role: "user", content: [
      { type: "input_text", text: "Image A context and aligned-color detail show the same first surface. Do not count them twice:" },
      inputImage(first.context), inputImage(first.alignedColor),
      { type: "input_text", text: "Image B context and aligned-color detail show the same second surface. Do not count them twice:" },
      inputImage(second.context), inputImage(second.alignedColor),
    ] }],
    text: { format: { type: "json_schema", name: "pill_visible_features", strict: true, schema: z.toJSONSchema(pillPhotoFeaturesSchema) } },
  };
}

/** Imprint-only request for one surface, with color and contrast views at four cardinal rotations. */
export function pillPhotoOcrRequest(
  color: PillPhotoOcrRotationViews,
  contrast: PillPhotoOcrRotationViews,
  model: string,
) {
  return {
    model, store: false, max_output_tokens: 1400, reasoning: { effort: "low" },
    instructions: PILL_PHOTO_OCR_INSTRUCTIONS,
    input: [{ role: "user", content: [
      { type: "input_text", text: "Color rotations of one surface in this exact order: 0, 90, 180, 270 degrees." },
      ...color.map(inputImage),
      { type: "input_text", text: "Contrast-enhanced rotations of that same surface in this exact order: 0, 90, 180, 270 degrees." },
      ...contrast.map(inputImage),
    ] }],
    text: { format: { type: "json_schema", name: "pill_imprint_ocr_side", strict: true, schema: z.toJSONSchema(pillPhotoOcrSideResponseSchema) } },
  };
}

type ParsedProviderText = { ok: true; text: string; usage: Usage | null }
  | { ok: false; reason: "refused" | "incomplete_response" | "invalid_response" };

function parseProviderText(value: unknown): ParsedProviderText {
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
  const usage = z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }).safeParse(response.usage);
  return { ok: true, text: texts[0]!, usage: usage.success ? { inputTokens: usage.data.input_tokens, outputTokens: usage.data.output_tokens } : null };
}

export function parsePillPhotoResponse(value: unknown): PhotoExtractionResult {
  const output = parseProviderText(value);
  if (!output.ok) return output;
  try {
    const parsed = pillPhotoFeaturesSchema.safeParse(JSON.parse(output.text));
    if (!parsed.success) return { ok: false, reason: "invalid_response" };
    return { ok: true, features: parsed.data, usage: output.usage };
  } catch { return { ok: false, reason: "invalid_response" }; }
}

export function parsePillPhotoOcrResponse(value: unknown):
  | { ok: true; features: PillPhotoOcrSideResponse; usage: Usage | null }
  | { ok: false; reason: "refused" | "incomplete_response" | "ocr_failed" } {
  const output = parseProviderText(value);
  if (!output.ok) return { ok: false, reason: output.reason === "invalid_response" ? "ocr_failed" : output.reason };
  try {
    const parsed = pillPhotoOcrSideResponseSchema.safeParse(JSON.parse(output.text));
    return parsed.success
      ? { ok: true, features: parsed.data, usage: output.usage }
      : { ok: false, reason: "ocr_failed" };
  } catch { return { ok: false, reason: "ocr_failed" }; }
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

async function requestPillPhotoProvider(
  body: unknown,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; value: unknown } | { ok: false; reason: PhotoFailure }> {
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized, "utf8") > MAX_REQUEST_BODY_BYTES) return { ok: false, reason: "invalid_photo" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PILL_PHOTO_TIMEOUT_MS);
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: "POST", redirect: "error", signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: serialized,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, reason: response.status === 400 || response.status === 422 ? "invalid_request" : response.status === 401 || response.status === 403 ? "access_denied" : response.status === 429 ? "rate_limited" : "provider_unavailable" };
    }
    if (response.redirected || response.url && response.url !== ENDPOINT) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, reason: "invalid_response" };
    }
    try { return { ok: true, value: await boundedResponse(response) }; }
    catch { return { ok: false, reason: controller.signal.aborted ? "timeout" : "invalid_response" }; }
  } catch { return { ok: false, reason: controller.signal.aborted ? "timeout" : "network_error" }; }
  finally { clearTimeout(timer); }
}

function totalUsage(first: Usage | null, second: Usage | null): Usage | null {
  return first && second
    ? { inputTokens: first.inputTokens + second.inputTokens, outputTokens: first.outputTokens + second.outputTokens }
    : null;
}

/** All current network paths enforce the compiled public-image hash allowlist and explicit opt-in. */
export async function extractReviewedPillPhotos(
  photos: readonly [Uint8Array, Uint8Array],
  options: { allowExternalTransfer?: boolean; apiKey?: string; model?: string; ocrModel?: string; fetchImpl?: typeof fetch; photoSet?: ReviewedPillPhotoSet } = {},
): Promise<PhotoExtractionResult> {
  if (options.allowExternalTransfer !== true) return { ok: false, reason: "transfer_not_confirmed" };
  if (!Array.isArray(photos) || photos.length !== 2) return { ok: false, reason: "unreviewed_photo" };
  const photoSet = options.photoSet ?? "development";
  let expectations: readonly [ReviewedPillPhotoExpectation, ReviewedPillPhotoExpectation];
  if (photoSet === "development") {
    const indexes = [reviewedPhotoIndex(photos[0]), reviewedPhotoIndex(photos[1])] as const;
    if (indexes.some((index) => index < 0)) return { ok: false, reason: "unreviewed_photo" };
    if (indexes[0] === indexes[1]) return { ok: false, reason: "duplicate_photo" };
    expectations = [PILL_PHOTO_FILES[indexes[0]]!, PILL_PHOTO_FILES[indexes[1]]!];
  } else if (photoSet === "evaluation") {
    try {
      const allowlist = await evaluationPhotoAllowlist();
      const entries = photos.map((bytes) => {
        const digest = createHash("sha256").update(bytes).digest("hex");
        return allowlist.find((image) => image.bytes === bytes.length && image.sha256 === digest);
      });
      if (!entries[0] || !entries[1]) return { ok: false, reason: "unreviewed_photo" };
      if (entries[0].path === entries[1].path) return { ok: false, reason: "duplicate_photo" };
      expectations = [entries[0], entries[1]];
    } catch { return { ok: false, reason: "unreviewed_photo" }; }
  } else return { ok: false, reason: "unreviewed_photo" };
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const model = options.model ?? process.env.OPENAI_MODEL ?? "gpt-5.6-luna";
  const ocrModel = options.ocrModel ?? process.env.OPENAI_OCR_MODEL ?? "gpt-5.6-sol";
  if (!apiKey?.trim() || ![model, ocrModel].every((value) => /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,100}$/.test(value))) return { ok: false, reason: "not_configured" };
  let prepared: [PillPhotoPreprocessingVariants, PillPhotoPreprocessingVariants];
  let ocrViews: [
    { color: PillPhotoOcrRotationViews; contrast: PillPhotoOcrRotationViews },
    { color: PillPhotoOcrRotationViews; contrast: PillPhotoOcrRotationViews },
  ];
  try {
    prepared = [
      await prepareValidatedPillPhotoVariants(photos[0], expectations[0]),
      await prepareValidatedPillPhotoVariants(photos[1], expectations[1]),
    ];
    ocrViews = [
      {
        color: await preparePillPhotoOcrRotationViews(prepared[0].alignedColor),
        contrast: await preparePillPhotoOcrRotationViews(prepared[0].alignedContrast),
      },
      {
        color: await preparePillPhotoOcrRotationViews(prepared[1].alignedColor),
        contrast: await preparePillPhotoOcrRotationViews(prepared[1].alignedContrast),
      },
    ];
  }
  catch { return { ok: false, reason: "invalid_photo" }; }
  const fetchImpl = options.fetchImpl ?? fetch;
  const visionResponse = await requestPillPhotoProvider(pillPhotoRequest(prepared[0], prepared[1], model), apiKey, fetchImpl);
  if (!visionResponse.ok) return visionResponse;
  const vision = parsePillPhotoResponse(visionResponse.value);
  if (!vision.ok) return vision;
  const firstOcrResponse = await requestPillPhotoProvider(pillPhotoOcrRequest(ocrViews[0].color, ocrViews[0].contrast, ocrModel), apiKey, fetchImpl);
  if (!firstOcrResponse.ok) return firstOcrResponse;
  const firstOcr = parsePillPhotoOcrResponse(firstOcrResponse.value);
  if (!firstOcr.ok) return firstOcr;
  const secondOcrResponse = await requestPillPhotoProvider(pillPhotoOcrRequest(ocrViews[1].color, ocrViews[1].contrast, ocrModel), apiKey, fetchImpl);
  if (!secondOcrResponse.ok) return secondOcrResponse;
  const secondOcr = parsePillPhotoOcrResponse(secondOcrResponse.value);
  if (!secondOcr.ok) return secondOcr;
  try {
    const ocrFeatures = pillPhotoOcrFeaturesSchema.parse({
      schemaVersion: PILL_PHOTO_OCR_SCHEMA_VERSION,
      front: firstOcr.features.side,
      back: secondOcr.features.side,
    });
    const ocrUsage = totalUsage(firstOcr.usage, secondOcr.usage);
    const fused = fusePillPhotoSignals(vision.features, ocrFeatures);
    return {
      ok: true,
      features: fused.features,
      usage: totalUsage(vision.usage, ocrUsage),
      signals: {
        vision: { features: vision.features, usage: vision.usage },
        ocr: { features: ocrFeatures, usage: ocrUsage },
        fusion: fused.evidence,
      },
    };
  } catch { return { ok: false, reason: "fusion_failed" }; }
}

export const pillPhotoExperimentVersions = {
  review: PILL_PHOTO_REVIEW_VERSION, preprocessing: PILL_PHOTO_PREPROCESSING_VERSION,
  prompt: PILL_PHOTO_PROMPT_VERSION, ocrPrompt: PILL_PHOTO_OCR_PROMPT_VERSION,
  fusion: PILL_PHOTO_FUSION_VERSION, maskPolicy: PILL_PHOTO_MASK_POLICY_VERSION,
} as const;
