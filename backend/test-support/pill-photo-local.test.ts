// Explicit shared-fixture verification: all required public samples are in Git. NEVER calls an external API.
// node --experimental-strip-types --test backend/test-support/pill-photo-local.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { readReviewedPhoto } from "../scripts/pill-photo.ts";
import { extractReviewedPillPhotos, prepareReviewedPillPhoto, reviewedPhotoIndex } from "../src/pill-photo-experiment.ts";
import { PILL_PHOTO_FILES } from "./pill-photo-review.ts";

test("로컬 공개 원본 9개의 해시·디코딩과 전처리 크기·메타데이터 제거를 확인한다", async () => {
  for (let index = 0; index < PILL_PHOTO_FILES.length; index++) {
    const original = await readReviewedPhoto(index);
    assert.equal(reviewedPhotoIndex(original), index);
    const prepared = await prepareReviewedPillPhoto(original);
    const metadata = await sharp(prepared).metadata();
    assert.equal(metadata.format, "png");
    assert.equal(metadata.hasAlpha, false);
    assert.ok(metadata.width! <= 1024 && metadata.height! <= 1024);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.xmp, undefined);
    assert.deepEqual(await readReviewedPhoto(index), original);
  }
});

test("원본 복제·한 바이트 변경·전송 미승인은 실제 공개 파일이어도 외부 호출 전에 막는다", async () => {
  const a = await readReviewedPhoto(0), b = await readReviewedPhoto(1);
  let calls = 0;
  const options = { allowExternalTransfer: true, apiKey: "test-only-not-a-real-key", fetchImpl: (async () => { calls++; throw new Error("must_not_call"); }) as typeof fetch };
  assert.deepEqual(await extractReviewedPillPhotos([a, a], options), { ok: false, reason: "duplicate_photo" });
  const altered = Buffer.from(b); altered[100] = altered[100]! ^ 1;
  assert.deepEqual(await extractReviewedPillPhotos([a, altered], options), { ok: false, reason: "unreviewed_photo" });
  assert.deepEqual(await extractReviewedPillPhotos([a, b], { ...options, allowExternalTransfer: false }), { ok: false, reason: "transfer_not_confirmed" });
  assert.deepEqual(await extractReviewedPillPhotos([a, b], { ...options, apiKey: "" }), { ok: false, reason: "not_configured" });
  assert.equal(calls, 0);
});

test("공식 엔드포인트 고정·리다이렉트 금지·HTTP 실패 구분·재시도 없음을 모의 전송으로 확인한다", async () => {
  const pair = [await readReviewedPhoto(0), await readReviewedPhoto(1)] as const;
  for (const [status, expected] of [[401, "access_denied"], [403, "access_denied"], [429, "rate_limited"], [500, "provider_unavailable"]] as const) {
    let calls = 0;
    const result = await extractReviewedPillPhotos(pair, { allowExternalTransfer: true, apiKey: "test-only-not-a-real-key", model: "test-model", fetchImpl: async (url, init) => {
      calls++;
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.store, false);
      assert.equal(body.model, "test-model");
      assert.ok(!String(init?.body).includes("201505259"));
      assert.ok(!String(init?.body).includes("IMG_2020"));
      return new Response("private error text must not be returned", { status });
    } });
    assert.deepEqual(result, { ok: false, reason: expected });
    assert.equal(calls, 1);
  }
});

test("모의 응답의 잘못된 타입·초과 크기·깨진 JSON·리다이렉트·네트워크 오류를 차단한다", async () => {
  const pair = [await readReviewedPhoto(0), await readReviewedPhoto(1)] as const;
  const mocks = [
    () => new Response("{}", { headers: { "content-type": "text/html" } }),
    () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "9999999" } }),
    () => new Response("x".repeat(262145), { headers: { "content-type": "application/json" } }),
    () => new Response("not-json", { headers: { "content-type": "application/json" } }),
    () => { const r = new Response("{}", { headers: { "content-type": "application/json" } }); Object.defineProperty(r, "redirected", { value: true }); return r; },
  ];
  for (const mock of mocks) assert.deepEqual(await extractReviewedPillPhotos(pair, { allowExternalTransfer: true, apiKey: "test-only-not-a-real-key", fetchImpl: async () => mock() }), { ok: false, reason: "invalid_response" });
  assert.deepEqual(await extractReviewedPillPhotos(pair, { allowExternalTransfer: true, apiKey: "test-only-not-a-real-key", fetchImpl: async () => { throw new Error("private-error-with-secret"); } }), { ok: false, reason: "network_error" });
});
