// Experimental, reviewed-photo transport only. Callers own request schemas and private artifact storage.
import type { PillPhotoFailure } from "../src/pill-photo-failures.ts";

export const PILL_PHOTO_CANDIDATE_TRANSPORT_VERSION = "pill-photo-candidate-transport.v2";
export const CANDIDATE_REVIEW_MAX_REQUEST_BYTES = 40 * 1024 * 1024;
export type PillPhotoFailureReason = PillPhotoFailure;
export interface CandidateReviewTrace {
  /** Whether fetchImpl was invoked; not a claim that the provider received or billed the request. */
  dispatched: boolean;
  httpStatus: number | null;
  requestId: string | null;
  responseId: string | null;
  responseModel: string | null;
  responseStatus: string | null;
  elapsedMs: number;
  usage: { input_tokens: number; output_tokens: number } | null;
}
export type CandidateReviewTransportResult =
  | { ok: true; value: unknown; rawText: string; trace: CandidateReviewTrace }
  | { ok: false; reason: PillPhotoFailureReason; rawText: string | null; trace: CandidateReviewTrace };

const ENDPOINT = "https://api.openai.com/v1/responses";
const RESPONSE_LIMIT = 1024 * 1024;
const TIMEOUT_MS = 120_000;
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const safeCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function serializeCandidateReviewRequest(body: unknown) {
  const json = JSON.stringify(body);
  return { json, bytes: Buffer.byteLength(json) };
}

/** Byte count only; caller compares with the shared cap. Non-JSON-serializable input throws. */
export function candidateReviewRequestBytes(body: unknown): number {
  return serializeCandidateReviewRequest(body).bytes;
}

/** Prevent exact credential echo, including escaped JSON strings. Never include provider error bodies. */
function containsCredential(value: unknown, key: string): boolean {
  const pending: unknown[] = [value];
  while (pending.length) {
    const next = pending.pop();
    if (typeof next === "string" && next.includes(key)) return true;
    if (Array.isArray(next)) for (const child of next) pending.push(child);
    else if (next !== null && typeof next === "object") {
      for (const [name, child] of Object.entries(next)) {
        if (name.includes(key)) return true;
        pending.push(child);
      }
    }
  }
  return false;
}

/** Fixed first-party endpoint, bounded input/output, no tools, redirects, retries, or environment access.
 * A 200 JSON envelope is transport success only; caller must separately validate refusal/status/schema.
 * rawText is private diagnostic data and must never be included in a user-facing response.
 */
export async function requestCandidateReview(body: { model: string; [key: string]: unknown }, key: string,
  fetchImpl: typeof fetch = fetch): Promise<CandidateReviewTransportResult> {
  const started = performance.now();
  const trace: CandidateReviewTrace = { dispatched: false, httpStatus: null, requestId: null, responseId: null,
    responseModel: null, responseStatus: null, elapsedMs: 0, usage: null };
  const finish = () => ({ ...trace, elapsedMs: Math.max(0, Math.round(performance.now() - started)) });
  const fail = (reason: PillPhotoFailureReason, rawText: string | null = null): CandidateReviewTransportResult =>
    ({ ok: false, reason, rawText, trace: finish() });
  if (typeof key !== "string" || !key.trim()) return fail("not_configured");
  const credential = key.trim();
  if (!/^[\x21-\x7e]+$/.test(credential)) return fail("invalid_request");
  let json: string;
  try {
    if (!body || typeof body.model !== "string" || !body.model.trim()
      || body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.length !== 0)
      || body.stream === true || body.background === true || body.store === true) return fail("invalid_request");
    const serialized = serializeCandidateReviewRequest(body);
    json = serialized.json;
    if (serialized.bytes > CANDIDATE_REVIEW_MAX_REQUEST_BYTES || json.includes(credential)) return fail("invalid_request");
  } catch { return fail("invalid_request"); }
  const safeTag = (value: unknown): string | null => typeof value === "string"
    && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value) && !/^sk-/i.test(value)
    && !value.includes(credential) ? value : null;
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let response: Response;
  try {
    trace.dispatched = true;
    response = await fetchImpl(ENDPOINT, { method: "POST", redirect: "error", signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential}` }, body: json });
  } catch { return fail(signal.aborted ? "timeout" : "provider_unavailable"); }
  trace.httpStatus = response.status;
  trace.requestId = safeTag(response.headers.get("x-request-id"));
  const discard = async () => { await response.body?.cancel().catch(() => undefined); };
  if (response.redirected || response.url && response.url !== ENDPOINT) {
    await discard(); return fail("invalid_response");
  }
  if (!response.ok) {
    await discard();
    return fail(response.status === 400 || response.status === 422 ? "invalid_request"
      : response.status === 401 || response.status === 403 ? "access_denied"
      : response.status === 429 ? "rate_limited" : "provider_unavailable");
  }
  const length = response.headers.get("content-length");
  if (response.status !== 200 || !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "")
    || !response.body || length !== null && (!/^\d+$/.test(length) || Number(length) > RESPONSE_LIMIT)) {
    await discard(); return fail("invalid_response");
  }
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      byteLength += next.value.length;
      if (byteLength > RESPONSE_LIMIT) return fail("invalid_response");
      chunks.push(next.value);
    }
  } catch { return fail(signal.aborted ? "timeout" : "invalid_response"); }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  let rawText: string;
  try { rawText = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { return fail("invalid_response"); }
  if (rawText.includes(credential)) return fail("invalid_response");
  let value: unknown;
  try { value = JSON.parse(rawText); }
  catch {
    // Invalid JSON may contain escaped credentials that cannot be safely parsed for inspection.
    return fail("invalid_response");
  }
  if (containsCredential(value, credential)) return fail("invalid_response");
  const envelope = record(value);
  trace.responseId = safeTag(envelope?.id);
  trace.responseModel = safeTag(envelope?.model);
  trace.responseStatus = safeTag(envelope?.status);
  const usage = record(envelope?.usage);
  if (usage && safeCount(usage.input_tokens) && safeCount(usage.output_tokens)) {
    trace.usage = { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens };
  }
  return { ok: true, value, rawText, trace: finish() };
}
