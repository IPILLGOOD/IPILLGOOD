import assert from "node:assert/strict";
import test from "node:test";
import { loadPillPhotoEvaluationFixture } from "./pill-photo-evaluation.ts";
import { PILL_PHOTO_FILES } from "./pill-photo-review.ts";
import {
  loadPillPhotoUnseenEvaluationFixture,
  PILL_PHOTO_UNSEEN_EVALUATION_VERSION,
} from "./pill-photo-unseen-evaluation.ts";

test("기존에 쓰지 않은 7개 품목을 개발 4건과 봉인 holdout 3건으로 고정한다", async () => {
  const [{ manifest }, previous] = await Promise.all([
    loadPillPhotoUnseenEvaluationFixture(),
    loadPillPhotoEvaluationFixture(),
  ]);
  assert.equal(manifest.fixtureVersion, PILL_PHOTO_UNSEEN_EVALUATION_VERSION);
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.scope.claim, "unseen_product_generalization_pilot");
  assert.equal(manifest.products.length, 7);
  assert.equal(manifest.images.length, 14);
  assert.equal(manifest.cases.length, 7);
  assert.equal(manifest.splitPolicy.holdoutStatus, "sealed_unopened");

  const validation = manifest.cases.filter((fixtureCase) => fixtureCase.split === "validation");
  const holdout = manifest.cases.filter((fixtureCase) => fixtureCase.split === "holdout");
  assert.equal(validation.length, 4);
  assert.equal(holdout.length, 3);
  assert.equal(new Set(validation.map((fixtureCase) => fixtureCase.expectedItemSeq)).size, 4);
  assert.equal(new Set(holdout.map((fixtureCase) => fixtureCase.expectedItemSeq)).size, 3);
  assert.equal(validation.some((left) => holdout.some((right) => right.expectedItemSeq === left.expectedItemSeq)), false);

  const previousHashes = new Set([
    ...PILL_PHOTO_FILES.map((image) => image.sha256),
    ...previous.manifest.images.map((image) => image.sha256),
  ]);
  assert.equal(manifest.images.some((image) => previousHashes.has(image.sha256)), false);
});

test("새 모델 입력에는 정답·원본 그룹·공식 면·해시가 들어가지 않는다", async () => {
  const { inferenceInputs } = await loadPillPhotoUnseenEvaluationFixture();
  assert.equal(inferenceInputs.length, 7);
  for (const input of inferenceInputs) {
    assert.deepEqual(Object.keys(input), ["id", "split", "photos"]);
    assert.match(input.id, /^unseen-[vh]-0[1-4]$/);
    assert.equal(input.photos.length, 2);
    assert.equal(input.photos.every((path) => path.endsWith(".png")), true);
    const serialized = JSON.stringify(input);
    assert.doesNotMatch(serialized, /expectedItemSeq|sourceGroup|officialSide|sha256|mappingEvidenceUrl/);
    assert.doesNotMatch(serialized, /200502050|201803136|201902911|201907290|201907803|199603340|202107747/);
    assert.doesNotMatch(serialized, /34342|40720|40949|40953|41097|41169|40767|IMG_/);
  }
});

test("새 정답은 고정 식약처 레코드와 연결되고 각 사례는 공식 양면을 포함한다", async () => {
  const { manifest } = await loadPillPhotoUnseenEvaluationFixture();
  assert.equal(new Set(manifest.products.map((product) => product.mappingEvidenceUrl)).size, 7);
  assert.equal(manifest.products.every((product) => /^[a-f0-9]{64}$/.test(product.expectedOfficialRecordSha256)), true);
  const imageByPath = new Map(manifest.images.map((image) => [image.path, image]));
  for (const fixtureCase of manifest.cases) {
    assert.deepEqual(
      new Set(fixtureCase.photos.map((path) => imageByPath.get(path)?.officialSide)),
      new Set(["front", "back"]),
    );
    assert.equal(manifest.products.some((product) => product.sourceGroup === fixtureCase.sourceGroup
      && product.expectedItemSeq === fixtureCase.expectedItemSeq), true);
  }
});
