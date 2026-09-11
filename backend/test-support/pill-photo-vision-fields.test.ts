import test from "node:test";
import assert from "node:assert/strict";
import { traceVisionFields } from "./pill-photo-vision-fields.ts";
import { pillEnvelope, pillRecord, pillObservation, observedSide } from "./pill-fixtures.ts";
import { parseOfficialPillPage } from "../src/official-pill-catalog.ts";
import { pillPhotoFeaturesSchema } from "../src/pill-photo-features.ts";
import { PILL_PHOTO_OCR_SCHEMA_VERSION } from "../src/pill-photo-ocr.ts";

function scenario() {
  const page = parseOfficialPillPage(pillEnvelope([pillRecord({ PRINT_FRONT: "UV", PRINT_BACK: "RQ" })]), "json", "2026-09-01T00:00:00.000Z");
  const { source, ...observation } = pillObservation({ front: observedSide("UV", "none"), back: observedSide("RQ", "none") });
  assert.equal(source, "manual");
  const before = pillPhotoFeaturesSchema.parse({ observation, pairConsistency: "consistent", bothSidesVisible: true, imageArtifact: "none" });
  return { before, after: structuredClone(before), catalog: { ...page, completeness: "complete" as const, version: "synthetic" },
    itemSeq: page.items[0]!.itemSeq,
    ocr: { schemaVersion: PILL_PHOTO_OCR_SCHEMA_VERSION, front: observedSide("UV", "none"), back: observedSide("RQ", "none") } };
}
function run(data: ReturnType<typeof scenario>) {
  const { scoreLine: a, ...front } = data.ocr.front, { scoreLine: b, ...back } = data.ocr.back;
  assert.equal(a, "none"); assert.equal(b, "none");
  return traceVisionFields(data.before, data.after, { ...data.ocr, front, back }, data.itemSeq, data.catalog);
}
test("동일 관찰은 개입 없음, 결정적 출력이며 원문·OCR을 수정하거나 외부 요청하지 않는다", t => {
  t.mock.method(globalThis, "fetch", () => { throw Error("network_forbidden"); });
  const data = scenario(), original = JSON.stringify(data), result = run(data);
  assert.deepEqual(result.interventions, []); assert.deepEqual(result.before, result.after);
  assert.deepEqual(result, run(data)); assert.equal(JSON.stringify(data), original);
  assert.equal(result.usedForAccuracyMetrics, false);
});
test("각인 후보와 판독 상태를 따로 바꿔 계약 위반 조합은 거절하고 전체 면 교체는 보존한다", () => {
  const data = scenario(); data.after.observation.front = observedSide("", "none");
  const result = run(data);
  assert.ok(result.interventions.some(change => change.directions.some(direction => !direction.valid && direction.result === null)));
  const side = result.interventions.find(change => change.kind === "whole_observed_side")!;
  assert.deepEqual(side.directions[0]!.result, result.after); assert.deepEqual(side.directions[1]!.result, result.before);
});
test("안전 필드 단독 교체도 그대로 적용하고 후보 노출을 방지한다", () => {
  const data = scenario(); data.after.pairConsistency = "inconsistent";
  const result = run(data), forward = result.interventions[0]!.directions[0]!.result!;
  assert.equal(forward.search.comparisonStatus, "needs_retake"); assert.deepEqual(forward.search.candidates, []);
  assert.deepEqual(result.interventions[0]!.directions[1]!.result, result.before);
});
test("정답 라벨은 검색 후 대조에만 사용되어 관찰·결합 및 후보 순서를 바꾸지 않는다", () => {
  const data = scenario(), first = run(data); data.itemSeq = "999999999"; const second = run(data);
  assert.deepEqual(first.before.features, second.before.features); assert.deepEqual(first.before.fusion, second.before.fusion);
  assert.deepEqual(first.before.search.candidates, second.before.search.candidates);
  assert.equal(second.before.search.expectedRank, null);
});
