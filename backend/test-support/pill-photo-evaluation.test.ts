import assert from "node:assert/strict";
import test from "node:test";
import { loadPillPhotoEvaluationFixture, PILL_PHOTO_EVALUATION_VERSION } from "./pill-photo-evaluation.ts";
import { PILL_PHOTO_FILES } from "./pill-photo-review.ts";

test("미사용 공개사진 16장을 검증·보류 평가 4쌍씩 해시와 함께 고정한다", async () => {
  const { manifest } = await loadPillPhotoEvaluationFixture();
  assert.equal(manifest.fixtureVersion, PILL_PHOTO_EVALUATION_VERSION);
  assert.equal(manifest.scope.claim, "capture_level_repeatability_only");
  assert.equal(manifest.products.length, 4);
  assert.equal(manifest.images.length, 16);
  assert.equal(manifest.cases.length, 8);
  assert.deepEqual(
    manifest.cases.map((fixtureCase) => fixtureCase.split),
    ["validation", "validation", "validation", "validation", "holdout", "holdout", "holdout", "holdout"],
  );
  for (const split of ["validation", "holdout"] as const) {
    const cases = manifest.cases.filter((fixtureCase) => fixtureCase.split === split);
    assert.equal(cases.length, 4);
    assert.equal(new Set(cases.map((fixtureCase) => fixtureCase.expectedItemSeq)).size, 4);
  }
  const developmentHashes = new Set<string>(PILL_PHOTO_FILES.map((image) => image.sha256));
  assert.equal(manifest.images.some((image) => developmentHashes.has(image.sha256)), false);
});

test("모델용 입력에는 정답 품목·접수번호·공식 면·해시가 들어가지 않는다", async () => {
  const { inferenceInputs } = await loadPillPhotoEvaluationFixture();
  assert.equal(inferenceInputs.length, 8);
  for (const input of inferenceInputs) {
    assert.deepEqual(Object.keys(input), ["id", "split", "photos"]);
    assert.match(input.id, /^capture-[vh]-0[1-4]$/);
    assert.equal(input.photos.length, 2);
    assert.equal(input.photos.every((path) => path.endsWith(".png")), true);
    const serialized = JSON.stringify(input);
    assert.doesNotMatch(serialized, /expectedItemSeq|receipt|officialSide|sha256/);
    assert.doesNotMatch(serialized, /201505259|201800300|201906970|200801352/);
    assert.doesNotMatch(serialized, /29002|40792|41107|41344|IMG_/);
  }
});

test("정답 특징은 고정 식약처 카탈로그와 연결되고 품목별 공식 양면을 포함한다", async () => {
  const { manifest } = await loadPillPhotoEvaluationFixture();
  const imageByPath = new Map(manifest.images.map((image) => [image.path, image]));
  for (const fixtureCase of manifest.cases) {
    assert.deepEqual(
      new Set(fixtureCase.photos.map((path) => imageByPath.get(path)?.officialSide)),
      new Set(["front", "back"]),
    );
    assert.equal(manifest.products.some((product) => product.receipt === fixtureCase.receipt
      && product.expectedItemSeq === fixtureCase.expectedItemSeq), true);
  }
});
