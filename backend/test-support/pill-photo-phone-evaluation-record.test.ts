import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  fixtureIdentitySummary,
  inspectPillPhotoPhonePrivateFixtureState,
  loadPillPhotoPhoneEvaluationRecord,
} from "./pill-photo-phone-evaluation-record.ts";
import {
  loadPillPhotoPhoneHoldoutFixture,
  loadPillPhotoPhoneValidationFixture,
} from "./pill-photo-phone-validation.ts";

test("Git에 포함한 스마트폰 평가 기록은 버전·해시·실행 조건·비민감 점수를 고정한다", async () => {
  const record = await loadPillPhotoPhoneEvaluationRecord();
  assert.equal(record.productionReadinessClaim, false);
  assert.equal(record.currentMinimumCasesForPass, 6);
  assert.deepEqual(record.fixtures.map((fixture) => fixture.counts), [
    { products: 6, cases: 6, images: 12 },
    { products: 6, cases: 6, images: 12 },
  ]);
  assert.equal(record.runs.every((run) => run.metrics.totalCases === 6 && run.metrics.evaluatedCases === 6), true);
  assert.deepEqual(record.runs.map((run) => run.metrics.recallAt5.hits), [6, 5, 2]);
  assert.equal(record.runs.every((run) => run.metrics.strongWrongCandidates === 0), true);
  assert.equal(record.runs.every((run) => run.metrics.retakeCandidateExposureCases === 0), true);
});

test("깨끗한 체크아웃은 metadata-only로 구분하고 비공개 원본이 있으면 해시까지 대조한다", async () => {
  const missingRoot = join(tmpdir(), `pill-photo-private-fixture-not-present-${process.pid}-${Date.now()}`);
  assert.deepEqual(await inspectPillPhotoPhonePrivateFixtureState({
    validationDirectory: join(missingRoot, "validation"),
    holdoutDirectory: join(missingRoot, "holdout"),
  }), { validation: "metadata_only", holdout: "metadata_only" });

  const [record, state] = await Promise.all([
    loadPillPhotoPhoneEvaluationRecord(),
    inspectPillPhotoPhonePrivateFixtureState(),
  ]);
  assert.equal(state.validation, state.holdout);
  if (state.validation === "metadata_only") {
    assert.equal(record.rawInputs.gitTracked, false);
    assert.equal(record.rawInputs.cleanCheckoutMode, "metadata_only_without_private_photos_or_raw_model_outputs");
    return;
  }

  const [validation, holdout] = await Promise.all([
    loadPillPhotoPhoneValidationFixture(),
    loadPillPhotoPhoneHoldoutFixture(),
  ]);
  for (const loaded of [validation, holdout]) {
    const expected = record.fixtures.find((fixture) => fixture.split === loaded.manifest.scope.split)!;
    assert.equal(loaded.manifest.fixtureVersion, expected.fixtureVersion);
    assert.equal(loaded.manifest.catalogFixtureVersion, expected.catalogFixtureVersion);
    assert.deepEqual(fixtureIdentitySummary(loaded.manifest), {
      imageSha256: expected.imageSha256,
      productIdentitySha256: expected.productIdentitySha256,
      officialRecordSha256: expected.officialRecordSha256,
    });
  }
});
