import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readReviewedPhoto } from "../scripts/pill-photo.ts";
import {
  extractReviewedPillPhotoOcr, extractReviewedPillPhotos, pillPhotoOcrRequest,
  prepareReviewedPillPhotoRequests, type PillPhotoRequestTrace,
} from "../src/pill-photo-experiment.ts";
import {
  PILL_PHOTO_OCR_INSTRUCTIONS, PILL_PHOTO_OCR_PROMPT_VERSION, PILL_PHOTO_OCR_SIDE_SCHEMA_VERSION,
  PILL_PHOTO_STROKE_OCR_INSTRUCTIONS, PILL_PHOTO_STROKE_OCR_PROMPT_VERSION,
  pillPhotoOcrInstructions, pillPhotoOcrSideResponseSchema, type PillPhotoOcrPromptVersion,
} from "../src/pill-photo-ocr.ts";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const settings = { model: "gpt-5.6-sol", ocrModel: "gpt-5.6-sol" };
const photos = async () => [await readReviewedPhoto(0), await readReviewedPhoto(1)] as const;
const side = (text: string) => ({ imprintCandidates: [text], noImprintObserved: false, imprintVisibility: "clear" as const });
const envelope = (value: unknown) => ({ id: "resp_mock", model: settings.ocrModel, status: "completed",
  output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(value) }] }],
  usage: { input_tokens: 10, output_tokens: 5 } });
const response = (value: unknown) => new Response(JSON.stringify(value), {
  headers: { "content-type": "application/json", "x-request-id": "request_mock" },
});
const ocrResponse = (text: string) => response(envelope({ schemaVersion: PILL_PHOTO_OCR_SIDE_SCHEMA_VERSION, side: side(text) }));

test("OCR opt-in은 instructions만 바꾸며 legacy 기본 본문의 고정 해시·스키마를 유지한다", () => {
  const views = [Buffer.from("view-0"), Buffer.from("view-90"), Buffer.from("view-180"), Buffer.from("view-270")] as const;
  const baseline = pillPhotoOcrRequest(views, views, settings.ocrModel);
  const explicit = pillPhotoOcrRequest(views, views, settings.ocrModel, PILL_PHOTO_OCR_PROMPT_VERSION);
  const candidate = pillPhotoOcrRequest(views, views, settings.ocrModel, PILL_PHOTO_STROKE_OCR_PROMPT_VERSION);
  assert.equal(hash(baseline), "176433e6c3d9f8867ce77014d8a1ae8c83a54b2424d6c85e116d4629dda3d6cf");
  assert.deepEqual(explicit, baseline);
  assert.equal(baseline.instructions, PILL_PHOTO_OCR_INSTRUCTIONS);
  assert.equal(candidate.instructions, PILL_PHOTO_STROKE_OCR_INSTRUCTIONS);
  assert.equal(pillPhotoOcrInstructions(), PILL_PHOTO_OCR_INSTRUCTIONS);
  assert.ok(candidate.instructions.startsWith(PILL_PHOTO_OCR_INSTRUCTIONS));
  assert.deepEqual({ ...candidate, instructions: baseline.instructions }, baseline);
  assert.equal(candidate.input[0]!.content.filter((part) => "image_url" in part).length, 8);
  assert.throws(() => pillPhotoOcrInstructions("unregistered" as PillPhotoOcrPromptVersion), /trial_unknown_ocr_prompt/);
});

test("OCR 새 지침도 약명·성분·품목코드·판독 절차를 출력 계약에 추가할 수 없다", () => {
  const valid = { schemaVersion: PILL_PHOTO_OCR_SIDE_SCHEMA_VERSION, side: side("Q7") };
  assert.ok(pillPhotoOcrSideResponseSchema.safeParse(valid).success);
  for (const key of ["productName", "ingredient", "itemSeq", "expectedItemSeq", "reasoning", "orientation"]) {
    assert.equal(pillPhotoOcrSideResponseSchema.safeParse({ ...valid, [key]: "not allowed" }).success, false);
    assert.equal(pillPhotoOcrSideResponseSchema.safeParse({ ...valid, side: { ...valid.side, [key]: "not allowed" } }).success, false);
  }
  for (const invalid of [
    { ...side("Q7"), noImprintObserved: true },
    { ...side("Q7"), imprintVisibility: "unreadable" },
    { ...side("Q7"), imprintCandidates: ["Q7", "Q8", "Q9", "R7", "R8", "R9"] },
  ]) assert.equal(pillPhotoOcrSideResponseSchema.safeParse({ ...valid, side: invalid }).success, false);
});

test("검수 사진 준비의 source·전처리·Vision·OCR 이미지와 설정은 지침 선택 전후 동일하다", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("network_forbidden"); });
  const inputs = await photos();
  const baseline = await prepareReviewedPillPhotoRequests(inputs, settings);
  const candidate = await prepareReviewedPillPhotoRequests(inputs, { ...settings, ocrPromptVersion: PILL_PHOTO_STROKE_OCR_PROMPT_VERSION });
  assert.ok(baseline.ok && candidate.ok);
  assert.deepEqual({ ...candidate, requests: { ...candidate.requests,
    ocrFront: { ...candidate.requests.ocrFront, instructions: baseline.requests.ocrFront.instructions },
    ocrBack: { ...candidate.requests.ocrBack, instructions: baseline.requests.ocrBack.instructions },
  } }, baseline);
});

test("미등록 OCR 지침과 frozen split의 새 지침은 allowlist 로딩·전송 전에 거부한다", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("network_forbidden"); });
  const inputs = [new Uint8Array([1]), new Uint8Array([2])] as const;
  const unknown = "unregistered" as PillPhotoOcrPromptVersion;
  assert.deepEqual(await prepareReviewedPillPhotoRequests(inputs, { ...settings, ocrPromptVersion: unknown }), { ok: false, reason: "invalid_request" });
  for (const photoSet of ["evaluation", "unseen_evaluation", "phone_holdout"] as const) {
    const options = { ...settings, photoSet, ocrPromptVersion: PILL_PHOTO_STROKE_OCR_PROMPT_VERSION, allowExternalTransfer: true, apiKey: "synthetic-only" } as const;
    assert.deepEqual(await prepareReviewedPillPhotoRequests(inputs, options), { ok: false, reason: "invalid_request" });
    assert.deepEqual(await extractReviewedPillPhotoOcr(inputs, options), { ok: false, reason: "invalid_request" });
    assert.deepEqual(await extractReviewedPillPhotos(inputs, options), { ok: false, reason: "invalid_request" });
  }
  assert.deepEqual(await extractReviewedPillPhotoOcr(inputs, { allowExternalTransfer: true, apiKey: "synthetic-only", ocrPromptVersion: unknown }),
    { ok: false, reason: "invalid_request" });
  assert.deepEqual(await extractReviewedPillPhotoOcr(inputs), { ok: false, reason: "transfer_not_confirmed" });
  assert.deepEqual(await extractReviewedPillPhotoOcr(inputs, { allowExternalTransfer: true, apiKey: "synthetic-only" }),
    { ok: false, reason: "unreviewed_photo" });
  assert.deepEqual(await extractReviewedPillPhotoOcr(await photos(), { allowExternalTransfer: true }), { ok: false, reason: "not_configured" });
});

test("OCR-only 전송은 Vision 없이 양면 두 요청만 전송하고 callback 복사본 변조를 무시한다", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("network_forbidden"); });
  const inputs = await photos();
  const options = { ...settings, ocrPromptVersion: PILL_PHOTO_STROKE_OCR_PROMPT_VERSION } as const;
  const prepared = await prepareReviewedPillPhotoRequests(inputs, options); assert.ok(prepared.ok);
  const expected = [prepared.requests.ocrFront, prepared.requests.ocrBack];
  const traces: PillPhotoRequestTrace[] = [];
  let calls = 0;
  const result = await extractReviewedPillPhotoOcr(inputs, { ...options, allowExternalTransfer: true, apiKey: "synthetic-only",
    onPrepared: async (copy) => { copy.requests.ocrFront.instructions = "tampered"; copy.requests.ocrBack.input.length = 0; },
    onRequestTrace: async (event) => { traces.push(event); },
    fetchImpl: async (url, init) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(init?.redirect, "error");
      assert.equal(hash(JSON.parse(String(init?.body))), hash(expected[calls]));
      return ocrResponse(calls++ === 0 ? "Q7" : "R2");
    } });
  assert.equal(calls, 2); assert.ok(result.ok);
  assert.deepEqual(result.features.front.imprintCandidates, ["Q7"]);
  assert.deepEqual(result.features.back.imprintCandidates, ["R2"]);
  assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 10 });
  assert.deepEqual(traces.map((event) => [event.phase, event.stage]), [["started", "ocrFront"], ["finished", "ocrFront"], ["started", "ocrBack"], ["finished", "ocrBack"]]);
  assert.deepEqual(traces.filter((event) => event.phase === "started").map((event) => event.requestSha256), expected.map(hash));
  for (const event of traces) if (event.phase === "finished") {
    assert.equal(event.outcome, "response_received"); assert.equal(event.httpStatus, 200);
    assert.equal(event.responseModel, settings.ocrModel); assert.equal(event.requestId, "request_mock");
    assert.ok(event.elapsedMs >= 0);
  }
  assert.equal(JSON.stringify(traces).includes("synthetic-only"), false);
});

test("OCR-only는 HTTP·스키마·부분 요청 실패를 성공 또는 무각인으로 바꾸지 않는다", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("network_forbidden"); });
  const inputs = await photos();
  for (const scenario of [
    { failAt: 1, reason: "invalid_request", reply: () => new Response("bad", { status: 400 }) },
    { failAt: 1, reason: "rate_limited", reply: () => new Response("limited", { status: 429 }) },
    { failAt: 1, reason: "ocr_failed", reply: () => response(envelope({ schemaVersion: PILL_PHOTO_OCR_SIDE_SCHEMA_VERSION, side: side("Q7"), itemSeq: "not allowed" })) },
    { failAt: 2, reason: "ocr_failed", reply: () => response(envelope({ schemaVersion: PILL_PHOTO_OCR_SIDE_SCHEMA_VERSION, side: { ...side("Q7"), noImprintObserved: true } })) },
  ]) {
    let calls = 0;
    const result = await extractReviewedPillPhotoOcr(inputs, { allowExternalTransfer: true, apiKey: "synthetic-only",
      fetchImpl: async () => ++calls === scenario.failAt ? scenario.reply() : ocrResponse("Q7") });
    assert.equal(calls, scenario.failAt);
    assert.deepEqual(result, { ok: false, reason: scenario.reason });
  }
});

test("OCR-only 기록 실패는 전송 전에 차단하거나 다음 면을 중단하며 provider 오류로 숨기지 않는다", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("network_forbidden"); });
  const inputs = await photos();
  for (const phase of ["started", "finished"] as const) {
    let calls = 0;
    await assert.rejects(extractReviewedPillPhotoOcr(inputs, { allowExternalTransfer: true, apiKey: "synthetic-only",
      onRequestTrace: async (event) => { if (event.phase === phase) throw new Error("recording_failed"); },
      fetchImpl: async () => { calls++; return ocrResponse("Q7"); } }), /recording_failed/);
    assert.equal(calls, phase === "started" ? 0 : 1);
  }
});
