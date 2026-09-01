import assert from "node:assert/strict";
import test from "node:test";
import { observedSide, pillObservation } from "../test-support/pill-fixtures.ts";
import {
  PILL_PHOTO_FUSION_VERSION,
  PILL_PHOTO_OCR_SCHEMA_VERSION,
  fusePillPhotoSignals,
  pillPhotoOcrFeaturesSchema,
} from "./pill-photo-ocr.ts";

function visionFeatures() {
  const { source, ...observation } = pillObservation();
  assert.equal(source, "manual");
  return { observation, pairConsistency: "consistent" as const, bothSidesVisible: true, imageArtifact: "none" as const };
}

function ocrFeatures(front: string[] = ["T0"], back: string[] = ["10"]) {
  return {
    schemaVersion: PILL_PHOTO_OCR_SCHEMA_VERSION,
    front: { imprintCandidates: front, noImprintObserved: false, imprintVisibility: front.length ? "clear" as const : "unreadable" as const },
    back: { imprintCandidates: back, noImprintObserved: false, imprintVisibility: back.length ? "clear" as const : "unreadable" as const },
  };
}

test("Vision과 OCR이 같은 각인을 읽으면 합의 근거를 보존하고 clear로 유지한다", () => {
  const vision = visionFeatures();
  vision.observation.front = observedSide("T0", "unknown");
  const result = fusePillPhotoSignals(vision, ocrFeatures());
  assert.equal(result.evidence.version, PILL_PHOTO_FUSION_VERSION);
  assert.deepEqual(result.features.observation.front?.imprintCandidates, ["T0"]);
  assert.equal(result.features.observation.front?.imprintVisibility, "clear");
  assert.equal(result.evidence.front.consensusCandidateCount, 1);
  assert.deepEqual(result.evidence.front.outputCandidates[0]?.signals.map((signal) => signal.source), ["vision", "ocr"]);
});

test("서로 다른 판독은 버리지 않고 양쪽 신호를 교차 배치하되 partial로 제한한다", () => {
  const vision = visionFeatures();
  vision.observation.front = { ...observedSide("OPC", "unknown"), imprintCandidates: ["OPC", "0PC", "QPC", "DPC", "CPC"] };
  const ocr = ocrFeatures(["OPQ", "0PQ"], ["10"]);
  const before = JSON.stringify({ vision, ocr });
  const result = fusePillPhotoSignals(vision, ocr);
  assert.deepEqual(result.features.observation.front?.imprintCandidates, ["OPC", "OPQ", "0PC", "0PQ", "QPC"]);
  assert.equal(result.features.observation.front?.imprintVisibility, "partial");
  assert.equal(result.evidence.front.disagreement, true);
  assert.equal(result.evidence.front.truncated, true);
  assert.deepEqual(result.evidence.front.outputCandidates.map((entry) => entry.signals[0]?.source), ["vision", "ocr", "vision", "ocr", "vision"]);
  assert.equal(JSON.stringify({ vision, ocr }), before);
});

test("공백·대소문자만 다른 판독은 첫 원문을 보존한 하나의 합의 후보가 된다", () => {
  const vision = visionFeatures();
  vision.observation.front = { ...observedSide("A 5", "unknown"), imprintCandidates: ["A 5"] };
  const result = fusePillPhotoSignals(vision, ocrFeatures(["a5"], ["10"]));
  assert.deepEqual(result.features.observation.front?.imprintCandidates, ["A 5"]);
  assert.equal(result.evidence.front.outputCandidates[0]?.normalized, "A5");
  assert.deepEqual(result.evidence.front.outputCandidates[0]?.signals.map((signal) => signal.value), ["A 5", "a5"]);
});

test("직접 확인한 무각인은 두 신호가 합의할 때만 확정하고 누락 면의 OCR은 무시한다", () => {
  const vision = visionFeatures();
  vision.observation.front = observedSide("", "none");
  vision.observation.back = null;
  const ocr = ocrFeatures([], ["NOISE"]);
  ocr.front = { imprintCandidates: [], noImprintObserved: true, imprintVisibility: "clear" };
  const result = fusePillPhotoSignals(vision, ocr);
  assert.equal(result.features.observation.front?.noImprintObserved, true);
  assert.equal(result.features.observation.back, null);
  assert.equal(result.evidence.back.ocrIgnoredBecauseVisionSideMissing, true);
  assert.equal(result.evidence.back.disagreement, true);
});

test("OCR 계약은 약명·품목코드와 모순된 무각인 상태를 허용하지 않는다", () => {
  const valid = ocrFeatures();
  assert.equal(pillPhotoOcrFeaturesSchema.safeParse(valid).success, true);
  assert.equal(pillPhotoOcrFeaturesSchema.safeParse({ ...valid, productName: "임의 약" }).success, false);
  assert.equal(pillPhotoOcrFeaturesSchema.safeParse({ ...valid, itemSeq: "200801352" }).success, false);
  assert.equal(pillPhotoOcrFeaturesSchema.safeParse({
    ...valid,
    front: { imprintCandidates: ["A"], noImprintObserved: true, imprintVisibility: "clear" },
  }).success, false);
});
