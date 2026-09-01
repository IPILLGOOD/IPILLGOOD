import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PILL_PHOTO_EXPECTED_REJECTIONS } from "../test-support/pill-photo-review.ts";
import { loadFrozenPillPhotoFixture } from "../test-support/pill-photo-fixture.ts";
import {
  PILL_OBSERVATION_SCHEMA_VERSION,
  searchPillCandidates,
  type ObservedPillSide,
  type PillCatalog,
  type PillObservation,
  type PillSearchResult,
} from "../src/pill-identification.ts";
import { serializePillProfile } from "./profile-pill-catalog.ts";
import { runPillPhotoExperiment, type PillPhotoReport } from "./pill-photo.ts";

type RegressionValue = string | boolean | null | string[];
interface RegressionRowLike {
  id: string;
  comparison: null | {
    status: string;
    reason: string;
    search: null | {
      status: string;
      reason: string;
      candidates: Array<{ itemSeq: string }>;
      heldCandidates: Array<{ itemSeq: string }>;
    };
  };
  evaluation: { outcome: string; expectedGateObserved: boolean | null };
}

export interface PillRegressionSnapshot {
  comparisonStatus: string | null;
  comparisonReason: string | null;
  searchStatus: string | null;
  searchReason: string | null;
  candidateItemSeqs: string[];
  heldCandidateItemSeqs: string[];
  evaluationOutcome: string;
  expectedGateObserved: boolean | null;
}

export interface PillRegressionDiff {
  id: string;
  changes: Array<{ field: keyof PillRegressionSnapshot; previous: RegressionValue; current: RegressionValue }>;
}

export interface PillRegressionGate {
  id: string;
  passed: boolean;
  expected: unknown;
  observed: unknown;
}

const snapshotFields: Array<keyof PillRegressionSnapshot> = [
  "comparisonStatus", "comparisonReason", "searchStatus", "searchReason",
  "candidateItemSeqs", "heldCandidateItemSeqs", "evaluationOutcome", "expectedGateObserved",
];

export function snapshotPillRegressionRow(row: RegressionRowLike): PillRegressionSnapshot {
  return {
    comparisonStatus: row.comparison?.status ?? null,
    comparisonReason: row.comparison?.reason ?? null,
    searchStatus: row.comparison?.search?.status ?? null,
    searchReason: row.comparison?.search?.reason ?? null,
    candidateItemSeqs: row.comparison?.search?.candidates.map((candidate) => candidate.itemSeq) ?? [],
    heldCandidateItemSeqs: row.comparison?.search?.heldCandidates.map((candidate) => candidate.itemSeq) ?? [],
    evaluationOutcome: row.evaluation.outcome,
    expectedGateObserved: row.evaluation.expectedGateObserved,
  };
}

export function diffPillRegressionRows(previousRows: RegressionRowLike[], currentRows: RegressionRowLike[]): PillRegressionDiff[] {
  const currentById = new Map(currentRows.map((row) => [row.id, row]));
  if (previousRows.length !== currentRows.length || currentById.size !== currentRows.length
    || new Set(previousRows.map((row) => row.id)).size !== previousRows.length) throw new Error("regression_case_mismatch");
  return previousRows.map((previousRow) => {
    const currentRow = currentById.get(previousRow.id);
    if (!currentRow) throw new Error("regression_case_mismatch");
    const previous = snapshotPillRegressionRow(previousRow);
    const current = snapshotPillRegressionRow(currentRow);
    const changes = snapshotFields.flatMap((field) => JSON.stringify(previous[field]) === JSON.stringify(current[field])
      ? []
      : [{ field, previous: previous[field], current: current[field] }]);
    return { id: previousRow.id, changes };
  }).filter((entry) => entry.changes.length > 0);
}

function observedSide(imprintCandidates: string[], imprintVisibility: ObservedPillSide["imprintVisibility"] = "clear"): ObservedPillSide {
  return { imprintCandidates, noImprintObserved: false, imprintVisibility, scoreLine: "unknown" };
}

function ovalTabletObservation(front: ObservedPillSide, back: ObservedPillSide, colors = ["노랑"]): PillObservation {
  return {
    schemaVersion: PILL_OBSERVATION_SCHEMA_VERSION,
    source: "image_features",
    form: "tablet",
    integrity: "intact",
    count: 1,
    overlapping: false,
    quality: "clear",
    shape: "타원형",
    colors,
    front,
    back,
  };
}

function itemEvidence(result: PillSearchResult, itemSeq: string, field: string) {
  return result.candidates.find((candidate) => candidate.itemSeq === itemSeq)?.variants[0]?.evidence
    .find((evidence) => evidence.field === field);
}

function searchGate(
  id: string,
  result: PillSearchResult,
  expectedItemSeq: string,
  predicate: () => boolean,
  expected: unknown,
  details: Record<string, unknown> = {},
): PillRegressionGate {
  const candidate = result.candidates.find((entry) => entry.itemSeq === expectedItemSeq);
  return {
    id,
    passed: Boolean(candidate) && predicate(),
    expected,
    observed: {
      status: result.status,
      candidateRetained: Boolean(candidate),
      candidateGrade: candidate?.grade ?? null,
      conflicts: candidate?.variants[0]?.conflicts.map((conflict) => conflict.field) ?? [],
      ...details,
    },
  };
}

export function evaluatePillRegressionGates(report: PillPhotoReport, catalog: PillCatalog): PillRegressionGate[] {
  const expectedItemSeq = "200801352";
  if (!catalog.items.some((item) => item.itemSeq === expectedItemSeq)) throw new Error("regression_reference_missing");

  const differentPills = report.rows.find((row) => row.id === "different-pills");
  const imageCutout = report.rows.find((row) => row.id === "image-cutout");
  if (!differentPills || !imageCutout) throw new Error("regression_case_mismatch");
  const differentSnapshot = snapshotPillRegressionRow(differentPills);
  const cutoutSnapshot = snapshotPillRegressionRow(imageCutout);

  const exactWithColorConflict = searchPillCandidates(ovalTabletObservation(observedSide(["HM"]), observedSide(["10"]), ["분홍"]), catalog);
  const multipleCandidates = searchPillCandidates(ovalTabletObservation(
    observedSide(["HN", "HM", "HIVI"], "partial"), observedSide(["10"]),
  ), catalog);
  const confusionExpansion = searchPillCandidates(ovalTabletObservation(observedSide(["HM"]), observedSide(["IO"], "partial")), catalog);
  const reversed = searchPillCandidates(ovalTabletObservation(observedSide(["HM"]), observedSide(["10"]), ["분홍"]), {
    ...catalog, items: [...catalog.items].reverse(),
  });

  const multipleFrontEvidence = itemEvidence(multipleCandidates, expectedItemSeq, "front.imprint");
  const confusionBackEvidence = itemEvidence(confusionExpansion, expectedItemSeq, "back.imprint");
  const exactCandidate = exactWithColorConflict.candidates.find((candidate) => candidate.itemSeq === expectedItemSeq);
  const exactConflicts = exactCandidate?.variants[0]?.conflicts.map((conflict) => conflict.field) ?? [];

  return [
    {
      id: "real-photo-different-pills-blocked",
      passed: differentSnapshot.comparisonStatus === "needs_retake"
        && differentSnapshot.comparisonReason === PILL_PHOTO_EXPECTED_REJECTIONS["different-pills"]
        && differentSnapshot.searchStatus === null
        && differentSnapshot.candidateItemSeqs.length === 0
        && differentSnapshot.heldCandidateItemSeqs.length === 0
        && differentSnapshot.evaluationOutcome === "rejected"
        && differentSnapshot.expectedGateObserved === true,
      expected: { reason: "unverified_photo_pair", noCandidates: true, outcome: "rejected", expectedGateObserved: true },
      observed: differentSnapshot,
    },
    {
      id: "real-photo-cutout-quality-gate",
      passed: cutoutSnapshot.comparisonStatus === "needs_retake"
        && cutoutSnapshot.comparisonReason === PILL_PHOTO_EXPECTED_REJECTIONS["image-cutout"]
        && cutoutSnapshot.searchStatus === null
        && cutoutSnapshot.candidateItemSeqs.length === 0
        && cutoutSnapshot.heldCandidateItemSeqs.length === 0
        && cutoutSnapshot.evaluationOutcome === "rejected"
        && cutoutSnapshot.expectedGateObserved === true,
      expected: { reason: "image_artifact_or_uncertainty", noCandidates: true, outcome: "rejected", expectedGateObserved: true },
      observed: cutoutSnapshot,
    },
    searchGate(
      "exact-imprint-survives-color-conflict",
      exactWithColorConflict,
      expectedItemSeq,
      () => exactConflicts.includes("colors"),
      { candidateRetained: true, conflictsInclude: "colors" },
      { expectedItemSeq },
    ),
    searchGate(
      "multiple-imprint-candidate-retained",
      multipleCandidates,
      expectedItemSeq,
      () => multipleFrontEvidence?.imprintReading?.origin === "observed_candidate"
        && multipleFrontEvidence.imprintReading.observedCandidate === "HM"
        && multipleFrontEvidence.imprintReading.observedCandidateIndex === 1,
      { candidateRetained: true, selectedOrigin: "observed_candidate", selectedCandidate: "HM", selectedIndex: 1 },
      { selectedImprintReading: multipleFrontEvidence?.imprintReading ?? null },
    ),
    searchGate(
      "confusion-expansion-candidate-retained",
      confusionExpansion,
      expectedItemSeq,
      () => confusionBackEvidence?.imprintReading?.origin === "server_confusion_expansion"
        && confusionBackEvidence.imprintReading.observedCandidate === "IO"
        && confusionBackEvidence.imprintReading.normalized === "10",
      { candidateRetained: true, selectedOrigin: "server_confusion_expansion", observedCandidate: "IO", normalized: "10" },
      { selectedImprintReading: confusionBackEvidence?.imprintReading ?? null },
    ),
    {
      id: "candidate-order-is-deterministic",
      passed: JSON.stringify(exactWithColorConflict.candidates.map((candidate) => candidate.itemSeq))
        === JSON.stringify(reversed.candidates.map((candidate) => candidate.itemSeq))
        && JSON.stringify(exactWithColorConflict.heldCandidates.map((candidate) => candidate.itemSeq))
          === JSON.stringify(reversed.heldCandidates.map((candidate) => candidate.itemSeq)),
      expected: { sameCandidatesAndHeldOrderAfterCatalogReverse: true },
      observed: {
        forwardCandidates: exactWithColorConflict.candidates.map((candidate) => candidate.itemSeq),
        reversedCandidates: reversed.candidates.map((candidate) => candidate.itemSeq),
        forwardHeld: exactWithColorConflict.heldCandidates.map((candidate) => candidate.itemSeq),
        reversedHeld: reversed.heldCandidates.map((candidate) => candidate.itemSeq),
      },
    },
  ];
}

export async function runPillPhotoRegression() {
  const replay = await runPillPhotoExperiment(["replay"]);
  const fixture = await loadFrozenPillPhotoFixture();
  const gates = evaluatePillRegressionGates(replay.report, fixture.catalog);
  const baselineDiff = {
    casesCompared: fixture.baseline.rows.length,
    diffs: diffPillRegressionRows(fixture.baseline.rows, replay.report.rows),
  };
  const positiveRows = replay.report.rows.filter((row) => row.expectedItemSeq !== null);
  const result = {
    passed: gates.every((gate) => gate.passed),
    replayDirectory: replay.directory,
    requests: replay.report.requests,
    positiveRealPhotoPolicy: "diagnostic_only_until_an_independent_acceptance_baseline_exists",
    positiveRealPhotoOutcomes: positiveRows.map((row) => ({ id: row.id, outcome: row.evaluation.outcome })),
    gates,
    baselineDiff,
  };
  await writeFile(join(replay.directory, "regression.json"), serializePillProfile(result), { flag: "wx", mode: 0o600 });
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runPillPhotoRegression().then((result) => {
    console.log(serializePillProfile(result));
    if (!result.passed) process.exitCode = 1;
  }).catch((error: unknown) => {
    const safe = new Set(["regression_case_mismatch", "regression_reference_missing", "fixture_catalog_hash_mismatch", "fixture_baseline_hash_mismatch", "fixture_baseline_mismatch", "fixture_image_manifest_mismatch", "fixture_catalog_invalid", "fixture_catalog_decode_failed", "fixture_size_exceeded"]);
    console.error(JSON.stringify({ status: "unavailable", reason: error instanceof Error && safe.has(error.message) ? error.message : "local_operation_failed" }));
    process.exitCode = 1;
  });
}
