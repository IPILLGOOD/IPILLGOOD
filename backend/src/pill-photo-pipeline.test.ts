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

test("병렬 세 요청은 첫 응답 전에 모두 시작하고 역순 응답도 같은 본문·면·결합 결과를 유지한다", { timeout: 60_000 }, async () => {
  const original = await preparedPromise;
  const caller = structuredClone(original);
  const bodies = Object.values(original.requests).map(value => JSON.stringify(value));
  const outputs = [features(), side("T0"), side("10")];
  const traces: PillPhotoRequestTrace[] = [];
  const releases: ((response: Response) => void)[] = [];
  let started = 0;
  let signalStarted!: () => void;
  const allStarted = new Promise<void>(resolve => { signalStarted = resolve; });
  const execution = extractPreparedPillPhotos(caller, {
    executionMode: "parallel", allowExternalTransfer: true, apiKey: "synthetic-key",
    onRequestTrace: async event => { traces.push(event); },
    fetchImpl: async (_url, init) => {
      const index = bodies.indexOf(String(init?.body));
      assert.notEqual(index, -1, "serialized request must match the sequential request exactly");
      assert.equal(releases[index], undefined, "each stage is dispatched only once");
      const response = new Promise<Response>(resolve => { releases[index] = resolve; });
      if (++started === 3) signalStarted();
      return response;
    },
  });
  await allStarted;
  assert.deepEqual(traces.map(event => event.phase), ["started", "started", "started"]);
  caller.requests.vision.instructions = "caller mutation must not change in-flight requests";
  for (const index of [2, 0, 1]) {
    releases[index]!(Response.json(response(outputs[index])));
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  const parallel = await execution;
  const sequential = await extractPreparedPillPhotos(original, {
    allowExternalTransfer: true, apiKey: "synthetic-key",
    fetchImpl: async (_url, init) => Response.json(response(outputs[bodies.indexOf(String(init?.body))])),
  });
  assert.ok(parallel.ok && sequential.ok);
  assert.deepEqual(parallel.features, sequential.features);
  assert.deepEqual(parallel.signals, sequential.signals);
  assert.deepEqual(parallel.usage, sequential.usage);
  assert.deepEqual(parallel.stageResults, { vision: { ok: true }, ocrFront: { ok: true }, ocrBack: { ok: true } });
  assert.deepEqual(traces.filter(event => event.phase === "finished").map(event => event.stage), ["ocrBack", "vision", "ocrFront"]);
});

test("병렬 HTTP 실패와 OCR 형식 오류는 모두 수집하되 부분 성공을 검색 특징으로 승격하지 않는다", async () => {
  const prepared = await preparedPromise;
  const bodies = Object.values(prepared.requests).map(value => JSON.stringify(value));
  for (const failedStage of [0, 1]) {
    let calls = 0;
    const traces: PillPhotoRequestTrace[] = [];
    const result = await extractPreparedPillPhotos(prepared, {
      allowExternalTransfer: true, executionMode: "parallel", apiKey: "synthetic-key",
      onRequestTrace: async event => { traces.push(event); },
      fetchImpl: async (_url, init) => {
        calls++;
        const index = bodies.indexOf(String(init?.body));
        if (index === failedStage) return failedStage === 0
          ? new Response("sensitive error body", { status: 429 })
          : Response.json(response({ invalid: "sensitive error body" }));
        return Response.json(response([features(), side("T0"), side("10")][index]));
      },
    });
    assert.equal(calls, 3);
    assert.equal(traces.length, 6);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, failedStage === 0 ? "rate_limited" : "ocr_failed");
    assert.equal(result.stageResults?.ocrBack.ok, true);
    assert.equal(result.stageResults?.[failedStage === 0 ? "vision" : "ocrFront"].ok, false);
    assert.ok(!("features" in result));
    assert.doesNotMatch(JSON.stringify(result), /sensitive error body/);
  }
});

test("병렬 기록 예외도 나머지 요청과 콜백 종료를 기다린 뒤 원문 없는 오류로 반환한다", async () => {
  const prepared = await preparedPromise;
  const bodies = Object.values(prepared.requests).map(value => JSON.stringify(value));
  const finished: string[] = [];
  await assert.rejects(extractPreparedPillPhotos(prepared, {
    allowExternalTransfer: true, executionMode: "parallel", apiKey: "synthetic-key",
    fetchImpl: async (_url, init) => {
      await new Promise<void>(resolve => setImmediate(resolve));
      return Response.json(response([features(), side("T0"), side("10")][bodies.indexOf(String(init?.body))]));
    },
    onRequestTrace: async event => {
      if (event.stage === "vision") throw new Error("private recording details");
      if (event.phase === "finished") {
        await new Promise<void>(resolve => setImmediate(resolve));
        finished.push(event.stage);
      }
    },
  }), { message: "photo_request_recording_failed" });
  assert.deepEqual(finished.sort(), ["ocrBack", "ocrFront"]);
});

test("병렬도 동의·키·모드·세 요청 전체 크기를 먼저 검증해 잘못된 입력은 0회 전송한다", async () => {
  let calls = 0;
  const prepared = structuredClone(await preparedPromise);
  const fetchImpl: typeof fetch = async () => { calls++; throw new Error("must not send"); };
  const options = { executionMode: "parallel" as const, fetchImpl, allowExternalTransfer: true, apiKey: "synthetic-key" };
  assert.equal((await extractPreparedPillPhotos(prepared, { ...options, allowExternalTransfer: false })).ok, false);
  assert.equal((await extractPreparedPillPhotos(prepared, { ...options, apiKey: "" })).ok, false);
  assert.equal((await extractPreparedPillPhotos(prepared, { ...options, executionMode: "invalid" as "parallel" })).ok, false);
  prepared.requests.ocrBack.instructions = "x".repeat(32 * 1024 * 1024);
  assert.equal((await extractPreparedPillPhotos(prepared, options)).ok, false);
  assert.equal(calls, 0);
});
