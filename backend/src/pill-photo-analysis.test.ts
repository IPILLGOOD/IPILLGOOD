import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { pillEnvelope, pillObservation, pillRecord } from "../test-support/pill-fixtures.ts";
import { parseOfficialPillPage } from "./official-pill-catalog.ts";
import type { PillCatalog } from "./pill-identification.ts";
import { analyzePillPhotos, analyzePreparedPillPhotos } from "./pill-photo-analysis.ts";
import { comparePillPhotoFeatures, pillPhotoFeaturesSchema, type PillPhotoFeatures } from "./pill-photo-features.ts";
import { PILL_PHOTO_OCR_SIDE_SCHEMA_VERSION } from "./pill-photo-ocr.ts";
import {
  extractPreparedPillPhotos, preparePhonePillPhotoRequests,
  type PillPhotoExecutionMode, type PillPhotoOcrImageCount, type PreparedPillPhotoRequests,
} from "./pill-photo-pipeline.ts";

const models = { model: "gpt-5.6-sol", ocrModel: "gpt-5.6-sol" };
const consent = { allowExternalTransfer: true, apiKey: "synthetic-test-credential" };
// In-memory synthetic pixels and responses only; no local user files or real API requests.
const sourcesPromise = Promise.all([
  sharp({ create: { width: 128, height: 96, channels: 3, background: "#ddd6b8" } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer(),
  sharp({ create: { width: 128, height: 96, channels: 3, background: "#aaa8b8" } }).jpeg().toBuffer(),
]).then(([front, back]) => [front!, back!] as const);
const preparedByCount = new Map<PillPhotoOcrImageCount, Promise<PreparedPillPhotoRequests>>();
function preparedFor(ocrImageCount: PillPhotoOcrImageCount) {
  if (!preparedByCount.has(ocrImageCount)) {
    preparedByCount.set(ocrImageCount, sourcesPromise.then(async sources => {
      const prepared = await preparePhonePillPhotoRequests(sources, { ...models, ocrImageCount });
      assert.equal(prepared.ok, true);
      return prepared as PreparedPillPhotoRequests;
    }));
  }
  return preparedByCount.get(ocrImageCount)!;
}
function catalog(): PillCatalog {
  return { ...parseOfficialPillPage(pillEnvelope([pillRecord()]), "json", "2026-08-31T00:00:00.000Z"),
    completeness: "complete", version: "synthetic-test" };
}
function features(overrides: Partial<PillPhotoFeatures> = {}) {
  const { source, ...observation } = pillObservation();
  assert.equal(source, "manual");
  return pillPhotoFeaturesSchema.parse({ observation, pairConsistency: "consistent", bothSidesVisible: true,
    imageArtifact: "none", ...overrides });
}
function side(imprint: string) {
  return { schemaVersion: PILL_PHOTO_OCR_SIDE_SCHEMA_VERSION,
    side: { imprintCandidates: [imprint], noImprintObserved: false, imprintVisibility: "clear" } };
}
function response(value: unknown) {
  return Response.json({ id: "resp_synthetic", model: models.model, status: "completed",
    output: [{ type: "message", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: JSON.stringify(value) }] }],
    usage: { input_tokens: 100, output_tokens: 20 } });
}
function mockProvider(vision = features()) {
  const bodies: string[] = [];
  const outputs = [vision, side("TEST"), side("10")];
  const fetchImpl: typeof fetch = async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${consent.apiKey}`);
    assert.equal(typeof init.body, "string");
    const index = bodies.length;
    bodies.push(init.body as string);
    assert.ok(index < 3, "a single analysis must send exactly three requests without retries");
    return response(outputs[index]);
  };
  return { fetchImpl, bodies };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => { resolve = settle; });
  return { promise, resolve };
}

for (const ocrImageCount of [8, 4] as const) {
  test(`공통 분석 ${ocrImageCount}장 진입점은 기존 요청·특징·후보를 그대로 보존하고 입력을 변경하지 않는다`, async () => {
    const [front, back] = await sourcesPromise;
    const prepared = await preparedFor(ocrImageCount);
    const data = catalog();
    const before = JSON.stringify(data);
    const sourceCopies = [Buffer.from(front), Buffer.from(back)];
    const legacyProvider = mockProvider();
    const oldExtraction = await extractPreparedPillPhotos(prepared,
      { ...consent, executionMode: "parallel", fetchImpl: legacyProvider.fetchImpl });
    assert.equal(oldExtraction.ok, true);
    if (!oldExtraction.ok) return;
    const expectedComparison = comparePillPhotoFeatures(oldExtraction.features, data);
    const provider = mockProvider();
    // Omitting this option in the eight-image case proves the public default is unchanged.
    const result = await analyzePillPhotos({ front, back, catalog: data, ...models, ...consent,
      ...(ocrImageCount === 4 ? { ocrImageCount } : {}), fetchImpl: provider.fetchImpl });
    assert.equal(result.schemaVersion, "pill-photo-analysis.v1");
    assert.equal(result.ok, true);
    assert.equal("reason" in result, false);
    assert.deepEqual(provider.bodies, legacyProvider.bodies);
    assert.deepEqual(result.extraction, oldExtraction);
    assert.deepEqual(result.comparison, expectedComparison);
    assert.equal(result.comparison?.search?.candidates[0]?.itemSeq, "209900001");
    assert.deepEqual(result.sourceSha256, prepared.sourceSha256);
    assert.deepEqual(result.preprocessing, prepared.preprocessing);
    assert.equal(JSON.stringify(data), before);
    assert.deepEqual([front, back], sourceCopies);
    for (const elapsed of [...Object.values(result.timings), result.elapsedMs]) {
      assert.ok(Number.isFinite(elapsed) && elapsed >= 0);
    }
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /synthetic-test-credential|image_url|data:image|"requests"/);
    assert.equal(serialized.includes(front.toString("base64")), false);
    assert.equal(serialized.includes(back.toString("base64")), false);
  });
}

test("사전 전처리 진입점은 다시 전처리하지 않고 명시적 순차 실행과 기존 결과를 보존한다", async () => {
  const prepared = await preparedFor(4);
  const before = JSON.stringify(prepared);
  const legacyProvider = mockProvider();
  const expected = await extractPreparedPillPhotos(prepared,
    { ...consent, executionMode: "sequential", fetchImpl: legacyProvider.fetchImpl });
  const provider = mockProvider();
  const result = await analyzePreparedPillPhotos(prepared, catalog(),
    { ...consent, executionMode: "sequential", fetchImpl: provider.fetchImpl });
  assert.equal(result.ok, true);
  assert.deepEqual(result.extraction, expected);
  assert.deepEqual(provider.bodies, legacyProvider.bodies);
  assert.equal(result.timings.preprocessingMs, 0);
  assert.equal(JSON.stringify(prepared), before);
});

test("사진·설정·전송 동의·키 검증 실패는 외부 요청과 검색 없이 반환한다", async () => {
  const [front, back] = await sourcesPromise;
  const base = { front, back, catalog: catalog(), ...models, ...consent };
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls++; throw new Error("must_not_call"); };
  const cases = [
    { patch: { front: new Uint8Array() }, reason: "invalid_photo" },
    { patch: { back: front }, reason: "duplicate_photo" },
    { patch: { model: "sk-synthetic-not-a-model" }, reason: "not_configured" },
    { patch: { ocrImageCount: 6 as PillPhotoOcrImageCount }, reason: "invalid_request" },
    { patch: { executionMode: "invalid" as PillPhotoExecutionMode }, reason: "invalid_request" },
    { patch: { allowExternalTransfer: false }, reason: "transfer_not_confirmed" },
    { patch: { apiKey: " " }, reason: "not_configured" },
  ];
  for (const { patch, reason } of cases) {
    const result = await analyzePillPhotos({ ...base, ...patch, fetchImpl });
    assert.equal(result.ok, false, reason);
    if (result.ok) continue;
    assert.equal(result.reason, reason);
    assert.equal(result.comparison, null);
    assert.equal(result.timings.searchMs, 0);
    assert.equal(calls, 0);
  }
  const prepared = await preparedFor(8);
  const denied = await analyzePreparedPillPhotos(prepared, catalog(), { fetchImpl });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.reason, "transfer_not_confirmed");
  assert.equal(calls, 0);
});

test("기본 병렬 실행은 한 OCR이 실패해도 다른 요청 종료를 기다리고 부분 후보를 검색하지 않는다", { timeout: 15_000 }, async () => {
  const prepared = await preparedFor(8);
  const allStarted = deferred<void>();
  const releaseBack = deferred<Response>();
  let calls = 0;
  let searched = false;
  const data = catalog();
  Object.defineProperty(data, "items", { get() { searched = true; throw new Error("must_not_search"); } });
  const fetchImpl: typeof fetch = async () => {
    const index = calls++;
    if (calls === 3) allStarted.resolve();
    if (index === 0) return response(features());
    if (index === 1) return response({ invalidOcr: true });
    return releaseBack.promise;
  };
  let finished = false;
  const pending = analyzePreparedPillPhotos(prepared, data, { ...consent, fetchImpl })
    .then(result => { finished = true; return result; });
  await allStarted.promise;
  await Promise.resolve();
  assert.equal(finished, false);
  assert.equal(calls, 3);
  releaseBack.resolve(response(side("10")));
  const result = await pending;
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "ocr_failed");
  assert.deepEqual(result.extraction?.stageResults, {
    vision: { ok: true }, ocrFront: { ok: false, reason: "ocr_failed" }, ocrBack: { ok: true },
  });
  assert.equal(result.comparison, null);
  assert.equal(result.timings.searchMs, 0);
  assert.equal(searched, false);
});

test("관찰자 예외도 진행 중 요청을 마친 후 안전한 오류로 반환하며 원문을 노출하지 않는다", { timeout: 15_000 }, async () => {
  const prepared = await preparedFor(8);
  const allStarted = deferred<void>();
  const releaseBack = deferred<Response>();
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    const index = calls++;
    if (calls === 3) allStarted.resolve();
    if (index === 0) return response(features());
    if (index === 1) return response(side("TEST"));
    return releaseBack.promise;
  };
  let finished = false;
  const pending = analyzePreparedPillPhotos(prepared, catalog(), { ...consent, fetchImpl,
    onRequestTrace: async event => {
      if (event.stage === "vision" && event.phase === "finished") throw new Error("synthetic-secret-observer-error");
    },
  }).then(result => { finished = true; return result; });
  await allStarted.promise;
  await Promise.resolve();
  assert.equal(finished, false);
  releaseBack.resolve(response(side("10")));
  const result = await pending;
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "analysis_failed");
  assert.equal(calls, 3);
  assert.equal(result.comparison, null);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-secret|observer-error|synthetic-test-credential|data:image/);
});

test("검색 예외는 정상 추출을 약 후보 성공으로 표시하지 않고 안전한 실패로 반환한다", async () => {
  const prepared = await preparedFor(8);
  const data = catalog();
  Object.defineProperty(data, "items", { get() { throw new Error("synthetic-private-catalog-path"); } });
  const provider = mockProvider();
  const result = await analyzePreparedPillPhotos(prepared, data, { ...consent, fetchImpl: provider.fetchImpl });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "analysis_failed");
  assert.equal(result.comparison, null);
  assert.equal(provider.bodies.length, 3);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-private|catalog-path|synthetic-test-credential|data:image/);
});

test("사진 쌍이 불확실하면 분석 완료와 재촬영 상태를 구분하여 기존 안전 판정을 보존한다", async () => {
  const prepared = await preparedFor(8);
  const provider = mockProvider(features({ pairConsistency: "uncertain" }));
  const data = catalog();
  Object.defineProperty(data, "items", { get() { throw new Error("retake_must_not_search"); } });
  const result = await analyzePreparedPillPhotos(prepared, data, { ...consent, fetchImpl: provider.fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.extraction?.ok, true);
  assert.equal(result.comparison?.status, "needs_retake");
  assert.equal(result.comparison?.reason, "unverified_photo_pair");
  assert.equal(result.comparison?.search, null);
  assert.equal(provider.bodies.length, 3);
});
