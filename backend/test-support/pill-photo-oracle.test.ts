import assert from "node:assert/strict";
import test from "node:test";
import { createHumanReadingTemplate, injectOracleImprintStrings, officialOracleReadings, summarizeOracleGroups } from "./pill-photo-oracle.ts";
import { observedSide, pillObservation } from "./pill-fixtures.ts";
import { pillPhotoFeaturesSchema } from "../src/pill-photo-features.ts";
import { parseOfficialPillPage } from "../src/official-pill-catalog.ts";
import { pillRecord, pillEnvelope } from "./pill-fixtures.ts";
import { officialPillRecordDigest } from "./pill-photo-label-audit.ts";
import type { PillPhotoPhoneValidationManifest } from "./pill-photo-phone-validation.ts";

function features() {
  const { source, ...observation } = pillObservation();
  assert.equal(source, "manual");
  return pillPhotoFeaturesSchema.parse({ observation, pairConsistency: "consistent", bothSidesVisible: true, imageArtifact: "none" });
}
test("각인 문자열만 결합 후 주입하고 partial·품질·안전 상태는 올리지 않는다", () => {
  const original = features();
  original.observation.front!.imprintVisibility = "partial";
  original.observation.quality = "dark";
  original.pairConsistency = "uncertain";
  const before = structuredClone(original);
  const injected = injectOracleImprintStrings(original, { front: ["CORRECT"], back: null }, "official_catalog");
  assert.equal(injected.status, "executed");
  assert.equal(injected.features!.observation.front!.imprintVisibility, "partial");
  assert.equal(injected.features!.observation.quality, "dark");
  assert.equal(injected.features!.pairConsistency, "uncertain");
  assert.deepEqual(injected.features!.observation.back, original.observation.back);
  assert.deepEqual(injected.changedFields.map(change => change.path), ["observation.front.imprintCandidates"]);
  assert.deepEqual(injected.stateChanges, []);
  assert.deepEqual(original, before);
});

test("공식 결측은 무각인이 아니며 unreadable·무각인 상태와 주입 충돌 시 조건 전체를 미실행한다", () => {
  assert.equal(injectOracleImprintStrings(features(), { front: null, back: null }, "official_catalog").status, "not_executed_no_reading");
  for (const unreadable of [null, ""] as const) {
    const original = features(); original.observation.front = observedSide(unreadable, "none");
    const result = injectOracleImprintStrings(original, { front: ["TEST"], back: ["CODE"] }, "official_catalog");
    assert.equal(result.status, "not_executed_contract_conflict");
    assert.equal(result.features, null);
    assert.equal(result.changedFields.length, 0);
    assert.equal(result.stateChanges.length, 0);
    assert.ok(result.contractConflicts.length);
  }
});

test("6/5/1 분리 집계는 반복수·독립 품목을 구별하고 공식 pass를 만들지 않는다", () => {
  const rows = [1, 2, 3].flatMap(repetition => Array.from({ length: 6 }, (_, index) => ({
    caseId: `v4-v0${index + 1}`, repetition, condition: "baseline", executed: true, rank: index + 1,
  })));
  const groups = summarizeOracleGroups(rows, 3);
  assert.deepEqual(groups.map(group => group.independentProducts), [6, 5, 1]);
  assert.deepEqual(groups.map(group => group.repeatedObservations), [18, 15, 3]);
  assert.deepEqual(groups.map(group => group.recall[1]!.hitsAmongExecuted), [15, 12, 3]);
  assert.ok(groups.every(group => group.officialScoreOrGate === false && !("passed" in group)));
  const absent = rows.map(row => ({ ...row, condition: "human", executed: false, rank: null }));
  assert.equal(summarizeOracleGroups(absent, 3)[0]!.recall[1]!.rate, null);
  assert.equal(summarizeOracleGroups(absent, 3)[0]!.unexecutedObservations, 18);
  assert.throws(() => summarizeOracleGroups(rows.slice(1), 3), /incomplete_or_duplicate/);
  assert.throws(() => summarizeOracleGroups([rows[0]!, ...rows.slice(0, -1)], 3), /incomplete_or_duplicate/);
  assert.throws(() => summarizeOracleGroups(rows.map(row => ({ ...row, caseId: "v4-h01" })), 3), /invalid_group/);
});

test("공식 오라클은 고정 variant 한 개의 양면을 함께 매핑하고 holdout에서는 거절한다", () => {
  const data = { ...parseOfficialPillPage(pillEnvelope([pillRecord(), pillRecord({ PRINT_FRONT: "OTHER", PRINT_BACK: "VARIANT" })]),
    "json", "2026-09-01T00:00:00.000Z"), completeness: "complete" as const, version: "synthetic" };
  // Minimal synthetic view of a loader-validated manifest, never private photos or a real scoring set.
  const manifest = { fixtureVersion: "synthetic", scope: { split: "validation" },
    products: [{ id: "v4-v01", expectedItemSeq: "209900001", expectedOfficialRecordSha256: officialPillRecordDigest(data.items[0]!) }],
    cases: [{ id: "v4-v01", photos: ["a.jpg", "b.jpg"] }],
    images: [{ path: "a.jpg", officialSide: "back", sha256: "a".repeat(64) }, { path: "b.jpg", officialSide: "front", sha256: "b".repeat(64) }],
  } as unknown as PillPhotoPhoneValidationManifest;
  assert.deepEqual(officialOracleReadings(manifest, "v4-v01", data).readings, { front: ["10"], back: ["TEST"] });
  const missing = structuredClone(manifest); missing.products[0]!.expectedOfficialRecordSha256 = "f".repeat(64);
  assert.throws(() => officialOracleReadings(missing, "v4-v01", data), /pinned_variant/);
  const holdout = structuredClone(manifest); holdout.scope.split = "holdout";
  assert.throws(() => officialOracleReadings(holdout, "v4-v01", data), /validation_only/);
  assert.throws(() => createHumanReadingTemplate(holdout), /validation_only/);
  const template = createHumanReadingTemplate(manifest);
  assert.ok(template.cases[0]!.sides.every(side => side.status === "not_reviewed" && side.imprintCandidates.length === 0 && side.reviewer === null));
  assert.deepEqual(template.cases[0]!.sides.map(side => side.photoSha256), ["a".repeat(64), "b".repeat(64)]);
});
