// Node-only photo processing shared by reviewed experiments and explicit local file tests.
// This module has no manifest allowlist, environment credential lookup, or automatic network calls.
import { createHash } from "node:crypto";
import { z } from "zod";
import type { PillPhotoFailure as PhotoFailure } from "./pill-photo-failures.ts";
import { PILL_PHOTO_PROMPT_VERSION, pillPhotoFeaturesSchema, type PillPhotoFeatures } from "./pill-photo-features.ts";
import { pillPhotoVisionInstructions, type PillPhotoVisionPromptVersion } from "./pill-photo-prompt-profiles.ts";
import {
  PILL_PHOTO_OCR_PROMPT_VERSION, PILL_PHOTO_OCR_SCHEMA_VERSION, fusePillPhotoSignals,
  pillPhotoOcrInstructions, pillPhotoOcrFeaturesSchema, pillPhotoOcrSideResponseSchema,
  type PillPhotoFusionEvidence, type PillPhotoOcrFeatures, type PillPhotoOcrSideResponse, type PillPhotoOcrPromptVersion,
  type PillPhotoOcrImageCount,
} from "./pill-photo-ocr.ts";
import {
  preparePhonePillPhotoVariants, preparePillPhotoOcrRotationViews,
  type PillPhotoOcrRotationViews, type PillPhotoPreprocessingVariants, type PillPhonePhotoPreprocessingVariants,
} from "./pill-photo-preprocessing.ts";

const ENDPOINT = "https://api.openai.com/v1/responses";
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_OUTPUT_TEXT = 16 * 1024;
const MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024;
export const PILL_PHOTO_TIMEOUT_MS = 90_000;
type Usage = { inputTokens: number; outputTokens: number };
export type PillPhotoRequestStage = "vision" | "ocrFront" | "ocrBack";
export type PillPhotoExecutionMode = "sequential" | "parallel";
export type { PillPhotoOcrImageCount } from "./pill-photo-ocr.ts";
export type PillPhotoStageResult = { ok: true } | { ok: false; reason: PhotoFailure };
export type PillPhotoRequestTrace = {
  phase: "started"; stage: PillPhotoRequestStage; requestSha256: string;
} | {
  phase: "finished"; stage: PillPhotoRequestStage; requestSha256: string; elapsedMs: number;
  httpStatus: number | null; requestId: string | null; responseId: string | null;
  responseModel: string | null; responseStatus: string | null; usage: Usage | null;
  outcome: "response_received" | PhotoFailure;
};
type RequestObserver = (event: PillPhotoRequestTrace) => Promise<void>;
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const safeProviderTag = (value: unknown): string | null => typeof value === "string"
  && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(value) && !/^sk-/i.test(value) ? value : null;
export interface PhotoExtractionSignals {
  vision: { features: PillPhotoFeatures; usage: Usage | null };
  ocr: { features: PillPhotoOcrFeatures; usage: Usage | null };
  fusion: PillPhotoFusionEvidence;
}
export type PhotoExtractionResult = (
  | { ok: true; features: PillPhotoFeatures; usage: Usage | null; signals?: PhotoExtractionSignals }
  | { ok: false; reason: PhotoFailure }
) & { stageResults?: Record<PillPhotoRequestStage, PillPhotoStageResult> };

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
  visionPromptVersion: PillPhotoVisionPromptVersion = PILL_PHOTO_PROMPT_VERSION,
) {
  return {
    model, store: false, max_output_tokens: 2400, reasoning: { effort: "low" },
    instructions: pillPhotoVisionInstructions(visionPromptVersion),
    input: [{ role: "user", content: [
      { type: "input_text", text: "Image A context and aligned-color detail show the same first surface. Do not count them twice:" },
      inputImage(first.context), inputImage(first.alignedColor),
      { type: "input_text", text: "Image B context and aligned-color detail show the same second surface. Do not count them twice:" },
      inputImage(second.context), inputImage(second.alignedColor),
    ] }],
    text: { format: { type: "json_schema", name: "pill_visible_features", strict: true, schema: z.toJSONSchema(pillPhotoFeaturesSchema) } },
  };
}

/** One surface, with both color/contrast views: four rotations by default, or just 0/180 for comparison. */
export function pillPhotoOcrRequest(
  color: PillPhotoOcrRotationViews,
  contrast: PillPhotoOcrRotationViews,
  model: string,
  ocrPromptVersion: PillPhotoOcrPromptVersion = PILL_PHOTO_OCR_PROMPT_VERSION,
  ocrImageCount: PillPhotoOcrImageCount = 8,
) {
  const instructions = pillPhotoOcrInstructions(ocrPromptVersion, ocrImageCount);
  const angles = ocrImageCount === 4 ? "0, 180" : "0, 90, 180, 270";
  const select = (views: PillPhotoOcrRotationViews) => ocrImageCount === 4 ? [views[0], views[2]] : views;
  return {
    model, store: false, max_output_tokens: 1400, reasoning: { effort: "low" },
    instructions,
    input: [{ role: "user", content: [
      { type: "input_text", text: `Color rotations of one surface in this exact order: ${angles} degrees.` },
      ...select(color).map(inputImage),
      { type: "input_text", text: `Contrast-enhanced rotations of that same surface in this exact order: ${angles} degrees.` },
      ...select(contrast).map(inputImage),
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
  stage: PillPhotoRequestStage,
  observer?: RequestObserver,
): Promise<{ ok: true; value: unknown } | { ok: false; reason: PhotoFailure }> {
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized, "utf8") > MAX_REQUEST_BODY_BYTES) return { ok: false, reason: "invalid_photo" };
  const requestSha256 = digest(serialized);
  // Recording failures propagate before transmission; never turn them into model/network failures.
  await observer?.({ phase: "started", stage, requestSha256 });
  const started = performance.now();
  let httpStatus: number | null = null;
  let requestId: string | null = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PILL_PHOTO_TIMEOUT_MS);
  const execute = async (): Promise<{ ok: true; value: unknown } | { ok: false; reason: PhotoFailure }> => {
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: serialized,
      });
      httpStatus = response.status;
      requestId = safeProviderTag(response.headers.get("x-request-id"));
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
  };
  const result = await execute();
  const envelope = result.ok && result.value && typeof result.value === "object"
    ? result.value as Record<string, unknown> : {};
  const usage = z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }).safeParse(envelope.usage);
  await observer?.({ phase: "finished", stage, requestSha256,
    elapsedMs: Math.round(performance.now() - started), httpStatus, requestId,
    responseId: safeProviderTag(envelope.id), responseModel: safeProviderTag(envelope.model), responseStatus: safeProviderTag(envelope.status),
    usage: usage.success ? { inputTokens: usage.data.input_tokens, outputTokens: usage.data.output_tokens } : null,
    outcome: result.ok ? "response_received" : result.reason });
  return result;
}

function totalUsage(first: Usage | null, second: Usage | null): Usage | null {
  return first && second
    ? { inputTokens: first.inputTokens + second.inputTokens, outputTokens: first.outputTokens + second.outputTokens }
    : null;
}

export type PreparedPillPhotoRequests = {
  ok: true;
  sourceSha256: string[];
  preprocessing: Array<PillPhotoPreprocessingVariants["metadata"] | PillPhonePhotoPreprocessingVariants["metadata"]>;
  requests: { vision: ReturnType<typeof pillPhotoRequest>; ocrFront: ReturnType<typeof pillPhotoOcrRequest>; ocrBack: ReturnType<typeof pillPhotoOcrRequest> };
};

function requestsWithinLimit(requests: readonly unknown[]): boolean {
  return requests.every((request) => Buffer.byteLength(JSON.stringify(request), "utf8") <= MAX_REQUEST_BODY_BYTES);
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

export type PhotoOcrExtractionResult =
  | { ok: true; features: PillPhotoOcrFeatures; usage: Usage | null }
  | { ok: false; reason: PhotoFailure };

/** Internal transport shared by full extraction and the OCR-only reviewed-photo entry point. */
async function requestPreparedPillPhotoOcr(
  prepared: PreparedPillPhotoRequests, apiKey: string, fetchImpl: typeof fetch, observer?: RequestObserver,
): Promise<PhotoOcrExtractionResult> {
  const firstResponse = await requestPillPhotoProvider(prepared.requests.ocrFront, apiKey, fetchImpl, "ocrFront", observer);
  if (!firstResponse.ok) return firstResponse;
  const first = parsePillPhotoOcrResponse(firstResponse.value);
  if (!first.ok) return first;
  const secondResponse = await requestPillPhotoProvider(prepared.requests.ocrBack, apiKey, fetchImpl, "ocrBack", observer);
  if (!secondResponse.ok) return secondResponse;
  const second = parsePillPhotoOcrResponse(secondResponse.value);
  if (!second.ok) return second;
  return { ok: true, features: pillPhotoOcrFeaturesSchema.parse({ schemaVersion: PILL_PHOTO_OCR_SCHEMA_VERSION,
    front: first.features.side, back: second.features.side }), usage: totalUsage(first.usage, second.usage) };
}

/** Explicit transport for already prepared requests; never reads a credential from the environment. */
export async function extractPreparedPillPhotoOcr(
  prepared: PreparedPillPhotoRequests,
  options: { allowExternalTransfer?: boolean; apiKey?: string; fetchImpl?: typeof fetch; onRequestTrace?: RequestObserver } = {},
): Promise<PhotoOcrExtractionResult> {
  if (options.allowExternalTransfer !== true) return { ok: false, reason: "transfer_not_confirmed" };
  if (!options.apiKey?.trim()) return { ok: false, reason: "not_configured" };
  prepared = structuredClone(prepared);
  if (!requestsWithinLimit([prepared.requests.ocrFront, prepared.requests.ocrBack])) return { ok: false, reason: "invalid_photo" };
  return requestPreparedPillPhotoOcr(prepared, options.apiKey, options.fetchImpl ?? fetch, options.onRequestTrace);
}

/** Vision + per-side OCR + deterministic fusion. Callers must explicitly authorize transmission. */
export async function extractPreparedPillPhotos(
  prepared: PreparedPillPhotoRequests,
  options: { allowExternalTransfer?: boolean; apiKey?: string; fetchImpl?: typeof fetch; onRequestTrace?: RequestObserver;
    executionMode?: PillPhotoExecutionMode } = {},
): Promise<PhotoExtractionResult> {
  if (options.allowExternalTransfer !== true) return { ok: false, reason: "transfer_not_confirmed" };
  if (!options.apiKey?.trim()) return { ok: false, reason: "not_configured" };
  if (options.executionMode !== undefined && !["sequential", "parallel"].includes(options.executionMode)) {
    return { ok: false, reason: "invalid_request" };
  }
  // Isolate all three requests from caller mutation during asynchronous tracing and transmission.
  prepared = structuredClone(prepared);
  if (!requestsWithinLimit(Object.values(prepared.requests))) return { ok: false, reason: "invalid_photo" };
  const apiKey = options.apiKey;
  const fetchImpl = options.fetchImpl ?? fetch;
  if (options.executionMode === "parallel") {
    return extractParallelPreparedPillPhotos(prepared, apiKey, fetchImpl, options.onRequestTrace);
  }
  const visionResponse = await requestPillPhotoProvider(prepared.requests.vision, apiKey, fetchImpl, "vision", options.onRequestTrace);
  if (!visionResponse.ok) return visionResponse;
  const vision = parsePillPhotoResponse(visionResponse.value);
  if (!vision.ok) return vision;
  const ocr = await requestPreparedPillPhotoOcr(prepared, apiKey, fetchImpl, options.onRequestTrace);
  if (!ocr.ok) return ocr;
  return combinePillPhotoSignals(vision, ocr);
}

/** Fixed fan-out of three. Drain every request/observer before returning, including on recording errors. */
async function extractParallelPreparedPillPhotos(
  prepared: PreparedPillPhotoRequests, apiKey: string, fetchImpl: typeof fetch, observer?: RequestObserver,
): Promise<PhotoExtractionResult> {
  const stages = ["vision", "ocrFront", "ocrBack"] as const;
  const settled = await Promise.allSettled(stages.map(stage =>
    requestPillPhotoProvider(prepared.requests[stage], apiKey, fetchImpl, stage, observer)));
  // Provider failures are tagged values; rejections indicate recording/implementation errors.
  const responses = settled.map(result => {
    if (result.status === "rejected") throw new Error("photo_request_recording_failed");
    return result.value;
  });
  const vision = responses[0]!.ok ? parsePillPhotoResponse(responses[0]!.value) : responses[0]!;
  const front = responses[1]!.ok ? parsePillPhotoOcrResponse(responses[1]!.value) : responses[1]!;
  const back = responses[2]!.ok ? parsePillPhotoOcrResponse(responses[2]!.value) : responses[2]!;
  const outcome = (result: { ok: boolean; reason?: PhotoFailure }): PillPhotoStageResult =>
    result.ok ? { ok: true } : { ok: false, reason: result.reason! };
  const stageResults = { vision: outcome(vision), ocrFront: outcome(front), ocrBack: outcome(back) };
  // Select failures by stage, never by arrival order. Never fuse partial success.
  if (!vision.ok) return { ...vision, stageResults };
  if (!front.ok) return { ...front, stageResults };
  if (!back.ok) return { ...back, stageResults };
  const ocr: Extract<PhotoOcrExtractionResult, { ok: true }> = {
    ok: true, features: pillPhotoOcrFeaturesSchema.parse({ schemaVersion: PILL_PHOTO_OCR_SCHEMA_VERSION,
      front: front.features.side, back: back.features.side }), usage: totalUsage(front.usage, back.usage),
  };
  return { ...combinePillPhotoSignals(vision, ocr), stageResults };
}

function combinePillPhotoSignals(
  vision: Extract<PhotoExtractionResult, { ok: true }>, ocr: Extract<PhotoOcrExtractionResult, { ok: true }>,
): PhotoExtractionResult {
  try {
    const ocrFeatures = ocr.features;
    const ocrUsage = ocr.usage;
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
