import assert from "node:assert/strict";
import test from "node:test";
import { diffPillRegressionRows, evaluatePillRegressionGates } from "../scripts/pill-regression.ts";
import { runPillPhotoExperiment } from "../scripts/pill-photo.ts";
import { loadFrozenPillPhotoFixture } from "../test-support/pill-photo-fixture.ts";

function row(id: string, candidates: string[], heldCandidates: string[], reason = "features_compared") {
  return {
    id,
    comparison: {
      status: "searched",
      reason,
      search: {
        status: "candidates_found",
        reason: "comparison_required",
        candidates: candidates.map((itemSeq) => ({ itemSeq })),
        heldCandidates: heldCandidates.map((itemSeq) => ({ itemSeq })),
      },
    },
    evaluation: { outcome: "expected_candidate_found", expectedGateObserved: null },
  };
}

test("과거/현재 비교는 후보·보류 후보·거절 사유의 변경만 고정 순서로 기록한다", () => {
  const previous = [row("a", ["200801352"], [], "old_reason")];
  const current = [row("a", ["200801352", "201000984"], ["202000515"], "new_reason")];
  const diff = diffPillRegressionRows(previous, current);
  assert.deepEqual(diff.map((entry) => entry.id), ["a"]);
  assert.deepEqual(diff[0]?.changes.map((change) => change.field), [
    "comparisonReason", "candidateItemSeqs", "heldCandidateItemSeqs",
  ]);
  assert.deepEqual(diffPillRegressionRows(current, current), []);
  assert.throws(() => diffPillRegressionRows(previous, []), /regression_case_mismatch/);
  assert.throws(() => diffPillRegressionRows(previous, [...current, row("extra", [], [])]), /regression_case_mismatch/);
});

test("고정 실사진 안전 조건과 결정형 검색 조건은 네트워크 없이 회귀 실패를 판별한다", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("regression_must_be_offline"); };
  try {
    const fixture = await loadFrozenPillPhotoFixture();
    const replay = await runPillPhotoExperiment(["replay"]);
    const gates = evaluatePillRegressionGates(replay.report, fixture.catalog);
    assert.equal(calls, 0);
    assert.equal(replay.report.requests, 0);
    assert.equal(gates.length, 6);
    assert.equal(gates.every((gate) => gate.passed), true);

    const weakenedSafety = structuredClone(replay.report);
    const cutout = weakenedSafety.rows.find((entry) => entry.id === "image-cutout")!;
    cutout.evaluation.expectedGateObserved = false;
    assert.equal(evaluatePillRegressionGates(weakenedSafety, fixture.catalog)
      .find((gate) => gate.id === "real-photo-cutout-quality-gate")?.passed, false);

    const weakenedImprints = {
      ...fixture.catalog,
      items: fixture.catalog.items.map((item) => item.itemSeq === "200801352"
        ? { ...item, front: { ...item.front, imprint: "ZZ" }, back: { ...item.back, imprint: "YY" } }
        : item),
    };
    const weakenedGates = evaluatePillRegressionGates(replay.report, weakenedImprints);
    for (const id of [
      "exact-imprint-survives-color-conflict",
      "multiple-imprint-candidate-retained",
      "confusion-expansion-candidate-retained",
    ]) assert.equal(weakenedGates.find((gate) => gate.id === id)?.passed, false);

    const changes = diffPillRegressionRows(fixture.baseline.rows, replay.report.rows);
    const cutoutDiff = changes.find((entry) => entry.id === "image-cutout");
    assert.ok(cutoutDiff?.changes.some((change) => change.field === "comparisonReason"));
    assert.ok(cutoutDiff?.changes.some((change) => change.field === "expectedGateObserved"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
