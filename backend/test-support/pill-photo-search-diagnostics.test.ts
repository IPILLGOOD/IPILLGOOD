import assert from "node:assert/strict";
import test from "node:test";
import { parseOfficialPillPage } from "../src/official-pill-catalog.ts";
import { tracePillCandidates, searchPillCandidates, type PillCatalog } from "../src/pill-identification.ts";
import { comparePillPhotoFeatures, tracePillPhotoFeatures, pillPhotoSafetyFacts, pillPhotoFeaturesSchema } from "../src/pill-photo-features.ts";
import { PILL_PHOTO_FAILURE_REASONS } from "../src/pill-photo-failures.ts";
import { diagnosePillSearch, compareHistoricalPillRow } from "./pill-photo-search-diagnostics.ts";
import { scorePillPhotoEvaluation, parsePillPhotoScoreInput, type PillPhotoScoreInput } from "./pill-photo-score.ts";
import { PILL_PHOTO_REPRODUCTION_REQUIREMENTS } from "./pill-photo-phone-evaluation-record.ts";
import { pillRecord, pillEnvelope, pillObservation } from "./pill-fixtures.ts";

function catalog(records = [pillRecord()]): PillCatalog {
  return { ...parseOfficialPillPage(pillEnvelope(records), "json", "2026-08-31T00:00:00.000Z"), completeness: "complete", version: "synthetic-v1" };
}
function features() {
  const { source, ...observation } = pillObservation();
  assert.equal(source, "manual");
  return pillPhotoFeaturesSchema.parse({ observation, pairConsistency: "consistent", bothSidesVisible: true, imageArtifact: "none" });
}

test("진단 추가는 공개 결과·입력을 변경하지 않고 전체 검색의 25위를 기록한다", () => {
  const data = catalog(Array.from({ length: 25 }, (_, index) => pillRecord({ ITEM_SEQ: String(209900001 + index) })));
  const input = features(), before = structuredClone({ input, data });
  const ordinary = comparePillPhotoFeatures(input, data), traced = tracePillPhotoFeatures(input, data);
  assert.deepEqual(traced.comparison, ordinary);
  const diagnosis = diagnosePillSearch(input, data, "209900025");
  assert.equal(diagnosis.candidateRankBeforeLimit, 25);
  assert.equal(diagnosis.expectedRank, null);
  assert.equal(diagnosis.expectedDisposition, "eligible_outside_top20");
  assert.equal(diagnosis.competitors[0]!.comparisonToExpectedBest!.firstDifferentLevel, "item_code_tie_break");
  assert.deepEqual(traced.trace!.candidatesBeforeLimit.map(candidate => candidate.itemSeq), data.items.map(item => item.itemSeq));
  assert.deepEqual({ input, data }, before);
  assert.doesNotMatch(JSON.stringify(ordinary), /candidateRankBeforeLimit|recordOutcomes|matchingStarted|competitors/);
  assert.deepEqual(tracePillCandidates(pillObservation(), data, { limit: 2 }).result, searchPillCandidates(pillObservation(), data, { limit: 2 }));
  // Asking for a different answer label cannot change the candidate list or order.
  assert.deepEqual(diagnosePillSearch(input, data, "209900001").candidateItemSeqs, diagnosis.candidateItemSeqs);
});

test("같은 품목의 정상 variant와 정보 부족 variant는 후보·보류 양쪽 순위와 근거를 유지한다", () => {
  const data = catalog([pillRecord(), pillRecord({ PRINT_FRONT: "", PRINT_BACK: "" })]);
  const diagnosis = diagnosePillSearch(features(), data, "209900001");
  assert.equal(diagnosis.expectedMembership, "both");
  assert.equal(diagnosis.returnedMembership, "both");
  assert.equal(diagnosis.candidateRankBeforeLimit, 1);
  assert.equal(diagnosis.heldRankBeforeLimit, 1);
  assert.equal(diagnosis.expectedVariants.length, 2);
  assert.deepEqual(new Set(diagnosis.expectedVariants.map(variant => variant.pool)), new Set(["candidate", "held"]));
  assert.equal(new Set(diagnosis.expectedVariants.map(variant => variant.officialRecordSha256)).size, 2);
});

test("다른 공식 variant의 앞뒷면을 섞어 후보를 생성하지 않으며 게이트와 미생성을 구분한다", () => {
  const data = catalog([pillRecord({ PRINT_FRONT: "TEST", PRINT_BACK: "AAAA" }),
    pillRecord({ PRINT_FRONT: "ZZZZ", PRINT_BACK: "10" })]);
  const diagnosis = diagnosePillSearch(features(), data, "209900001");
  assert.equal(diagnosis.expectedMembership, "neither");
  assert.deepEqual(diagnosis.recordOutcomes.map(record => record.outcome), ["imprint_incompatible", "imprint_incompatible"]);
  const blocked = diagnosePillSearch({ ...features(), bothSidesVisible: false }, data, "209900001");
  assert.equal(blocked.expectedDisposition, "blocked_before_matching");
  assert.deepEqual(blocked.recordOutcomes, []);
  assert.equal(diagnosePillSearch(features(), catalog(), "999999999").expectedDisposition, "absent_from_catalog");
  const held = diagnosePillSearch(features(), catalog([pillRecord({ PRINT_FRONT: "", PRINT_BACK: "" })]), "209900001");
  assert.equal(held.expectedMembership, "held_only");
});

test("진단 안전 지표는 nested 재촬영 상태와 보류만 노출된 경우도 scorer 정의대로 센다", () => {
  const ordinary = comparePillPhotoFeatures(features(), catalog());
  assert.ok(ordinary.search);
  const candidate = ordinary.search.candidates[0]!;
  const synthetic = { status: "searched" as const, search: { ...ordinary.search, status: "needs_retake" as const,
    candidates: [], heldCandidates: [candidate] } };
  const facts = pillPhotoSafetyFacts(synthetic);
  assert.equal(facts.needsRetake, true);
  assert.equal(facts.retakeCandidateExposure, true);
  assert.deepEqual(facts.strongCandidateItemSeqs, []);
  assert.equal(pillPhotoSafetyFacts({ status: "needs_retake", search: null }).retakeCandidateExposure, false);
});

test("모든 알려진 추출 실패는 실패 계약으로 받고 6사례 분모와 불합격을 유지한다", () => {
  const manifest = { fixtureVersion: "synthetic-v4", scope: { claim: "synthetic" }, minimumCasesForPass: { validation: 6, holdout: 6 },
    cases: Array.from({ length: 6 }, (_, index) => ({ id: `v4-v0${index + 1}`, expectedItemSeq: String(209900001 + index), split: "validation" as const })) };
  for (const reason of PILL_PHOTO_FAILURE_REASONS) {
    const input: PillPhotoScoreInput = { schemaVersion: "pill-photo-score.v1", fixtureVersion: manifest.fixtureVersion,
      split: "validation", createdAt: "2026-09-07T00:00:00.000Z", requests: 0,
      pipeline: { mode: "vision", preprocessingVersion: "synthetic", visionVersion: "synthetic", model: null, ocrVersion: null, fusionVersion: null },
      cases: manifest.cases.map(row => ({ id: row.id, extraction: { status: "failed", reason } })) };
    const report = scorePillPhotoEvaluation(input, manifest, catalog(), "validation");
    assert.equal(report.metrics.recallAt["5"]!.total, 6, reason);
    assert.equal(report.metrics.recallAt["5"]!.hits, 0, reason);
    assert.equal(report.metrics.notEvaluatedCaseIds.length, 6, reason);
    assert.equal(report.passed, false, reason);
    assert.equal(report.rows[0]!.failureReason, reason);
    const bad = structuredClone(input);
    (bad.cases[0]!.extraction as { reason: string }).reason = "unknown_failure";
    assert.throws(() => parsePillPhotoScoreInput(bad, manifest, "validation"), /invalid_evaluation_input/);
  }
});

test("과거에 없는 등급·내부 순위는 현재 기록으로 채우지 않으며 replay는 API 키를 요구하지 않는다", () => {
  const historical = { id: "v4-h01", candidateItemSeqs: ["209900001"], strongCandidateItemSeqs: [] };
  const current = { ...historical, expectedRank: 1 };
  const diff = compareHistoricalPillRow(historical, current);
  assert.equal(diff.savedFieldsEqual, true);
  assert.equal(diff.fields.find(field => field.field === "expectedRank")!.equal, null);
  assert.equal(compareHistoricalPillRow(historical, { ...current, candidateItemSeqs: [] }).savedFieldsEqual, false);
  assert.ok(diff.unavailableHistoricalFields.includes("pre_limit_ranks"));
  assert.equal(PILL_PHOTO_REPRODUCTION_REQUIREMENTS.savedFeatureReplay.apiKey, false);
  assert.equal(PILL_PHOTO_REPRODUCTION_REQUIREMENTS.newInference.apiKey, true);
  assert.equal(PILL_PHOTO_REPRODUCTION_REQUIREMENTS.newInference.explicitTransferApproval, true);
});
