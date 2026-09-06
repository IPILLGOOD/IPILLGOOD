// Experimental Vision-only probe. Saved OCR is a fixed scoring input, not a fabricated new API response.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { PILL_PHOTO_STRUCTURED_INSTRUCTIONS } from "../src/pill-photo-prompt-profiles.ts";
import { parsePillPhotoResponse, pillPhotoRequest } from "../src/pill-photo-experiment.ts";

export const STYLIZED_PROBE_VERSION = "pill-vision-stylized-text-probe.v1";
export const STYLIZED_TEXT_ADDITION = "Stylized lettering is not automatically a non-text logo. When visible strokes support letters or digits, retain only those visually supported readings, including a partial reading when appropriate. Never invent a brand or logo name, transliterate a symbol, or complete unseen strokes; if no textual reading is supported, keep it unreadable.";
const ANCHOR = "For each surface, distinguish text strokes from a non-text logo, score groove, capsule seam, reflection and shadow.";
if (PILL_PHOTO_STRUCTURED_INSTRUCTIONS.split(ANCHOR).length !== 2) throw Error("probe_prompt_anchor_changed");
export const STYLIZED_TEXT_INSTRUCTIONS = PILL_PHOTO_STRUCTURED_INSTRUCTIONS.replace(ANCHOR, `${ANCHOR}\n${STYLIZED_TEXT_ADDITION}`);
export type VisionProbeArm = "structured_control" | "stylized_text";
export const probeHash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

/** Caller supplies ONLY the manifest-bound PNGs, in A-context/A-detail/B-context/B-detail order. */
export function buildVisionProbeRequests(images: Buffer[]) {
  if (images.length !== 4 || images.some(image => !image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))) throw Error("probe_images_invalid");
  const control = pillPhotoRequest({ context: images[0]!, alignedColor: images[1]! },
    { context: images[2]!, alignedColor: images[3]! }, "gpt-5.6-sol", "pill-photo-observation-v4-structured-surfaces");
  const candidate = { ...structuredClone(control), instructions: STYLIZED_TEXT_INSTRUCTIONS };
  if (!isDeepStrictEqual({ ...control, instructions: "" }, { ...candidate, instructions: "" })) throw Error("probe_non_prompt_change");
  return { structured_control: control, stylized_text: candidate };
}
export const visionProbeOrder = () => [1, 2, 3].flatMap(repetition => Array.from({ length: 6 }, (_, index) => {
  const arms: VisionProbeArm[] = (repetition + index) % 2 ? ["structured_control", "stylized_text"] : ["stylized_text", "structured_control"];
  return arms.map(arm => ({ repetition, id: `v4-v0${index + 1}`, arm }));
}).flat());

/** Fixed first-party endpoint, bounded input/output, no tools, no redirects, no retries. */
export async function requestVisionProbe(body: ReturnType<typeof buildVisionProbeRequests>[VisionProbeArm], key: string,
  fetchImpl: typeof fetch = fetch) {
  const json = JSON.stringify(body);
  if (!key.trim() || Buffer.byteLength(json) > 16 * 1024 * 1024) throw Error("probe_request_invalid");
  const endpoint = "https://api.openai.com/v1/responses";
  const started = performance.now();
  const response = await fetchImpl(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(120_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: json });
  const limit = 1024 * 1024, length = response.headers.get("content-length");
  if (!response.ok || response.redirected || response.url && response.url !== endpoint
    || !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "") || !response.body
    || length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
    await response.body?.cancel(); throw Error(`probe_http_or_response_${response.status}`);
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.length; if (bytes > limit) throw Error("probe_response_too_large"); chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  const result = parsePillPhotoResponse(raw);
  if (!result.ok) throw Error("probe_extraction_failed");
  const envelope = raw as { id?: unknown; model?: unknown; status?: unknown };
  const tag = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9._:-]{1,160}$/.test(value) ? value : null;
  return { features: result.features, usage: result.usage, raw,
    trace: { httpStatus: response.status, elapsedMs: Math.round(performance.now() - started),
      requestId: tag(response.headers.get("x-request-id")), responseId: tag(envelope.id),
      responseModel: tag(envelope.model), responseStatus: tag(envelope.status) } };
}

export async function executeVisionProbeOrder<T>(run: (task: ReturnType<typeof visionProbeOrder>[number], index: number) => Promise<T>) {
  const results = []; // No partial success summary or selection of successful cases after failure.
  for (const [index, task] of visionProbeOrder().entries()) results.push(await run(task, index));
  return results;
}
