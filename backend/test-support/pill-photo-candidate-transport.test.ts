import test from "node:test";
import assert from "node:assert/strict";
import { requestCandidateReview, PILL_PHOTO_CANDIDATE_TRANSPORT_VERSION, CANDIDATE_REVIEW_MAX_REQUEST_BYTES,
  candidateReviewRequestBytes } from "./pill-photo-candidate-transport.ts";

const KEY = "sk-synthetic-never-real-credential";
const body = { model: "gpt-5.6-sol", store: false, input: "Synthetic test only", tools: [] };
const envelope = { id: "resp_test", model: "gpt-5.6-sol", status: "completed",
  output: [], usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 } };
const jsonResponse = (value: unknown = envelope, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json", ...headers } });

test("candidate transport refuses missing key, invalid body, tools and oversize before any request", async () => {
  let calls = 0;
  const noCall: typeof fetch = async () => { calls++; throw Error("must_not_call"); };
  for (const key of ["", " \t\n"]) {
    const result = await requestCandidateReview(body, key, noCall);
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.reason, "not_configured");
    assert.equal(result.trace.httpStatus, null); assert.equal(result.trace.dispatched, false);
  }
  const cyclic: { model: string; child?: unknown } = { model: "model" }; cyclic.child = cyclic;
  for (const request of [{ ...body, model: "" }, { ...body, input: "a".repeat(CANDIDATE_REVIEW_MAX_REQUEST_BYTES) }, cyclic,
    { ...body, tools: [{ type: "web_search" }] }, { ...body, tools: {} }, { ...body, stream: true },
    { ...body, background: true }, { ...body, store: true }, { ...body, input: KEY }]) {
    const result = await requestCandidateReview(request, KEY, noCall);
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.reason, "invalid_request");
    assert.equal(result.rawText, null); assert.equal(result.trace.dispatched, false);
  }
  assert.equal((await requestCandidateReview(body, "sk-unsafe\nheader", noCall)).ok, false);
  assert.equal(calls, 0);
  assert.equal(PILL_PHOTO_CANDIDATE_TRANSPORT_VERSION, "pill-photo-candidate-transport.v2");
  assert.equal(CANDIDATE_REVIEW_MAX_REQUEST_BYTES, 40 * 1024 * 1024);
});

test("shared byte preflight counts serialized UTF-8, throws on non-JSON values, and accepts a 17MiB mock request", async () => {
  assert.equal(candidateReviewRequestBytes({ text: "한글😀" }), Buffer.byteLength(JSON.stringify({ text: "한글😀" })));
  assert.ok(candidateReviewRequestBytes({ text: "한글😀" }) > JSON.stringify({ text: "한글😀" }).length);
  assert.equal(candidateReviewRequestBytes(null), 4);
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  for (const invalid of [cyclic, 1n, undefined]) assert.throws(() => candidateReviewRequestBytes(invalid));
  const request = { ...body, input: "a".repeat(17 * 1024 * 1024) };
  assert.ok(candidateReviewRequestBytes(request) > 16 * 1024 * 1024);
  assert.ok(candidateReviewRequestBytes(request) < CANDIDATE_REVIEW_MAX_REQUEST_BYTES);
  let calls = 0;
  const result = await requestCandidateReview(request, KEY, async (_url, init) => {
    calls++; assert.equal(Buffer.byteLength(init?.body as string), candidateReviewRequestBytes(request));
    return jsonResponse();
  });
  assert.equal(calls, 1); assert.equal(result.ok, true); assert.equal(result.trace.dispatched, true);
});

test("exact 40MiB serialized request is accepted and one additional byte is blocked before dispatch", async () => {
  const empty = { ...body, input: "" };
  const exact = { ...body, input: "a".repeat(CANDIDATE_REVIEW_MAX_REQUEST_BYTES - candidateReviewRequestBytes(empty)) };
  assert.equal(candidateReviewRequestBytes(exact), CANDIDATE_REVIEW_MAX_REQUEST_BYTES);
  let calls = 0;
  const mock: typeof fetch = async () => { calls++; return jsonResponse(); };
  const accepted = await requestCandidateReview(exact, KEY, mock);
  assert.equal(accepted.ok, true); assert.equal(accepted.trace.dispatched, true);
  const rejected = await requestCandidateReview({ ...exact, input: `${exact.input}a` }, KEY, mock);
  assert.equal(rejected.ok, false); if (!rejected.ok) assert.equal(rejected.reason, "invalid_request");
  assert.equal(rejected.trace.dispatched, false); assert.equal(rejected.trace.httpStatus, null);
  assert.equal(calls, 1);
});

test("candidate transport uses fixed POST endpoint, bounded signal and no redirect, retaining JSON and safe trace", async () => {
  let calls = 0;
  const result = await requestCandidateReview(body, KEY, async (url, init) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "error");
    assert.equal(init?.body, JSON.stringify(body));
    assert.ok(init?.signal instanceof AbortSignal); assert.equal(init.signal.aborted, false);
    assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${KEY}`);
    assert.equal(new Headers(init.headers).get("content-type"), "application/json");
    return jsonResponse(envelope, { "x-request-id": "req_test" });
  });
  assert.equal(calls, 1); assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, envelope);
  assert.equal(result.rawText, JSON.stringify(envelope));
  assert.deepEqual({ ...result.trace, elapsedMs: 0 }, { dispatched: true, httpStatus: 200, requestId: "req_test", responseId: "resp_test",
    responseModel: "gpt-5.6-sol", responseStatus: "completed", elapsedMs: 0, usage: { input_tokens: 120, output_tokens: 30 } });
  assert.ok(result.trace.elapsedMs >= 0);
  assert.equal(JSON.stringify(result).includes(KEY), false);
});

test("valid 200 JSON incomplete or refused envelopes remain available to the caller's schema parser", async () => {
  for (const value of [{ ...envelope, status: "incomplete" }, { output: [{ type: "refusal" }] }, ["wrong schema"], null]) {
    const result = await requestCandidateReview(body, KEY, async () => jsonResponse(value));
    assert.equal(result.ok, true); if (result.ok) assert.deepEqual(result.value, value);
    assert.equal(result.rawText, JSON.stringify(value));
  }
});

test("HTTP failures preserve status only, never provider error body, and never retry", async () => {
  for (const [status, reason] of [[400, "invalid_request"], [422, "invalid_request"], [401, "access_denied"],
    [403, "access_denied"], [429, "rate_limited"], [500, "provider_unavailable"], [302, "provider_unavailable"]] as const) {
    let calls = 0, cancelled = false;
    const result = await requestCandidateReview(body, KEY, async () => {
      calls++;
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(KEY)); },
        cancel() { cancelled = true; } }), { status, headers: { "x-request-id": "req_error", "content-type": "application/json" } });
    });
    assert.equal(calls, 1); assert.equal(cancelled, true); assert.equal(result.ok, false); assert.equal(result.trace.dispatched, true);
    if (!result.ok) assert.equal(result.reason, reason);
    assert.equal(result.trace.httpStatus, status); assert.equal(result.trace.requestId, "req_error");
    assert.equal(result.rawText, null); assert.equal(JSON.stringify(result).includes(KEY), false);
  }
});

test("network errors are sanitized provider failures without retry", async () => {
  let calls = 0;
  const result = await requestCandidateReview(body, KEY, async () => { calls++; throw Error(KEY); });
  assert.equal(calls, 1); assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "provider_unavailable");
  assert.equal(result.trace.httpStatus, null); assert.equal(result.rawText, null); assert.equal(result.trace.dispatched, true);
  assert.equal(JSON.stringify(result).includes(KEY), false);
});

test("120-second timeout contract applies to fetch and response stream failures without waiting in tests", async (context) => {
  const aborted = AbortSignal.abort();
  const timeout = context.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    assert.equal(milliseconds, 120_000); return aborted;
  });
  try {
    const fetchTimeout = await requestCandidateReview(body, KEY, async () => { throw Error(KEY); });
    assert.equal(fetchTimeout.ok, false); if (!fetchTimeout.ok) assert.equal(fetchTimeout.reason, "timeout");
    const streamTimeout = await requestCandidateReview(body, KEY, async () => new Response(new ReadableStream({
      start(controller) { controller.error(Error(KEY)); },
    }), { headers: { "content-type": "application/json" } }));
    assert.equal(streamTimeout.ok, false); if (!streamTimeout.ok) assert.equal(streamTimeout.reason, "timeout");
    assert.equal(streamTimeout.trace.httpStatus, 200); assert.equal(streamTimeout.rawText, null);
    assert.equal(JSON.stringify([fetchTimeout, streamTimeout]).includes(KEY), false);
  } finally { timeout.mock.restore(); }
});

test("redirect metadata and a different final URL are rejected even if a mock returns 200", async () => {
  for (const properties of [{ redirected: true }, { url: "https://example.invalid/v1/responses" }]) {
    const response = jsonResponse();
    for (const [name, value] of Object.entries(properties)) Object.defineProperty(response, name, { value });
    const result = await requestCandidateReview(body, KEY, async () => response);
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.reason, "invalid_response");
    assert.equal(result.rawText, null);
  }
});

test("content-type, advertised byte bound, malformed JSON, invalid UTF-8 and empty body are failures", async () => {
  for (const response of [new Response("{}", { headers: { "content-type": "text/plain" } }),
    jsonResponse({}, { "content-length": "1048577" }), jsonResponse({}, { "content-length": "-1" }),
    jsonResponse({}, { "content-length": "NaN" }), new Response("{", { headers: { "content-type": "application/json" } }),
    new Response(Uint8Array.from([255]), { headers: { "content-type": "application/json" } }),
    new Response(null, { headers: { "content-type": "application/json" } })]) {
    const result = await requestCandidateReview(body, KEY, async () => response);
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.reason, "invalid_response");
    assert.equal(result.rawText, null);
  }
});

test("stream byte bound is enforced independently of declared length and cancels oversized streams", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new Uint8Array(1024 * 1024)); controller.enqueue(new Uint8Array(1));
  }, cancel() { cancelled = true; } }), { headers: { "content-type": "application/json", "content-length": "2" } });
  const result = await requestCandidateReview(body, KEY, async () => response);
  assert.equal(result.ok, false); if (!result.ok) assert.equal(result.reason, "invalid_response");
  assert.equal(cancelled, true); assert.equal(result.rawText, null);
});

test("an interrupted partial stream is a failure, not a stored completed response", async () => {
  let pulls = 0;
  const response = new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    if (++pulls === 1) controller.enqueue(new TextEncoder().encode('{"status":"completed",'));
    else controller.error(Error(KEY));
  } }), { headers: { "content-type": "application/json" } });
  const result = await requestCandidateReview(body, KEY, async () => response);
  assert.equal(result.ok, false); if (!result.ok) assert.equal(result.reason, "invalid_response");
  assert.equal(result.rawText, null); assert.equal(JSON.stringify(result).includes(KEY), false);
});

test("credential echoes including JSON escapes are rejected; unsafe tags and usage fields are omitted", async () => {
  for (const text of [JSON.stringify({ id: KEY }), JSON.stringify({ [KEY]: "x" }),
    JSON.stringify({ x: KEY }).replaceAll("s", "\\u0073"), `{"broken":"${KEY}`]) {
    const result = await requestCandidateReview(body, KEY, async () => new Response(text, { headers: { "content-type": "application/json" } }));
    assert.equal(result.ok, false); assert.equal(result.rawText, null); assert.equal(JSON.stringify(result).includes(KEY), false);
  }
  const result = await requestCandidateReview(body, KEY, async () => jsonResponse({ id: "sk-other-secret", model: "m".repeat(161),
    status: "invalid status", usage: { input_tokens: -1, output_tokens: 10, arbitrary: "secret" } }, { "x-request-id": KEY }));
  assert.equal(result.ok, true); assert.equal(result.trace.requestId, null); assert.equal(result.trace.responseId, null);
  assert.equal(result.trace.responseModel, null); assert.equal(result.trace.responseStatus, null); assert.equal(result.trace.usage, null);
  for (const input of [1.5, Number.MAX_SAFE_INTEGER + 1, "3", null]) {
    const invalidUsage = await requestCandidateReview(body, KEY, async () => jsonResponse({ usage: { input_tokens: input, output_tokens: 1 } }));
    assert.equal(invalidUsage.trace.usage, null);
  }
  const broadJson = await requestCandidateReview(body, KEY, async () => jsonResponse(Array.from({ length: 150_000 }, () => 0)));
  assert.equal(broadJson.ok, true, "bounded JSON array inspection must not exceed argument-stack limits");
});
