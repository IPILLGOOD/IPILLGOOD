import assert from "node:assert/strict";
import test from "node:test";
import { parseOfficialPillPage } from "../src/official-pill-catalog.ts";
import type { PillCatalog } from "../src/pill-identification.ts";
import { pillPhotoFeaturesSchema, type PillPhotoFeatures } from "../src/pill-photo-features.ts";
import { buildPillImprintLexicon, filterFeaturesByLexicon, inspectLexiconReadings, normalizeLexiconText } from "./pill-photo-lexicon.ts";
import { observedSide, pillEnvelope, pillObservation, pillRecord } from "./pill-fixtures.ts";

function catalog(records = [pillRecord()]): PillCatalog {
  return { ...parseOfficialPillPage(pillEnvelope(records), "json", "2026-09-09T00:00:00.000Z"), completeness: "complete", version: "synthetic-lexicon-v1" };
}

function features(): PillPhotoFeatures {
  const { source: _source, ...observation } = pillObservation();
  void _source;
  return pillPhotoFeaturesSchema.parse({ observation, pairConsistency: "consistent", bothSidesVisible: true, imageArtifact: "none" });
}

test("inventory counts records and distinct products, preserving source descriptors, marks and normalization collisions", () => {
  const data = catalog([pillRecord(), pillRecord(), pillRecord({ ITEM_SEQ: "209900002", PRINT_FRONT: "마크 TEST", PRINT_BACK: "마크" })]);
  data.items[0]!.front.imprint = " Ｔｅ ｓｔ ";
  data.items[0]!.front.rawImprint = " Ｔｅ ｓｔ ";
  data.items[0]!.back.imprint = " ";
  data.items[0]!.back.rawImprint = "";
  data.items[0]!.back.mark = "";
  data.items[1]!.back.rawImprint = null;
  data.items[1]!.back.imprint = null;
  const before = structuredClone(data);
  const lexicon = buildPillImprintLexicon(data);
  assert.deepEqual(data, before);
  assert.deepEqual(lexicon.entries.get("TEST"), { normalized: "TEST", rawStrings: [" Ｔｅ ｓｔ ", "TEST"], itemSeqs: ["209900001", "209900002"], occurrences: 3 });
  assert.equal(lexicon.entries.has("마크"), false);
  assert.equal(lexicon.entries.has("마크TEST"), false);
  assert.equal(lexicon.entries.has(""), false);
  const inventory = lexicon.inventory;
  assert.equal(inventory.catalogRecordCount, 3);
  assert.equal(inventory.uniqueProductCount, 2);
  assert.equal(inventory.extraRecordsForExistingProducts, 1);
  assert.equal(inventory.imprintOccurrences, 3);
  assert.equal(inventory.sideCounts.back.imprintNull, 2);
  assert.equal(inventory.sideCounts.back.imprintEmpty, 1);
  assert.equal(inventory.sideCounts.back.rawImprintNull, 1);
  assert.equal(inventory.sideCounts.back.rawImprintEmpty, 1);
  assert.equal(inventory.sideCounts.back.markEmpty, 1);
  assert.equal(inventory.sideCounts.back.markNonempty, 1);
  assert.equal(inventory.sideCounts.back.descriptionWithoutText, 1);
  assert.equal(inventory.sideCounts.front.descriptionWithText, 1);
  assert.deepEqual(inventory.descriptionImprints, [{ raw: "마크", occurrences: 1 }, { raw: "마크 TEST", occurrences: 1 }]);
  assert.equal(inventory.normalizationCollisions.entryCount, 1);
  assert.equal(inventory.sharedImprints.entryCount, 1);
  assert.equal(inventory.sharedImprints.maxProductCount, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(inventory)), inventory);
});

test("normalization retains punctuation and non-Latin text; inventory retains Unicode character frequencies", () => {
  const data = catalog([pillRecord({ PRINT_FRONT: "가-나", PRINT_BACK: "é.1" })]);
  const lexicon = buildPillImprintLexicon(data);
  assert.equal(normalizeLexiconText(" Ａ ｂ\n１ "), "AB1");
  assert.equal(normalizeLexiconText("가-나 é.1"), "가-나É.1");
  assert.equal(lexicon.entries.has("가-나"), true);
  assert.equal(lexicon.entries.has("É.1"), true);
  assert.equal(lexicon.entries.has("가나"), false);
  assert.equal(lexicon.inventory.characterFrequencies.normalizedImprints["가"], 1);
  assert.equal(lexicon.inventory.characterFrequencies.normalizedImprints["-"], 1);
  assert.equal(lexicon.inventory.nonAscii.normalizedImprintOccurrences, 2);
  assert.equal(lexicon.inventory.nonAscii.examples.length, 2);
  const many = catalog(Array.from({ length: 30 }, (_, i) => pillRecord({ PRINT_FRONT: `가${i}`, PRINT_BACK: "" })));
  assert.equal(buildPillImprintLexicon(many).inventory.nonAscii.examples.length, 20);
});

test("each reading gets exact normalized membership and distinct-product counts without correction or labels", () => {
  const lexicon = buildPillImprintLexicon(catalog([pillRecord({ PRINT_FRONT: "AB1" }), pillRecord({ PRINT_FRONT: "AB1" }),
    pillRecord({ ITEM_SEQ: "209900002", PRINT_FRONT: "AB1" })]));
  const input = [" Ａ b １ ", "AB1", "AB1", "ABO", "AB", "A-B1"];
  const before = [...input];
  const rows = inspectLexiconReadings(input, lexicon);
  assert.deepEqual(input, before);
  assert.deepEqual(rows.map(row => row.raw), input);
  assert.deepEqual(rows.map(row => row.exactMember), [true, true, true, false, false, false]);
  assert.deepEqual(rows.map(row => row.productCount), [2, 2, 2, 0, 0, 0]);
  assert.deepEqual(rows[3]!.neighbors, ["AB1"]);
  assert.deepEqual(rows[4]!.neighbors, []);
  assert.equal(rows[5]!.neighborEligible, false);
});

test("one-substitution neighborhood is ASCII-only, length 2–12, deterministic and reports the total beyond 20", () => {
  const alternatives = [..."0123456789BCDEFGHIJKLMNOPQRSTUVWXYZ"].map(character => `${character}A`);
  const records = [...alternatives, "AA", "A", "AAAAAAAAAAAA", "BAAAAAAAAAAA", "AAAAAAAAAAAAA", "BAAAAAAAAAAAA", "가A", "가B", "A-", "B-", "AAA", "BB"]
    .map(value => pillRecord({ PRINT_FRONT: value, PRINT_BACK: "" }));
  const forward = buildPillImprintLexicon(catalog(records));
  const reverse = buildPillImprintLexicon(catalog([...records].reverse()));
  const input = ["AA", "A", "AAAAAAAAAAAA", "AAAAAAAAAAAAA", "가A", "A-", ""];
  const rows = inspectLexiconReadings(input, forward);
  assert.deepEqual(rows, inspectLexiconReadings(input, reverse));
  assert.deepEqual(rows[0]!.neighbors, alternatives.slice().sort().slice(0, 20));
  assert.equal(rows[0]!.neighborTotalCount, 35);
  assert.equal(rows[0]!.neighborsTruncated, true);
  assert.equal(rows[0]!.neighbors.includes("AA"), false);
  assert.equal(rows[0]!.neighbors.includes("BB"), false);
  assert.deepEqual(rows[2]!.neighbors, ["BAAAAAAAAAAA"]);
  for (const index of [1, 3, 4, 5, 6]) {
    assert.equal(rows[index]!.neighborEligible, false);
    assert.equal(rows[index]!.neighborTotalCount, 0);
    assert.equal(rows[index]!.neighborsTruncated, false);
  }
});

test("offline filtering preserves accepted raw order and every other field without mutating input or lexicon", () => {
  const lexicon = buildPillImprintLexicon(catalog());
  const input = features();
  input.observation.front!.imprintCandidates = ["unknown", " test ", "ＴＥＳＴ", "TEST"];
  input.observation.front!.imprintVisibility = "partial";
  input.observation.front!.scoreLine = "unknown";
  input.observation.quality = "unknown";
  input.pairConsistency = "uncertain";
  input.imageArtifact = "uncertain";
  input.bothSidesVisible = false;
  const before = structuredClone({ input, lexicon });
  const result = filterFeaturesByLexicon(input, lexicon);
  assert.equal(result.status, "filtered");
  assert.deepEqual(result.changes, [{ side: "front", before: ["unknown", " test ", "ＴＥＳＴ", "TEST"], after: [" test ", "ＴＥＳＴ", "TEST"] }]);
  const desired = structuredClone(input);
  desired.observation.front!.imprintCandidates.shift();
  assert.deepEqual(result.features, desired);
  assert.deepEqual({ input, lexicon }, before);
  assert.equal(pillPhotoFeaturesSchema.safeParse(result.features).success, true);
});

test("an emptied nonempty side blocks the counterfactual instead of inventing a blank or unreadable observation", () => {
  const lexicon = buildPillImprintLexicon(catalog([pillRecord({ PRINT_FRONT: "AB1" })]));
  for (const visibility of ["clear", "partial"] as const) {
    const input = features();
    input.observation.front = { ...observedSide("ABO", "unknown"), imprintVisibility: visibility };
    const before = structuredClone(input);
    const result = filterFeaturesByLexicon(input, lexicon);
    assert.equal(result.status, "blocked");
    assert.equal(result.features, null);
    assert.equal(result.reason, "offline_post_fusion_would_remove_all_candidates");
    assert.deepEqual(result.changes, [{ side: "front", before: ["ABO"], after: [] }]);
    assert.deepEqual(input, before);
  }
});

test("null, directly observed blank, unreadable and empty partial sides remain exact and do not create dictionary observations", () => {
  const lexicon = buildPillImprintLexicon(catalog());
  const states = [null, observedSide("", "unknown"), observedSide(null, "other"),
    { imprintCandidates: [], noImprintObserved: false, imprintVisibility: "partial" as const, scoreLine: "unknown" as const }];
  for (const side of states) {
    const input = features();
    input.observation.front = side;
    input.observation.back = side;
    const result = filterFeaturesByLexicon(input, lexicon);
    assert.equal(result.status, "unchanged");
    assert.deepEqual(result.features, input);
    assert.deepEqual(result.changes, []);
  }
});

test("filtering honors exact dictionary membership, never inserts neighbors, and rejects invalid strict-schema fields", () => {
  const lexicon = buildPillImprintLexicon(catalog([pillRecord({ PRINT_FRONT: "AB1", MARK_CODE_FRONT_ANAL: "LOGO" })]));
  const input = features();
  input.observation.front!.imprintCandidates = ["ABO", "AB1", "LOGO"];
  assert.deepEqual(filterFeaturesByLexicon(input, lexicon).features!.observation.front!.imprintCandidates, ["AB1"]);
  assert.equal(lexicon.entries.has("LOGO"), false);
  const invalid = { ...input, expectedItemSeq: "209900001" } as PillPhotoFeatures;
  assert.deepEqual(filterFeaturesByLexicon(invalid, lexicon), { status: "blocked", features: null, changes: [], reason: "invalid_feature_schema" });
});
