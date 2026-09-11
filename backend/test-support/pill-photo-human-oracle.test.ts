import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { parseOfficialPillPage } from "../src/official-pill-catalog.ts";
import { pillPhotoFeaturesSchema, comparePillPhotoFeatures } from "../src/pill-photo-features.ts";
import { PILL_PHOTO_FAILURE_REASONS } from "../src/pill-photo-failures.ts";
import { pillEnvelope, pillObservation, pillRecord } from "./pill-fixtures.ts";
import { officialPillRecordDigest } from "./pill-photo-label-audit.ts";
import { compareHumanOracleRuns, humanOracleReadings, parseHumanPhotoReadings, type HumanPhotoReadings } from "./pill-photo-human-oracle.ts";
import type { PillPhotoPhoneValidationManifest } from "./pill-photo-phone-validation.ts";
import { PILL_PHOTO_SCORE_SCHEMA_VERSION, type PillPhotoScoreInput } from "./pill-photo-score.ts";

// Completely synthetic loader-validated views: no private labels, photographs, model calls or filesystem fixtures.
function fixture() {
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  const ids = Array.from({ length: 6 }, (_, index) => `v4-v0${index + 1}`);
  const raw = ids.map((id, index) => pillRecord({ ITEM_SEQ: String(209900001 + index),
    ITEM_NAME: `가상 테스트 품목 ${id}`, PRINT_FRONT: `FRONT${String.fromCharCode(65 + index)}`,
    PRINT_BACK: `BACK${String.fromCharCode(65 + index)}` }));
  const catalog = { ...parseOfficialPillPage(pillEnvelope(raw), "json", "2026-01-01T00:00:00.000Z"),
    completeness: "complete" as const, version: "synthetic-human-oracle-v1" };
  const cases = ids.map((id, index) => ({ id, split: "validation" as const,
    expectedItemSeq: catalog.items[index]!.itemSeq, photos: [`${id}-side-a.jpg`, `${id}-side-b.jpg`] }));
  const images = cases.flatMap(row => row.photos.map((path, index) => ({ path, sha256: hash(path),
    officialSide: index === 0 ? "front" as const : "back" as const })));
  const manifest = { fixtureVersion: "synthetic-human-oracle-v1", scope: { split: "validation", claim: "synthetic_test_only" },
    products: cases.map((row, index) => ({ id: row.id, expectedItemSeq: row.expectedItemSeq,
      expectedOfficialRecordSha256: officialPillRecordDigest(catalog.items[index]!) })),
    cases, images,
  } as unknown as PillPhotoPhoneValidationManifest;
  const evidence: HumanPhotoReadings = { schemaVersion: "pill-human-photo-readings.v2", fixtureVersion: manifest.fixtureVersion,
    source: { kind: "user_photo_only_review", photoOnlyConfirmed: true, reviewer: "합성 검수자",
      reviewedOn: "2026-01-01", reviewedTime: null, reviewFileSha256: hash("synthetic review"), transcriptionNotes: "합성 테스트" },
    cases: cases.map((row, index) => ({ caseId: row.id, sides: row.photos.map((path, sideIndex) => ({
      inputSide: sideIndex === 0 ? "front" : "back", photoPath: path, photoSha256: hash(path),
      reviewState: "reviewed_readable", imprintCandidates: [String(raw[index]![sideIndex === 0 ? "PRINT_FRONT" : "PRINT_BACK"])],
      nonTextMark: "absent", recordedStatus: "판독 가능", recordedText: "synthetic text", notes: "",
    })) })) };
  const input: PillPhotoScoreInput = { schemaVersion: PILL_PHOTO_SCORE_SCHEMA_VERSION,
    fixtureVersion: manifest.fixtureVersion, split: "validation", createdAt: "2026-01-01T00:00:00.000Z", requests: 0,
    pipeline: { mode: "vision_ocr", preprocessingVersion: "synthetic-preprocessing", visionVersion: "synthetic-vision",
      model: null, ocrModel: null, ocrVersion: "synthetic-ocr", fusionVersion: "synthetic-fusion" },
    cases: cases.map(row => {
      const { source, ...observation } = pillObservation();
      assert.equal(source, "manual");
      return { id: row.id, extraction: { status: "ok", usage: null,
        features: pillPhotoFeaturesSchema.parse({ observation, pairConsistency: "consistent", bothSidesVisible: true, imageArtifact: "none" }) } };
    }),
  };
  const runs = [1, 2, 3].map(repetition => ({ id: `synthetic-run/repeat-${repetition}`, value: structuredClone(input) }));
  return { catalog, manifest, evidence, runs };
}

test("사람 판독 6사례·12면은 원본 identity와 출처·날짜를 확인하며 홀드아웃·누락·중복을 거절한다", () => {
  const { manifest, evidence } = fixture();
  const before = structuredClone(evidence);
  assert.deepEqual(parseHumanPhotoReadings(evidence, manifest), evidence);
  const invalid: ((copy: HumanPhotoReadings) => void)[] = [
    copy => { copy.fixtureVersion = "foreign-fixture"; },
    copy => { copy.cases.pop(); },
    copy => { copy.cases[1]!.caseId = copy.cases[0]!.caseId; },
    copy => { copy.cases[0]!.sides.pop(); },
    copy => { copy.cases[0]!.sides[1]!.inputSide = "front"; },
    copy => { copy.cases[0]!.sides[0]!.photoPath = "v4-v02-side-a.jpg"; },
    copy => { copy.cases[0]!.sides[0]!.photoSha256 = "f".repeat(64); },
    copy => { copy.source.reviewedOn = "2026-02-31"; },
    copy => { copy.source.reviewer = " "; },
  ];
  for (const change of invalid) {
    const copy = structuredClone(evidence); change(copy);
    assert.throws(() => parseHumanPhotoReadings(copy, manifest), /human_oracle_/);
  }
  assert.throws(() => parseHumanPhotoReadings({ ...evidence, source: { ...evidence.source, photoOnlyConfirmed: false } }, manifest), /invalid_evidence/);
  assert.throws(() => parseHumanPhotoReadings({ ...evidence, source: { ...evidence.source, reviewedTime: "10:00" } }, manifest), /invalid_evidence/);
  const holdout = structuredClone(manifest); holdout.scope.split = "holdout";
  assert.throws(() => parseHumanPhotoReadings(evidence, holdout), /validation_only/);
  const fewerImages = structuredClone(manifest); fewerImages.images.pop();
  assert.throws(() => parseHumanPhotoReadings(evidence, fewerImages), /fixture_mismatch/);
  const repeatedHash = structuredClone(manifest), repeatedEvidence = structuredClone(evidence);
  repeatedHash.images[1]!.sha256 = repeatedHash.images[0]!.sha256;
  repeatedEvidence.cases[0]!.sides[1]!.photoSha256 = repeatedHash.images[0]!.sha256;
  assert.throws(() => parseHumanPhotoReadings(repeatedEvidence, repeatedHash), /photo_identity_mismatch/);
  assert.deepEqual(evidence, before);
});

test("사람 판독 원문과 모호성 비고를 보존하고 비고로 대안 각인을 만들지 않는다", () => {
  const { manifest, evidence } = fixture();
  const side = evidence.cases[0]!.sides[0]!;
  side.imprintCandidates = [" G1 "];
  side.notes = "두 번째 문자가 영어처럼 보일 수도 있음";
  const parsed = parseHumanPhotoReadings(evidence, manifest);
  const result = humanOracleReadings(parsed, "v4-v01");
  assert.deepEqual(result.readings.front, [" G1 "]);
  assert.equal(result.sides[0]!.notes, side.notes);
  result.readings.front!.push("different"); result.sides[0]!.notes = "changed";
  assert.deepEqual(parsed.cases[0]!.sides[0]!.imprintCandidates, [" G1 "]);
  assert.equal(parsed.cases[0]!.sides[0]!.notes, side.notes);
  const spaces = structuredClone(evidence); spaces.cases[0]!.sides[0]!.imprintCandidates = [" "];
  assert.throws(() => parseHumanPhotoReadings(spaces, manifest), /invalid_evidence/);
});

test("문자 없음·판독 불가·미검수는 다른 증거 상태이고 문자열 주입은 모두 하지 않는다", () => {
  const { manifest, evidence } = fixture();
  const states = ["reviewed_no_text", "reviewed_unreadable", "not_reviewed"] as const;
  states.forEach((state, index) => {
    const side = evidence.cases[index]!.sides[0]!;
    side.reviewState = state; side.imprintCandidates = [];
    side.recordedText = state === "reviewed_no_text" ? "비어 있음" : "";
    side.nonTextMark = state === "reviewed_no_text" ? "present" : "uncertain";
  });
  const parsed = parseHumanPhotoReadings(evidence, manifest);
  states.forEach((state, index) => {
    const result = humanOracleReadings(parsed, `v4-v0${index + 1}`);
    assert.equal(result.readings.front, null);
    assert.equal(result.sides[0]!.reviewState, state);
  });
  assert.equal(humanOracleReadings(parsed, "v4-v01").sides[0]!.nonTextMark, "present");
  const literal = structuredClone(evidence); literal.cases[3]!.sides[0]!.imprintCandidates = ["비어 있음"];
  assert.throws(() => parseHumanPhotoReadings(literal, manifest), /invalid_evidence/);
  const invented = structuredClone(evidence); invented.cases[0]!.sides[0]!.imprintCandidates = ["X"];
  assert.throws(() => parseHumanPhotoReadings(invented, manifest), /invalid_evidence/);
  assert.throws(() => humanOracleReadings(parsed, "v4-v99"), /case_missing/);
});

test("최종 결합 후 문자열만 변경하고 partial·무각인·품질·쌍 상태·분할선과 원본은 보존한다", () => {
  const { manifest, evidence, runs, catalog } = fixture();
  const humanBlank = evidence.cases[4]!.sides[1]!;
  humanBlank.reviewState = "reviewed_no_text"; humanBlank.imprintCandidates = []; humanBlank.recordedText = "비어 있음";
  evidence.cases[0]!.sides[0]!.reviewState = "reviewed_partial";
  evidence.cases[0]!.sides[0]!.nonTextMark = "present";
  evidence.cases[0]!.sides[0]!.notes = "합성 기호 및 분할선 관찰";
  for (const run of runs) {
    const extraction = run.value.cases[0]!.extraction; assert.equal(extraction.status, "ok");
    if (extraction.status !== "ok") throw new Error("synthetic_setup");
    extraction.features.observation.front!.imprintVisibility = "partial";
    extraction.features.observation.quality = "dark";
    extraction.features.pairConsistency = "uncertain";
  }
  const before = structuredClone({ evidence, runs, catalog, manifest });
  const report = compareHumanOracleRuns(runs, evidence, manifest, catalog);
  const humanRows = report.rows.filter(row => row.condition === "human_strings_only");
  assert.equal(humanRows.length, 18);
  for (const row of humanRows) {
    assert.equal(row.injectionPoint, "after_fusion_final_features");
    assert.equal(row.executed, true);
    assert.deepEqual(row.stateChanges, []);
    assert.ok(row.changedFields.every(change => /^observation\.(front|back)\.imprintCandidates$/.test(change.path)));
    const reverted = structuredClone(row.observation!);
    for (const side of ["front", "back"] as const) if (reverted.observation[side]) {
      reverted.observation[side]!.imprintCandidates = structuredClone(row.originalObservation!.observation[side]!.imprintCandidates);
    }
    assert.deepEqual(reverted, row.originalObservation);
    if (row.caseId === "v4-v01") {
      assert.equal(row.observation!.observation.front!.imprintVisibility, "partial");
      assert.equal(row.diagnosis!.comparisonStatus, "needs_retake");
      assert.deepEqual(row.diagnosis!.candidateItemSeqs, []);
    }
    if (row.caseId === "v4-v05") {
      assert.deepEqual(row.observation!.observation.back, row.originalObservation!.observation.back);
      assert.deepEqual(row.unavailableStringSides, ["back"]);
    }
  }
  assert.equal(report.humanCoverage.reviewedSides, 12);
  assert.equal(report.humanCoverage.textBearingSides, 11);
  assert.equal(report.humanCoverage.noTextSides, 1);
  assert.deepEqual({ evidence, runs, catalog, manifest }, before);
});

test("stored unreadable·무각인에 문자열 주입 충돌 시 조건 전체를 미실행하며 18 분모를 유지한다", () => {
  const { manifest, evidence, runs, catalog } = fixture();
  for (const run of runs) {
    for (const [index, blank] of [[0, false], [1, true]] as const) {
      const extraction = run.value.cases[index]!.extraction;
      if (extraction.status !== "ok") throw new Error("synthetic_setup");
      extraction.features.observation.front = { imprintCandidates: [], noImprintObserved: blank,
        imprintVisibility: blank ? "clear" : "unreadable", scoreLine: "unknown" };
    }
  }
  const report = compareHumanOracleRuns(runs, evidence, manifest, catalog);
  const human = report.rows.filter(row => row.condition === "human_strings_only");
  const blocked = human.filter(row => row.caseId === "v4-v01" || row.caseId === "v4-v02");
  assert.equal(blocked.length, 6);
  assert.ok(blocked.every(row => !row.executed && row.reason === "not_executed_contract_conflict"
    && row.observation === null && row.diagnosis === null && row.changedFields.length === 0 && row.contractConflicts.length > 0));
  const group = report.groups.find(row => row.condition === "human_strings_only")!;
  assert.equal(group.groups[0]!.repeatedObservations, 18);
  assert.equal(group.groups[0]!.executedObservations, 12);
  assert.ok(group.groups[0]!.recall.every(metric => metric.rate === null && metric.plannedDenominator === 18));
  assert.equal(group.safety.completeCoverage, false);
  assert.equal(group.safety.officialPassDecision, false);
});

test("모든 면 미검수는 0회 실행으로 명시하며 0% 성공률이나 합격으로 만들지 않는다", () => {
  const { manifest, evidence, runs, catalog } = fixture();
  evidence.cases.forEach(row => row.sides.forEach(side => {
    side.reviewState = "not_reviewed"; side.imprintCandidates = []; side.nonTextMark = "not_reviewed";
  }));
  const report = compareHumanOracleRuns(runs, evidence, manifest, catalog);
  assert.equal(report.humanCoverage.reviewedSides, 0);
  assert.equal(report.humanCoverage.executedRepeatedObservations, 0);
  const human = report.groups.find(row => row.condition === "human_strings_only")!;
  assert.equal(human.groups[0]!.unexecutedObservations, 18);
  assert.ok(human.groups.every(group => group.recall.every(metric => metric.rate === null)));
  assert.ok(report.rows.filter(row => row.condition === "human_strings_only").every(row => row.reason === "not_executed_no_reading"));
});

test("추출 실패의 공통 사유를 보존하고 실패를 비교 분모에서 제외하지 않는다", () => {
  const { manifest, evidence, runs, catalog } = fixture();
  runs.forEach((run, repetition) => run.value.cases.forEach((row, index) => {
    row.extraction = { status: "failed", reason: PILL_PHOTO_FAILURE_REASONS[(repetition * 6 + index) % PILL_PHOTO_FAILURE_REASONS.length]! };
  }));
  const report = compareHumanOracleRuns(runs, evidence, manifest, catalog);
  assert.equal(report.rows.length, 54);
  for (const row of report.rows) {
    assert.equal(row.executed, false);
    assert.equal(row.reason, PILL_PHOTO_FAILURE_REASONS[((row.repetition - 1) * 6 + Number(row.caseId.slice(-1)) - 1) % PILL_PHOTO_FAILURE_REASONS.length]);
    assert.equal(row.observation, null); assert.equal(row.diagnosis, null);
  }
  assert.ok(report.rows.some(row => row.reason === "invalid_request"));
  assert.ok(report.groups.every(condition => condition.groups[0]!.unexecutedObservations === 18
    && condition.groups[0]!.recall.every(metric => metric.plannedDenominator === 18 && metric.rate === null)));
  const invalidRuns = runs.map(run => ({ ...run, value: { ...run.value, cases: run.value.cases.map(row => ({ ...row,
    extraction: { status: "failed", reason: "invented_failure" } })) } }));
  assert.throws(() => compareHumanOracleRuns(invalidRuns, evidence, manifest, catalog), /invalid_evaluation_input/);
});

test("동일 3회 기준 실행과 6·5·1 집계를 유지하며 축소·중복·다른 split 입력을 거절한다", () => {
  const { manifest, evidence, runs, catalog } = fixture();
  const report = compareHumanOracleRuns(runs, evidence, manifest, catalog);
  assert.equal(report.rows.length, 54);
  for (const condition of report.groups) {
    assert.deepEqual(condition.groups.map(group => group.independentProducts), [6, 5, 1]);
    assert.deepEqual(condition.groups.map(group => group.repeatedObservations), [18, 15, 3]);
    assert.ok(condition.groups.every(group => !group.officialScoreOrGate && !("passed" in group)));
  }
  assert.ok(report.rows.every(row => row.sourceRun === `synthetic-run/repeat-${row.repetition}`
    && row.pairedBaselineId === `${row.repetition}/original/${row.caseId}`));
  assert.throws(() => compareHumanOracleRuns(runs.slice(0, 1), evidence, manifest, catalog), /three_paired_runs_required/);
  assert.throws(() => compareHumanOracleRuns([runs[0]!, runs[0]!, runs[2]!], evidence, manifest, catalog), /three_paired_runs_required/);
  const shortened = structuredClone(runs); shortened[0]!.value.cases.pop();
  assert.throws(() => compareHumanOracleRuns(shortened, evidence, manifest, catalog), /invalid_evaluation_input/);
  const reordered = structuredClone(runs); reordered[0]!.value.cases.reverse();
  assert.throws(() => compareHumanOracleRuns(reordered, evidence, manifest, catalog), /case_mismatch/);
  const holdout = structuredClone(runs); holdout[0]!.value.split = "holdout";
  assert.throws(() => compareHumanOracleRuns(holdout, evidence, manifest, catalog), /invalid_evaluation_input/);
});

test("정답 품목 변경은 원본·사람 조건의 후보 생성과 순서·등급에 영향을 주지 않는다", () => {
  const { manifest, evidence, runs, catalog } = fixture();
  const original = compareHumanOracleRuns(runs, evidence, manifest, catalog);
  const relabeled = structuredClone(manifest);
  relabeled.cases.forEach((row, index) => { row.expectedItemSeq = manifest.cases[(index + 1) % 6]!.expectedItemSeq; });
  const changedLabels = compareHumanOracleRuns(runs, evidence, relabeled, catalog);
  const searchOnly = (rows: typeof original.rows) => rows.filter(row => row.condition !== "official_strings_only").map(row => ({
    id: `${row.repetition}/${row.condition}/${row.caseId}`, observation: row.observation,
    // Full existing public comparison includes order, variants, grades, held output and safety statuses but not expected labels.
    comparison: comparePillPhotoFeatures(row.observation, catalog),
  }));
  assert.deepEqual(searchOnly(original.rows), searchOnly(changedLabels.rows));
  assert.ok(original.rows.some((row, index) => row.condition === "human_strings_only"
    && row.diagnosis!.expectedRank !== changedLabels.rows[index]!.diagnosis!.expectedRank));
});
