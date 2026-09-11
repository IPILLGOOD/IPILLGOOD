// Private, post-search label-assisted diagnostics. Never import in a user-facing route.
import { isDeepStrictEqual } from "node:util";
import { tracePillPhotoFeatures, pillPhotoSafetyFacts } from "../src/pill-photo-features.ts";
import { explainPillVariantOrdering, type PillCatalog, type PillCandidate, type PillCandidateVariant } from "../src/pill-identification.ts";
import { officialPillRecordDigest } from "./pill-photo-label-audit.ts";

const rankOf = (pool: PillCandidate[], itemSeq: string) => {
  const index = pool.findIndex(candidate => candidate.itemSeq === itemSeq);
  return index < 0 ? null : index + 1;
};
const membership = (candidate: number | null, held: number | null) => candidate !== null
  ? held !== null ? "both" : "candidate_only" : held !== null ? "held_only" : "neither";
function variantSummary(variant: PillCandidateVariant) {
  return { officialRecordSha256: officialPillRecordDigest(variant.item), orientation: variant.orientation,
    grade: variant.grade, matchType: variant.matchType, evidence: variant.evidence,
    conflicts: variant.conflicts, reviewReasons: variant.reviewReasons, formAssessment: variant.formAssessment };
}

export function diagnosePillSearch(features: unknown, catalog: PillCatalog, expectedItemSeq: string) {
  // No expected code or reference appearance is passed into candidate generation, ranking or tracing.
  const { comparison, trace } = tracePillPhotoFeatures(features, catalog);
  const search = comparison.search;
  const candidates = trace?.candidatesBeforeLimit ?? [], held = trace?.heldBeforeLimit ?? [];
  const candidateRank = rankOf(candidates, expectedItemSeq), heldRank = rankOf(held, expectedItemSeq);
  const returnedRank = rankOf(search?.candidates ?? [], expectedItemSeq);
  const returnedHeldRank = rankOf(search?.heldCandidates ?? [], expectedItemSeq);
  const reference = candidates.find(candidate => candidate.itemSeq === expectedItemSeq)?.variants[0]
    ?? held.find(candidate => candidate.itemSeq === expectedItemSeq)?.variants[0];
  const gateReason = !trace?.matchingStarted ? search?.reason ?? comparison.reason : null;
  const expectedRecords = catalog.items.filter(item => item.itemSeq === expectedItemSeq);
  const facts = pillPhotoSafetyFacts(comparison);
  return {
    provenance: "current_reconstruction" as const,
    comparisonStatus: comparison.status, comparisonReason: comparison.reason,
    searchStatus: search?.status ?? null, searchReason: search?.reason ?? null,
    expectedRank: returnedRank, expectedHeld: returnedHeldRank !== null,
    candidateRankBeforeLimit: candidateRank, heldRankBeforeLimit: heldRank, returnedHeldRank,
    expectedMembership: membership(candidateRank, heldRank), returnedMembership: membership(returnedRank, returnedHeldRank),
    expectedDisposition: gateReason ? "blocked_before_matching" : !expectedRecords.length ? "absent_from_catalog"
      : returnedRank !== null ? "returned_candidate" : candidateRank !== null ? "eligible_outside_top20"
        : returnedHeldRank !== null ? "returned_held" : heldRank !== null ? "held_outside_display_limit" : "not_eligible_under_current_rules",
    gateReason,
    candidateItemSeqs: facts.candidateItemSeqs, heldCandidateItemSeqs: facts.heldCandidateItemSeqs,
    candidateCount: candidates.length, heldCandidateCount: held.length,
    expectedCatalogRecords: expectedRecords.map(item => ({ officialRecordSha256: officialPillRecordDigest(item),
      front: item.front, back: item.back, formName: item.formName, shape: item.shape, colors: item.colors })),
    recordOutcomes: (trace?.records ?? []).filter(record => record.itemSeq === expectedItemSeq).map(record => ({
      officialRecordSha256: officialPillRecordDigest(catalog.items[record.catalogIndex]!), outcome: record.outcome,
      selectedVariant: record.selectedVariant ? variantSummary(record.selectedVariant) : null,
    })),
    expectedVariants: [...candidates.filter(candidate => candidate.itemSeq === expectedItemSeq).map(candidate => ({ pool: "candidate", candidate })),
      ...held.filter(candidate => candidate.itemSeq === expectedItemSeq).map(candidate => ({ pool: "held", candidate }))]
      .flatMap(({ pool, candidate }) => candidate.variants.map(variant => ({ pool, ...variantSummary(variant) }))),
    competitors: candidates.slice(0, 3).filter(candidate => candidate.itemSeq !== expectedItemSeq).map(candidate => {
      const best = candidate.variants[0]!;
      return { itemSeq: candidate.itemSeq, rankBeforeLimit: rankOf(candidates, candidate.itemSeq), ...variantSummary(best),
        comparisonToExpectedBest: reference ? {
          ...explainPillVariantOrdering(best, reference),
          evidenceDifferences: [...new Set([...best.evidence, ...reference.evidence].map(evidence => evidence.field))].flatMap(field => {
            const competitor = best.evidence.filter(evidence => evidence.field === field);
            const expected = reference.evidence.filter(evidence => evidence.field === field);
            return isDeepStrictEqual(competitor, expected) ? [] : [{ field, competitor, expected }];
          }),
          interpretation: "Exact existing comparator result; listed feature differences are not independently causal effects.",
        } : null };
    }),
    safety: { ...facts, strongWrongCandidates: facts.strongCandidateItemSeqs.filter(id => id !== expectedItemSeq).length },
    limitations: ["Pre-limit ranks are reconstructed by the current search, not a historical internal log.",
      "Each orientation/evidence bundle belongs to one official record; no variant surfaces are combined.",
      "A rejected record's stage is observed here; physical crop/lighting or model-error causes are not established."],
  };
}

/** Compare only fields actually saved then. Missing fields must never be filled from current results. */
export function compareHistoricalPillRow(stored: Record<string, unknown>, reconstructed: Record<string, unknown>) {
  const keys = ["id", "expectedItemSeq", "extractionStatus", "failureReason", "comparisonStatus", "comparisonReason",
    "searchStatus", "expectedRank", "expectedHeld", "candidateItemSeqs", "heldCandidateItemSeqs", "strongCandidateItemSeqs",
    "strongWrongCandidateItemSeqs", "needsRetake"];
  const fields = keys.map(field => ({ field, recorded: Object.hasOwn(stored, field),
    equal: Object.hasOwn(stored, field) ? isDeepStrictEqual(stored[field], reconstructed[field]) : null,
    historical: Object.hasOwn(stored, field) ? stored[field] : null, reconstructed: reconstructed[field] }));
  return { fields, savedFieldsEqual: fields.every(field => field.equal !== false),
    unavailableHistoricalFields: ["full_variant_grades", "pre_limit_ranks", "variant_evidence", "record_rejection_details"],
    historicalGradeComparison: "strong_membership_only; full grades were not recorded",
    differencesAreInstrumentationRegression: false };
}
