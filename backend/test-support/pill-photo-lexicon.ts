// Offline catalog inventory and post-fusion counterfactual only. Never import in production routes.
import type { OfficialPillItem } from "../src/official-pill-catalog.ts";
import type { PillCatalog } from "../src/pill-identification.ts";
import { pillPhotoFeaturesSchema, type PillPhotoFeatures } from "../src/pill-photo-features.ts";

export interface PillImprintLexiconEntry {
  normalized: string;
  /** Exact source imprint strings, before this helper's normalization; not raw descriptors. */
  rawStrings: string[];
  itemSeqs: string[];
  /** Side occurrences across all records, including repeated product variants. */
  occurrences: number;
}

const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const exampleLimit = 20;
const nonAscii = /[^\x00-\x7f]/u;

/** Same canonical text normalization as existing search; no punctuation/script removal. */
export const normalizeLexiconText = (value: string) => value.normalize("NFKC").trim().toUpperCase().replace(/\s+/g, "");

function increment(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function sortedCounts(counts: Map<string, number>) {
  return Object.fromEntries([...counts].sort(([a], [b]) => compareText(a, b)));
}

function rawCounts(counts: Map<string, number>) {
  return [...counts].sort(([a], [b]) => compareText(a, b)).map(([raw, occurrences]) => ({ raw, occurrences }));
}

function sideCounts() {
  return { imprintNull: 0, imprintEmpty: 0, imprintNonempty: 0,
    rawImprintNull: 0, rawImprintEmpty: 0, rawImprintNonempty: 0,
    markNull: 0, markEmpty: 0, markNonempty: 0,
    hasDescription: 0, descriptionWithoutText: 0, descriptionWithText: 0 };
}

/** Only front/back.imprint creates entries. Marks and raw descriptor text remain inventory data. */
export function buildPillImprintLexicon(catalog: PillCatalog) {
  const building = new Map<string, { rawStrings: Set<string>; itemSeqs: Set<string>; occurrences: number }>();
  const rawImprints = new Map<string, number>(), rawMarks = new Map<string, number>(), descriptionImprints = new Map<string, number>();
  const rawCharacters = new Map<string, number>(), normalizedCharacters = new Map<string, number>(), lengths = new Map<string, number>();
  const counts = { front: sideCounts(), back: sideCounts() };
  const products = new Set<string>();
  let imprintOccurrences = 0, rawNonAsciiOccurrences = 0, normalizedNonAsciiOccurrences = 0;

  for (const item of catalog.items) {
    products.add(item.itemSeq);
    for (const sideName of ["front", "back"] as const) {
      const side: OfficialPillItem[typeof sideName] = item[sideName];
      const count = counts[sideName];
      const normalized = side.imprint === null ? "" : normalizeLexiconText(side.imprint);
      if (side.imprint === null) count.imprintNull++;
      else if (!normalized) count.imprintEmpty++;
      else count.imprintNonempty++;
      if (side.rawImprint === null) count.rawImprintNull++;
      else {
        if (!normalizeLexiconText(side.rawImprint)) count.rawImprintEmpty++;
        else count.rawImprintNonempty++;
        increment(rawImprints, side.rawImprint);
        for (const character of side.rawImprint) increment(rawCharacters, character);
        if (nonAscii.test(side.rawImprint)) rawNonAsciiOccurrences++;
      }
      if (side.mark === null) count.markNull++;
      else {
        if (!normalizeLexiconText(side.mark)) count.markEmpty++;
        else count.markNonempty++;
        increment(rawMarks, side.mark);
      }
      if (side.imprintHasDescription) {
        count.hasDescription++;
        if (normalized) count.descriptionWithText++;
        else count.descriptionWithoutText++;
        if (side.rawImprint !== null) increment(descriptionImprints, side.rawImprint);
      }
      if (!normalized) continue;
      imprintOccurrences++;
      if (nonAscii.test(normalized)) normalizedNonAsciiOccurrences++;
      for (const character of normalized) increment(normalizedCharacters, character);
      increment(lengths, String([...normalized].length));
      const entry = building.get(normalized) ?? { rawStrings: new Set<string>(), itemSeqs: new Set<string>(), occurrences: 0 };
      entry.rawStrings.add(side.imprint!);
      entry.itemSeqs.add(item.itemSeq);
      entry.occurrences++;
      building.set(normalized, entry);
    }
  }

  const entries = new Map<string, PillImprintLexiconEntry>([...building].sort(([a], [b]) => compareText(a, b)).map(([normalized, entry]) =>
    [normalized, { normalized, rawStrings: [...entry.rawStrings].sort(compareText), itemSeqs: [...entry.itemSeqs].sort(compareText), occurrences: entry.occurrences }]));
  const allEntries = [...entries.values()];
  const shared = allEntries.filter(entry => entry.itemSeqs.length > 1);
  const collisions = allEntries.filter(entry => entry.rawStrings.length > 1);
  const productCounts = new Map<string, number>();
  for (const entry of allEntries) increment(productCounts, String(entry.itemSeqs.length));
  return { entries, inventory: {
    catalogVersion: catalog.version, catalogCompleteness: catalog.completeness, declaredRecordCount: catalog.totalCount,
    catalogRecordCount: catalog.items.length, uniqueProductCount: products.size,
    extraRecordsForExistingProducts: catalog.items.length - products.size,
    sideCounts: counts, lexiconEntryCount: entries.size, imprintOccurrences,
    rawImprints: rawCounts(rawImprints), rawMarks: rawCounts(rawMarks), descriptionImprints: rawCounts(descriptionImprints),
    characterFrequencies: { rawImprints: sortedCounts(rawCharacters), normalizedImprints: sortedCounts(normalizedCharacters) },
    normalizedLengthOccurrenceCounts: sortedCounts(lengths),
    nonAscii: { rawImprintOccurrences: rawNonAsciiOccurrences, normalizedImprintOccurrences: normalizedNonAsciiOccurrences,
      examples: rawCounts(rawImprints).filter(entry => nonAscii.test(entry.raw)).slice(0, exampleLimit) },
    normalizationCollisions: { entryCount: collisions.length,
      examples: collisions.slice(0, exampleLimit).map(entry => ({ normalized: entry.normalized, rawStrings: [...entry.rawStrings] })) },
    sharedImprints: { entryCount: shared.length, maxProductCount: allEntries.reduce((max, entry) => Math.max(max, entry.itemSeqs.length), 0),
      productCountDistribution: sortedCounts(productCounts),
      examples: shared.slice(0, exampleLimit).map(entry => ({ normalized: entry.normalized, productCount: entry.itemSeqs.length, occurrences: entry.occurrences })) },
  } };
}

export type PillImprintLexicon = ReturnType<typeof buildPillImprintLexicon>;

/** String-neighborhood diagnostics only: neither visual evidence nor a product recommendation. */
export function inspectLexiconReadings(rawStrings: string[], lexicon: PillImprintLexicon) {
  return rawStrings.map(raw => {
    const normalized = normalizeLexiconText(raw);
    const exact = lexicon.entries.get(normalized);
    const neighborEligible = /^[A-Z0-9]{2,12}$/.test(normalized);
    const neighbors = new Set<string>();
    if (neighborEligible) {
      for (let index = 0; index < normalized.length; index++) {
        for (const character of "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
          if (character === normalized[index]) continue;
          const candidate = normalized.slice(0, index) + character + normalized.slice(index + 1);
          if (lexicon.entries.has(candidate)) neighbors.add(candidate);
        }
      }
    }
    const sorted = [...neighbors].sort(compareText);
    return { raw, normalized, exactMember: !!exact, productCount: exact?.itemSeqs.length ?? 0, neighborEligible,
      neighbors: sorted.slice(0, exampleLimit), neighborTotalCount: sorted.length, neighborsTruncated: sorted.length > exampleLimit };
  });
}

export interface PillLexiconFilterResult {
  status: "unchanged" | "filtered" | "blocked";
  features: PillPhotoFeatures | null;
  changes: Array<{ side: "front" | "back"; before: string[]; after: string[] }>;
  reason: string;
}

/** Explicit offline POST-FUSION counterfactual. Dictionary suggestions never become observations. */
export function filterFeaturesByLexicon(features: PillPhotoFeatures, lexicon: PillImprintLexicon): PillLexiconFilterResult {
  const parsed = pillPhotoFeaturesSchema.safeParse(features);
  if (!parsed.success) return { status: "blocked", features: null, changes: [], reason: "invalid_feature_schema" };
  const filtered = parsed.data;
  const changes: PillLexiconFilterResult["changes"] = [];
  for (const sideName of ["front", "back"] as const) {
    const side = filtered.observation[sideName];
    if (!side || side.imprintCandidates.length === 0) continue;
    const before = [...side.imprintCandidates];
    const after = before.filter(raw => lexicon.entries.has(normalizeLexiconText(raw)));
    if (before.length !== after.length) {
      changes.push({ side: sideName, before, after: [...after] });
      side.imprintCandidates = after;
    }
  }
  if (changes.some(change => change.after.length === 0)) {
    return { status: "blocked", features: null, changes, reason: "offline_post_fusion_would_remove_all_candidates" };
  }
  const checked = pillPhotoFeaturesSchema.safeParse(filtered);
  if (!checked.success) return { status: "blocked", features: null, changes, reason: "invalid_filtered_feature_schema" };
  return { status: changes.length ? "filtered" : "unchanged", features: checked.data, changes,
    reason: changes.length ? "offline_post_fusion_exact_dictionary_filter_applied" : "offline_post_fusion_exact_dictionary_filter_unchanged" };
}
