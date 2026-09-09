import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { pillObservation } from "../test-support/pill-fixtures.ts";
import { extractReviewedPillPhotoOcr, extractReviewedPillPhotos, prepareReviewedPillPhotoRequests } from "./pill-photo-experiment.ts";
import { pillPhotoFeaturesSchema } from "./pill-photo-features.ts";
import { fusePillPhotoSignals, PILL_PHOTO_OCR_SCHEMA_VERSION, PILL_PHOTO_OCR_SIDE_SCHEMA_VERSION, pillPhotoOcrFeaturesSchema } from "./pill-photo-ocr.ts";
import {
  extractPreparedPillPhotos, pillPhotoOcrRequest, pillPhotoRequest, preparePhonePillPhotoRequests,
  type PreparedPillPhotoRequests, type PillPhotoRequestTrace,
} from "./pill-photo-pipeline.ts";
import { preparePillPhotoOcrRotationViews, prepareValidatedPhonePillPhotoVariants } from "./pill-photo-preprocessing.ts";

const models = { model: "gpt-5.6-sol", ocrModel: "gpt-5.6-sol" };
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
// Synthetic test pixels only: these tests never open a user's photos or call a real provider.
const sourcesPromise = Promise.all([
  sharp({ create: { width: 192, height: 160, channels: 3, background: "#ddd6b8" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer(),
  sharp({ create: { width: 192, height: 160, channels: 3, background: "#aaa8b8" } }).jpeg().toBuffer(),
]).then(([front, back]) => [front!, back!] as const);
const preparedPromise = sourcesPromise.then(async (sources) => {
  const prepared = await preparePhonePillPhotoRequests(sources, models);
  assert.equal(prepared.ok, true);
  return prepared as PreparedPillPhotoRequests;
});

function features() {
  const { source, ...observation } = pillObservation();
  assert.equal(source, "manual");
  return pillPhotoFeaturesSchema.parse({ observation, pairConsistency: "consistent", bothSidesVisible: true, imageArtifact: "none" });
}

function side(imprint: string) {
  return { schemaVersion: PILL_PHOTO_OCR_SIDE_SCHEMA_VERSION,
    side: { imprintCandidates: [imprint], noImprintObserved: false, imprintVisibility: "clear" as const } };
}

function response(value: unknown) {
  return { id: "resp_synthetic", model: models.model, status: "completed",
    output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(value) }] }],
    usage: { input_tokens: 100, output_tokens: 20 } };
}

test("새 JPEG도 기존 검수 휴대폰 전처리·요청과 동일하고 EXIF를 전송하지 않는다", async () => {
  const sources = await sourcesPromise;
  const prepared = await preparedPromise;
  const variants = await Promise.all(sources.map((bytes) => prepareValidatedPhonePillPhotoVariants(bytes, { bytes: bytes.length, sha256: hash(bytes) })));
  assert.deepEqual(prepared.sourceSha256, sources.map(hash));
  assert.deepEqual(prepared.preprocessing, variants.map((entry) => entry.metadata));
  assert.deepEqual(prepared.requests.vision, pillPhotoRequest(variants[0]!, variants[1]!, models.model));
  for (const index of [0, 1] as const) {
    const expected = pillPhotoOcrRequest(await preparePillPhotoOcrRotationViews(variants[index]!.alignedColor),
      await preparePillPhotoOcrRotationViews(variants[index]!.alignedContrast), models.ocrModel);
    assert.deepEqual(prepared.requests[index === 0 ? "ocrFront" : "ocrBack"], expected);
  }
  assert.deepEqual(prepared.preprocessing[0]!.source, { width: 160, height: 192, format: "jpeg" });
  for (const request of Object.values(prepared.requests)) {
    assert.equal(request.store, false);
    for (const part of request.input[0]!.content) {
      if (!("image_url" in part)) continue;
      assert.match(part.image_url, /^data:image\/png;base64,/);
      const metadata = await sharp(Buffer.from(part.image_url.split(",")[1]!, "base64")).metadata();
      assert.equal(metadata.exif, undefined);
      assert.equal(metadata.xmp, undefined);
    }
  }
});

test("새 입력은 JPEG 내용·중복·5MiB·25Mpx 한도와 모델 이름을 검증한다", async () => {
  const [front, back] = await sourcesPromise;
  const invalid = async (first: Uint8Array, second = back) => {
    assert.deepEqual(await preparePhonePillPhotoRequests([first, second], models), { ok: false, reason: "invalid_photo" });
  };
  await invalid(Buffer.alloc(0));
  await invalid(Buffer.from("not-a-jpeg"));
  await invalid(front.subarray(0, 64));
  await invalid(await sharp(front).png().toBuffer());
  await invalid(Buffer.alloc(5 * 1024 * 1024 + 1));
  await invalid(await sharp({ create: { width: 5001, height: 5000, channels: 3, background: "white" } }).jpeg().toBuffer());
  assert.deepEqual(await preparePhonePillPhotoRequests([front, front], models), { ok: false, reason: "duplicate_photo" });
  assert.deepEqual(await preparePhonePillPhotoRequests(null as unknown as readonly [Uint8Array, Uint8Array], models),
    { ok: false, reason: "invalid_photo" });
  assert.deepEqual(await preparePhonePillPhotoRequests([front, back], { ...models, model: "sk-synthetic-never-real-credential" }),
    { ok: false, reason: "not_configured" });
});

test("기존 검수 진입점은 새 JPEG를 여전히 거절하고 동의·키 없는 공통 전송은 0회다", async () => {
  const sources = await sourcesPromise;
  const prepared = await preparedPromise;
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls++; throw new Error("must_not_call"); };
  const options = { allowExternalTransfer: true, apiKey: "synthetic-test-credential", fetchImpl };
  assert.deepEqual(await prepareReviewedPillPhotoRequests(sources, models), { ok: false, reason: "unreviewed_photo" });
  assert.deepEqual(await extractReviewedPillPhotos(sources, options), { ok: false, reason: "unreviewed_photo" });
  assert.deepEqual(await extractReviewedPillPhotoOcr(sources, options), { ok: false, reason: "unreviewed_photo" });
  await assert.rejects(prepareValidatedPhonePillPhotoVariants(sources[0], { bytes: sources[0].length, sha256: "0".repeat(64) }), /unreviewed_photo/);
  assert.deepEqual(await extractPreparedPillPhotos(prepared, { fetchImpl }), { ok: false, reason: "transfer_not_confirmed" });
  assert.deepEqual(await extractPreparedPillPhotos(prepared, { fetchImpl, allowExternalTransfer: true }), { ok: false, reason: "not_configured" });
  assert.equal(calls, 0);
});

test("공통 전송은 Vision·앞면 OCR·뒷면 OCR을 결합하며 호출자 변조와 원문 로그를 차단한다", async () => {
  const prepared = structuredClone(await preparedPromise);
  const expectedRequests = Object.values(prepared.requests).map((entry) => JSON.stringify(entry));
  const output = [response(features()), response(side("T0")), response(side("10"))];
  const traces: PillPhotoRequestTrace[] = [];
  let calls = 0;
  const fetchImpl: typeof fetch = async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-test-credential");
    assert.equal(init?.body, expectedRequests[calls]);
    return Response.json(output[calls++], { headers: { "x-request-id": "sk-synthetic-never-real-credential" } });
  };
  const actual = await extractPreparedPillPhotos(prepared, { allowExternalTransfer: true, apiKey: "synthetic-test-credential", fetchImpl,
    onRequestTrace: async (event) => { traces.push(event); prepared.requests.ocrBack.model = "mutated-model"; } });
  assert.equal(calls, 3);
  assert.equal(actual.ok, true);
  if (!actual.ok) return;
  const ocr = pillPhotoOcrFeaturesSchema.parse({ schemaVersion: PILL_PHOTO_OCR_SCHEMA_VERSION, front: side("T0").side, back: side("10").side });
  const fused = fusePillPhotoSignals(features(), ocr);
  assert.deepEqual(actual.features, fused.features);
  assert.deepEqual(actual.signals?.fusion, fused.evidence);
  assert.deepEqual(actual.usage, { inputTokens: 300, outputTokens: 60 });
  assert.deepEqual(traces.map((event) => `${event.stage}:${event.phase}`),
    ["vision:started", "vision:finished", "ocrFront:started", "ocrFront:finished", "ocrBack:started", "ocrBack:finished"]);
  for (const trace of traces) {
    assert.match(trace.requestSha256, /^[a-f0-9]{64}$/);
    if (trace.phase === "finished") assert.equal(trace.requestId, null);
  }
  assert.doesNotMatch(JSON.stringify(traces), /synthetic-test-credential|sk-synthetic|image_url|data:image/);
});

test("외부 거절·응답 한도·OCR 실패는 후속 호출을 중단하고 오류 원문을 보관하지 않는다", async () => {
  const prepared = await preparedPromise;
  const cases = [
    { responses: [new Response("sensitive provider body", { status: 429 })], reason: "rate_limited", count: 1 },
    { responses: [new Response("{}", { headers: { "content-type": "application/json", "content-length": "262145" } })], reason: "invalid_response", count: 1 },
    { responses: [Response.json(response(features())), Response.json(response({ invalid: "sensitive provider body" }))], reason: "ocr_failed", count: 2 },
  ];
  for (const item of cases) {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => item.responses[calls++]!;
    assert.deepEqual(await extractPreparedPillPhotos(prepared, { allowExternalTransfer: true, apiKey: "synthetic-test-credential", fetchImpl }),
      { ok: false, reason: item.reason });
    assert.equal(calls, item.count);
  }
  const fetchImpl: typeof fetch = async () => { throw new Error("synthetic-test-credential: sensitive provider body"); };
  assert.deepEqual(await extractPreparedPillPhotos(prepared, { allowExternalTransfer: true, apiKey: "synthetic-test-credential", fetchImpl }),
    { ok: false, reason: "network_error" });
});

test("마지막 OCR 요청이 한도를 넘으면 첫 Vision 요청 전부터 전송을 막는다", async () => {
  const prepared = structuredClone(await preparedPromise);
  prepared.requests.ocrBack.instructions = "x".repeat(32 * 1024 * 1024);
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls++; throw new Error("must_not_call"); };
  assert.deepEqual(await extractPreparedPillPhotos(prepared, { allowExternalTransfer: true, apiKey: "synthetic-test-credential", fetchImpl }),
    { ok: false, reason: "invalid_photo" });
  assert.equal(calls, 0);
});
