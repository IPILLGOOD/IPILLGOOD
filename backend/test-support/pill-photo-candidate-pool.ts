// Experimental, internal-only input preparation. Never import in a user-facing route.
import type { OfficialPillSide } from "../src/official-pill-catalog.ts";
import type { PillCatalog, PillCandidateVariant } from "../src/pill-identification.ts";
import { tracePillPhotoFeatures } from "../src/pill-photo-features.ts";
import { officialPillRecordDigest } from "./pill-photo-label-audit.ts";

export const PILL_CANDIDATE_REVIEW_POOL_VERSION = "pill-candidate-review-pool-v1";
export const MAX_CANDIDATE_REVIEW_PRODUCTS = 50;
export const MAX_CANDIDATE_REVIEW_CARDS = 100;

export interface CandidateReviewCardSide {
  imprint: string | null;
  imprintHasDescription: boolean;
  scoreLine: OfficialPillSide["scoreLine"];
  markPresent: boolean;
}
export interface CandidateReviewCard {
  ref: string;
  form: string;
  shape: string | null;
  colors: string[];
  front: CandidateReviewCardSide;
  back: CandidateReviewCardSide;
}
export interface CandidateReviewBinding {
  ref: string;
  itemSeq: string;
  recordSha256: string;
  originalProductRank: number;
}
export interface CandidateReviewPool {
  comparison: ReturnType<typeof tracePillPhotoFeatures>["comparison"];
  status: "ready" | "blocked" | "no_eligible_candidates";
  reason: string;
  /** The only catalog data permitted in a model request. */
  cards: CandidateReviewCard[];
  /** Private lookup only; never include alongside cards in a model request. */
  bindings: CandidateReviewBinding[];
  eligibleProductCount: number;
  truncated: boolean;
}

const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function cardSide(side: OfficialPillSide): CandidateReviewCardSide {
  return { imprint: side.imprint, imprintHasDescription: side.imprintHasDescription,
    scoreLine: side.scoreLine, markPresent: Boolean(side.mark?.trim()) };
}

/**
 * Reuses the real search's pre-display-limit eligibility/ranking, without an answer label.
 * A product's held appearance cannot borrow eligibility from a different appearance.
 * Neither selection nor card presentation is conditioned on a known expected product.
 */
export function buildCandidateReviewPool(features: unknown, catalog: PillCatalog): CandidateReviewPool {
  const { comparison, trace } = tracePillPhotoFeatures(features, catalog);
  const empty = (status: CandidateReviewPool["status"], reason: string): CandidateReviewPool => ({
    comparison, status, reason, cards: [], bindings: [], eligibleProductCount: 0, truncated: false,
  });
  if (comparison.status !== "searched" || !trace?.matchingStarted) {
    return empty("blocked", comparison.search?.reason ?? comparison.reason);
  }
  if (comparison.search.status !== "candidates_found" && comparison.search.status !== "needs_review") {
    return empty("blocked", comparison.search.reason);
  }
  if (!comparison.observation.front?.imprintCandidates.length && !comparison.observation.back?.imprintCandidates.length) {
    return empty("blocked", "no_readable_imprint_evidence");
  }
  const eligible = trace.candidatesBeforeLimit;
  if (!eligible.length) return empty("no_eligible_candidates", "no_eligible_candidate_variants");

  const selectedProducts = eligible.slice(0, MAX_CANDIDATE_REVIEW_PRODUCTS).map((candidate, index) => {
    const seen = new Set<string>();
    return candidate.variants.flatMap(variant => {
      // Defensive exclusion as well as the search's candidate/held partition.
      if (variant.reviewReasons.length) return [];
      const digest = officialPillRecordDigest(variant.item);
      if (seen.has(digest)) return [];
      seen.add(digest);
      return [{ variant, digest, originalProductRank: index + 1 }];
    });
  });
  const selected: Array<{ variant: PillCandidateVariant; digest: string; originalProductRank: number }> = [];
  // First appearance of every selected product before any product's second appearance.
  for (let appearanceIndex = 0; selected.length < MAX_CANDIDATE_REVIEW_CARDS; appearanceIndex++) {
    let added = false;
    for (const variants of selectedProducts) {
      const entry = variants[appearanceIndex];
      if (entry) {
        selected.push(entry);
        added = true;
      }
      if (selected.length === MAX_CANDIDATE_REVIEW_CARDS) break;
    }
    if (!added) break;
  }
  if (!selected.length) return empty("no_eligible_candidates", "no_eligible_candidate_variants");
  // Do not expose original rank through request order or references.
  selected.sort((a, b) => compareText(a.digest, b.digest));
  const cards: CandidateReviewCard[] = [], bindings: CandidateReviewBinding[] = [];
  for (const [index, entry] of selected.entries()) {
    const ref = `c${String(index + 1).padStart(3, "0")}`;
    const item = entry.variant.item;
    cards.push({ ref, form: item.form, shape: item.shape, colors: [...item.colors],
      // Keep the complete official record in its official orientation, not separate best faces.
      front: cardSide(item.front), back: cardSide(item.back) });
    bindings.push({ ref, itemSeq: item.itemSeq, recordSha256: entry.digest,
      originalProductRank: entry.originalProductRank });
  }
  return { comparison, status: "ready", reason: "eligible_variant_cards_prepared", cards, bindings,
    eligibleProductCount: eligible.length,
    truncated: eligible.length > selectedProducts.length
      || selectedProducts.reduce((sum, variants) => sum + variants.length, 0) > selected.length };
}
