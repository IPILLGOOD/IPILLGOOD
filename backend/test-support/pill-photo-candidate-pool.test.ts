import assert from "node:assert/strict";
import test from "node:test";
import { parseOfficialPillPage } from "../src/official-pill-catalog.ts";
import { comparePillPhotoFeatures, pillPhotoFeaturesSchema } from "../src/pill-photo-features.ts";
import type { PillCatalog } from "../src/pill-identification.ts";
import { officialPillRecordDigest } from "./pill-photo-label-audit.ts";
import { buildCandidateReviewPool, MAX_CANDIDATE_REVIEW_CARDS, MAX_CANDIDATE_REVIEW_PRODUCTS } from "./pill-photo-candidate-pool.ts";
import { observedSide, pillEnvelope, pillObservation, pillRecord } from "./pill-fixtures.ts";

function catalog(records = [pillRecord()]): PillCatalog {
  // Build multiple valid API pages rather than an invalid >100-row synthetic response.
  return { items: records.flatMap(record => parseOfficialPillPage(pillEnvelope([record]), "json", "2026-08-31T00:00:00.000Z").items),
    totalCount: records.length, completeness: "complete", version: "synthetic-candidate-review-v1" };
}
function features() {
  const { source, ...observation } = pillObservation();
  assert.equal(source, "manual");
  return pillPhotoFeaturesSchema.parse({ observation, pairConsistency: "consistent", bothSidesVisible: true, imageArtifact: "none" });
}

test("review pool uses the actual pre-limit first 50 products, including rank 45, without a target input", () => {
  const data = catalog(Array.from({ length: 60 }, (_, i) => pillRecord({ ITEM_SEQ: String(209900001 + i) })));
  const pool = buildCandidateReviewPool(features(), data);
  assert.equal(buildCandidateReviewPool.length, 2);
  assert.equal(pool.status, "ready");
  assert.equal(pool.comparison.search!.candidates.length, 20);
  assert.equal(pool.cards.length, MAX_CANDIDATE_REVIEW_PRODUCTS);
  assert.equal(pool.eligibleProductCount, 60);
  assert.equal(pool.truncated, true);
  assert.equal(pool.bindings.find(row => row.itemSeq === "209900045")!.originalProductRank, 45);
  assert.equal(pool.bindings.some(row => row.itemSeq === "209900051"), false);
  assert.deepEqual(pool.comparison, comparePillPhotoFeatures(features(), data));
});

test("cards and private references are deterministic across catalog order and omit rank from presentation", () => {
  const records = Array.from({ length: 60 }, (_, i) => pillRecord({ ITEM_SEQ: String(209900001 + i) }));
  const pool = buildCandidateReviewPool(features(), catalog(records));
  const reversed = buildCandidateReviewPool(features(), catalog([...records].reverse()));
  assert.deepEqual(pool, reversed);
  assert.deepEqual(pool.bindings.map(row => row.recordSha256), pool.bindings.map(row => row.recordSha256).sort());
  assert.notDeepEqual(pool.bindings.map(row => row.originalProductRank), Array.from({ length: 50 }, (_, i) => i + 1));
  assert.deepEqual(pool.cards.map(row => row.ref), Array.from({ length: 50 }, (_, i) => `c${String(i + 1).padStart(3, "0")}`));
});

test("all original photo and search refusal gates return zero review cards", () => {
  const ordinary = features();
  const observationOverrides = [
    { form: "powder" }, { form: "granule" }, { form: "liquid" }, { form: "other" }, { form: "unknown" },
    { integrity: "split" }, { integrity: "damaged" }, { integrity: "unknown" },
    { count: 0 }, { count: 2 }, { overlapping: true }, { front: null }, { back: null },
    { quality: "dark" }, { quality: "too_small" }, { quality: "unknown" },
    { front: observedSide(null, "unknown"), back: observedSide(null, "unknown") },
    { front: observedSide("", "none"), back: observedSide("", "none") },
  ];
  const inputs: unknown[] = [null, {}, { ...ordinary, unexpected: true },
    { ...ordinary, pairConsistency: "inconsistent" }, { ...ordinary, pairConsistency: "uncertain" },
    { ...ordinary, imageArtifact: "present" }, { ...ordinary, imageArtifact: "uncertain" },
    { ...ordinary, bothSidesVisible: false },
    ...observationOverrides.map(override => ({ ...ordinary, observation: { ...ordinary.observation, ...override } })),
  ];
  for (const input of inputs) {
    const pool = buildCandidateReviewPool(input, catalog());
    assert.equal(pool.status, "blocked", JSON.stringify(input));
    assert.deepEqual(pool.cards, []);
    assert.deepEqual(pool.bindings, []);
    assert.deepEqual(pool.comparison, comparePillPhotoFeatures(input, catalog()));
  }
  for (const badCatalog of [{ ...catalog(), completeness: "partial" as const }, { ...catalog(), totalCount: 2 }, { ...catalog(), version: "" }]) {
    const pool = buildCandidateReviewPool(ordinary, badCatalog);
    assert.equal(pool.status, "blocked");
    assert.equal(pool.reason, "incomplete_catalog");
    assert.deepEqual(pool.cards, []);
  }
  const unconfigured = buildCandidateReviewPool(ordinary, undefined as unknown as PillCatalog);
  assert.equal(unconfigured.status, "blocked");
  assert.equal(unconfigured.reason, "catalog_not_configured");
});

test("partial observations retain the original gate decision and never upgrade original grades", () => {
  const input = features();
  input.observation.front!.imprintVisibility = "partial";
  const pool = buildCandidateReviewPool(input, catalog());
  assert.equal(pool.status, "ready");
  assert.equal(pool.comparison.search!.status, "needs_review");
  assert.equal(pool.comparison.search!.candidates[0]!.grade, "possible");
  assert.deepEqual(pool.comparison, comparePillPhotoFeatures(input, catalog()));
});

test("held-only records cannot become model candidates", () => {
  const data = catalog([pillRecord({ PRINT_FRONT: "", PRINT_BACK: "" })]);
  const pool = buildCandidateReviewPool(features(), data);
  assert.equal(pool.comparison.search!.heldCandidates.length, 1);
  assert.equal(pool.status, "no_eligible_candidates");
  assert.equal(pool.eligibleProductCount, 0);
  assert.deepEqual(pool.cards, []);
});

test("a product appearing in both groups supplies only its independently eligible variant", () => {
  const data = catalog([pillRecord(), pillRecord({ PRINT_FRONT: "", PRINT_BACK: "" })]);
  const pool = buildCandidateReviewPool(features(), data);
  assert.equal(pool.comparison.search!.candidates.length, 1);
  assert.equal(pool.comparison.search!.heldCandidates.length, 1);
  assert.equal(pool.cards.length, 1);
  assert.equal(pool.cards[0]!.front.imprint, "TEST");
  assert.equal(pool.bindings[0]!.recordSha256, officialPillRecordDigest(data.items[0]!));
});

test("each card keeps the two sides from one complete official record without swapping or mixing variants", () => {
  const data = catalog([pillRecord(), pillRecord({ PRINT_FRONT: "10", PRINT_BACK: "TEST", LINE_FRONT: "+", LINE_BACK: "-" })]);
  const pool = buildCandidateReviewPool(features(), data);
  assert.equal(pool.cards.length, 2);
  for (const card of pool.cards) {
    const binding = pool.bindings.find(row => row.ref === card.ref)!;
    const record = data.items.find(item => officialPillRecordDigest(item) === binding.recordSha256)!;
    assert.equal(card.front.imprint, record.front.imprint);
    assert.equal(card.back.imprint, record.back.imprint);
    assert.equal(card.front.scoreLine, record.front.scoreLine);
    assert.equal(card.back.scoreLine, record.back.scoreLine);
  }
  const nonMatching = catalog([pillRecord({ PRINT_FRONT: "TEST", PRINT_BACK: "AAAA" }),
    pillRecord({ PRINT_FRONT: "ZZZZ", PRINT_BACK: "10" })]);
  assert.deepEqual(buildCandidateReviewPool(features(), nonMatching).cards, []);
});

test("model cards carry only physical fields and opaque references, not medication identity or diagnostics", () => {
  const data = catalog([pillRecord({ ITEM_NAME: "SECRET_PRODUCT", ENTP_NAME: "SECRET_MAKER",
    MARK_CODE_FRONT_ANAL: "https://health.kr/secret-mark.png" })]);
  const pool = buildCandidateReviewPool(features(), data);
  const serialized = JSON.stringify(pool.cards);
  assert.doesNotMatch(serialized, /SECRET_|209900001|https?:|itemSeq|productName|manufacturer|imageUrl|recordSha256|originalProductRank|grade|evidence|conflicts/);
  assert.deepEqual(Object.keys(pool.cards[0]!).sort(), ["back", "colors", "form", "front", "ref", "shape"]);
  assert.deepEqual(Object.keys(pool.cards[0]!.front).sort(), ["imprint", "imprintHasDescription", "markPresent", "scoreLine"]);
  assert.equal(pool.cards[0]!.front.markPresent, true);
  assert.equal(pool.bindings[0]!.itemSeq, "209900001");
});

test("missing official text stays null rather than becoming observed absence or a fabricated logo reading", () => {
  const data = catalog([pillRecord({ PRINT_BACK: "마크", MARK_CODE_BACK_ANAL: "PRIVATE_LOGO_DESCRIPTION" })]);
  const pool = buildCandidateReviewPool(features(), data);
  assert.equal(pool.status, "ready");
  assert.equal(pool.cards[0]!.back.imprint, null);
  assert.equal(pool.cards[0]!.back.imprintHasDescription, true);
  assert.equal(pool.cards[0]!.back.markPresent, true);
  assert.doesNotMatch(JSON.stringify(pool.cards), /PRIVATE_LOGO_DESCRIPTION|noImprintObserved/);
});

test("100-card cap allocates first variants across all 50 products before second variants", () => {
  const data = catalog(Array.from({ length: 51 }, (_, i) => ["하양", "노랑", "분홍"].map(color =>
    pillRecord({ ITEM_SEQ: String(209900001 + i), COLOR_CLASS1: color }))).flat());
  const pool = buildCandidateReviewPool(features(), data);
  assert.equal(pool.cards.length, MAX_CANDIDATE_REVIEW_CARDS);
  assert.equal(pool.eligibleProductCount, 51);
  assert.equal(pool.truncated, true);
  const counts = new Map<string, number>();
  for (const row of pool.bindings) counts.set(row.itemSeq, (counts.get(row.itemSeq) ?? 0) + 1);
  assert.equal(counts.size, MAX_CANDIDATE_REVIEW_PRODUCTS);
  assert.ok([...counts.values()].every(count => count === 2));
  assert.equal(counts.has("209900051"), false);
});

test("identical official records are deduplicated and do not inflate card truncation", () => {
  const data = catalog([pillRecord(), pillRecord()]);
  const pool = buildCandidateReviewPool(features(), data);
  assert.equal(pool.cards.length, 1);
  assert.equal(pool.truncated, false);
});

test("pool generation preserves inputs and card arrays do not alias catalog colors", () => {
  const input = features(), data = catalog();
  const before = structuredClone({ input, data });
  const pool = buildCandidateReviewPool(input, data);
  assert.deepEqual({ input, data }, before);
  pool.cards[0]!.colors.push("분홍");
  pool.cards[0]!.front.imprint = "ALTERED";
  assert.deepEqual({ input, data }, before);
});
