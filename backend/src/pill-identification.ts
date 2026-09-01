import { z } from "zod";
import type { OfficialPillItem, OfficialPillSide, PillScoreLine } from "./official-pill-catalog.ts";
import { stableJson } from "./stable-json.ts";
import { classifyPillForm, PILL_FORM_POLICY_VERSION, type PillFormAssessment } from "./pill-form-policy.ts";

export const PILL_SEARCH_RULES_VERSION = "pill-structured-v3-evidence-gate";
export const PILL_OBSERVATION_SCHEMA_VERSION = "pill-observation.v2";

const legacySideSchema = z.object({
  imprint: z.string().trim().max(80).nullable(),
  scoreLine: z.enum(["none", "single", "cross", "other", "unknown"]),
}).strict();

const commonObservationFields = {
  form: z.enum(["tablet", "capsule", "powder", "granule", "liquid", "other", "unknown"]),
  integrity: z.enum(["intact", "split", "damaged", "unknown"]),
  count: z.number().int().min(0).max(100),
  overlapping: z.boolean(),
  quality: z.enum(["clear", "blurred", "dark", "too_small", "unknown"]),
  shape: z.string().trim().min(1).max(40).nullable(),
  colors: z.array(z.string().trim().min(1).max(20)).max(4),
} as const;

/** Historical input only. New callers must use pillObservationSchema. */
export const pillObservationBodyV1Schema = z.object({
  ...commonObservationFields,
  front: legacySideSchema.nullable(),
  back: legacySideSchema.nullable(),
}).strict();
export const pillObservationV1Schema = pillObservationBodyV1Schema.extend({
  source: z.enum(["manual", "image_features"]),
}).strict();

const imprintCandidateSchema = z.string().max(80).refine((value) => value.trim().length > 0, "blank_imprint_candidate");
export const observedPillSideSchema = z.object({
  // Preserve model/manual text exactly. Normalization and server expansions happen later with provenance.
  imprintCandidates: z.array(imprintCandidateSchema).max(5),
  noImprintObserved: z.boolean(),
  imprintVisibility: z.enum(["clear", "partial", "unreadable"]),
  scoreLine: z.enum(["none", "single", "cross", "other", "unknown"]),
}).strict().superRefine((side, context) => {
  if (side.noImprintObserved && (side.imprintCandidates.length > 0 || side.imprintVisibility !== "clear")) {
    context.addIssue({ code: "custom", path: ["noImprintObserved"], message: "invalid_no_imprint_state" });
  }
  if (side.imprintVisibility === "unreadable" && (side.noImprintObserved || side.imprintCandidates.length > 0)) {
    context.addIssue({ code: "custom", path: ["imprintVisibility"], message: "invalid_unreadable_state" });
  }
  if (side.imprintVisibility === "clear" && !side.noImprintObserved && side.imprintCandidates.length === 0) {
    context.addIssue({ code: "custom", path: ["imprintCandidates"], message: "clear_imprint_requires_observation" });
  }
});

export const pillObservationBodySchema = z.object({
  schemaVersion: z.literal(PILL_OBSERVATION_SCHEMA_VERSION),
  ...commonObservationFields,
  front: observedPillSideSchema.nullable(),
  back: observedPillSideSchema.nullable(),
}).strict();
export const pillObservationSchema = pillObservationBodySchema.extend({
  source: z.enum(["manual", "image_features"]),
}).strict();

export type PillObservation = z.infer<typeof pillObservationSchema>;
export type PillObservationV1 = z.infer<typeof pillObservationV1Schema>;
export type ObservedPillSide = z.infer<typeof observedPillSideSchema>;

export function migrateObservedPillSideV1(value: z.infer<typeof legacySideSchema> | null): ObservedPillSide | null {
  if (value === null) return null;
  if (value.imprint === null) return { imprintCandidates: [], noImprintObserved: false, imprintVisibility: "unreadable", scoreLine: value.scoreLine };
  if (value.imprint === "") return { imprintCandidates: [], noImprintObserved: true, imprintVisibility: "clear", scoreLine: value.scoreLine };
  return { imprintCandidates: [value.imprint], noImprintObserved: false, imprintVisibility: "clear", scoreLine: value.scoreLine };
}

export function migratePillObservationBodyV1(value: unknown): z.infer<typeof pillObservationBodySchema> {
  const parsed = pillObservationBodyV1Schema.parse(value);
  return pillObservationBodySchema.parse({
    ...parsed,
    schemaVersion: PILL_OBSERVATION_SCHEMA_VERSION,
    front: migrateObservedPillSideV1(parsed.front),
    back: migrateObservedPillSideV1(parsed.back),
  });
}

export function migratePillObservationV1(value: unknown): PillObservation {
  const parsed = pillObservationV1Schema.parse(value);
  const { source, ...body } = parsed;
  return pillObservationSchema.parse({ ...migratePillObservationBodyV1(body), source });
}

export interface PillCatalog {
  items: OfficialPillItem[];
  totalCount: number;
  completeness: "complete" | "partial";
  version: string;
}
type Match = "exact" | "partial" | "unknown" | "mismatch";
type MatchType = "exact" | "partial" | "incomplete";
export type PillReviewReason = "no_imprint_evidence" | "unknown_official_form";
export interface PillFeatureMatch {
  field: string;
  observed: string;
  official: string | null;
  match: Match;
}
export interface PillCandidateVariant {
  item: OfficialPillItem;
  orientation: "direct" | "swapped";
  matchType: MatchType;
  evidence: PillFeatureMatch[];
  formAssessment: PillFormAssessment;
  reviewReasons: PillReviewReason[];
}
export interface PillCandidate {
  itemSeq: string;
  matchType: MatchType;
  variants: PillCandidateVariant[];
}
export interface PillSearchMetrics {
  catalogRecords: number;
  /** Non-mismatching records before the final evidence gate; not identified products. */
  stages: Array<{ stage: "form" | "color" | "shape" | "imprint" | "score_line"; remaining: number }>;
  /** Eligible products only. Held products have separate counts and display limits. */
  candidateCount: number;
  returnedCount: number;
  heldCandidateCount: number;
  heldReturnedCount: number;
  /** Union of product IDs in both groups, since different variants can be in each. */
  matchedItemCount: number;
  unsupportedCatalogRecords: number;
}
export interface PillSearchResult {
  status: "candidates_found" | "needs_review" | "needs_retake" | "unsupported_form" | "unidentified" | "not_configured" | "unavailable" | "invalid_input";
  reason: string;
  message: string;
  notice: string;
  candidates: PillCandidate[];
  /** Diagnostic comparisons only, not fallback matches or medication identities. */
  heldCandidates: PillCandidate[];
  metrics: PillSearchMetrics;
  catalogVersion: string | null;
  truncated: boolean;
  heldTruncated: boolean;
  observationSchemaVersion: string;
  searchRulesVersion: string;
  formPolicyVersion: string;
}

const NOTICE = "공식 데이터와 외형을 비교한 후보이며 약의 확정이나 복용 가능 여부를 뜻하지 않아요. 원본 약 봉투·처방전·약사 안내와 함께 확인해주세요.";
const matchOrder: Record<MatchType, number> = { exact: 0, partial: 1, incomplete: 2 };
const normalize = (text: string) => text.normalize("NFKC").trim().toUpperCase();
const imprintText = (text: string) => normalize(text).replace(/\s+/g, "");
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const primaryObservedImprint = (side: ObservedPillSide) => side.noImprintObserved ? "" : side.imprintCandidates[0] ?? null;

function compareText(field: string, observed: string, official: string | null, partial = false): PillFeatureMatch {
  const normalizer = partial ? imprintText : normalize;
  const wanted = normalizer(observed);
  const actual = official === null ? null : normalizer(official);
  const match: Match = actual === null ? "unknown" : wanted === actual ? "exact"
    : partial && wanted.length > 0 && actual.includes(wanted) ? "partial" : "mismatch";
  return { field, observed, official, match };
}

function compareScore(field: string, observed: PillScoreLine, official: PillScoreLine): PillFeatureMatch {
  // "other" does not mean two unrecognized line patterns are the same.
  const unknown = [observed, official].some((value) => value === "unknown" || value === "other");
  return { field, observed, official, match: unknown ? "unknown" : observed === official ? "exact" : "mismatch" };
}

function sideEvidence(observed: NonNullable<PillObservation["front"]>, actual: OfficialPillSide, label: string, withScore: boolean): PillFeatureMatch[] {
  const imprint = compareText(`${label}.imprint`, primaryObservedImprint(observed)!, actual.imprint, true);
  // A separate official logo is not evidence of an unmarked surface.
  if (observed.noImprintObserved && actual.mark) imprint.match = "mismatch";
  return [
    imprint,
    // Extracted letters are searchable, but the removed notation/mark was not compared.
    ...(actual.imprintHasDescription ? [{ field: `${label}.imprintDescription`, observed: "not_compared", official: actual.rawImprint, match: "unknown" as const }] : []),
    ...(actual.mark ? [{ field: `${label}.mark`, observed: "not_compared", official: actual.mark, match: "unknown" as const }] : []),
    ...(withScore ? [compareScore(`${label}.scoreLine`, observed.scoreLine, actual.scoreLine)] : []),
  ];
}

function matchingSides(input: PillObservation, item: OfficialPillItem, withScore: boolean) {
  return (["direct", "swapped"] as const).map((orientation) => ({
    orientation,
    evidence: [
      ...sideEvidence(input.front!, orientation === "direct" ? item.front : item.back, "front", withScore),
      ...sideEvidence(input.back!, orientation === "direct" ? item.back : item.front, "back", withScore),
    ],
  })).filter(({ evidence }) => evidence.every((entry) => entry.match !== "mismatch"));
}

function matchType(evidence: PillFeatureMatch[]): MatchType {
  return evidence.some((entry) => entry.match === "unknown") ? "incomplete"
    : evidence.some((entry) => entry.match === "partial") ? "partial" : "exact";
}

function imprintMatches(evidence: PillFeatureMatch[]) {
  // Matching two blank surfaces is not distinctive lettering evidence.
  return evidence.filter((entry) => entry.field.endsWith(".imprint") && imprintText(entry.observed).length > 0
    && (entry.match === "exact" || entry.match === "partial"));
}

function compareVariantEvidence(a: PillCandidateVariant, b: PillCandidateVariant): number {
  const aImprints = imprintMatches(a.evidence);
  const bImprints = imprintMatches(b.evidence);
  // All incomplete records are not equally supported. Prefer compared surfaces, never a fabricated confidence score.
  return Number(a.reviewReasons.length > 0) - Number(b.reviewReasons.length > 0)
    || matchOrder[a.matchType] - matchOrder[b.matchType]
    || bImprints.length - aImprints.length
    || bImprints.filter((entry) => entry.match === "exact").length - aImprints.filter((entry) => entry.match === "exact").length
    || b.evidence.filter((entry) => !entry.field.endsWith(".imprint") && entry.match === "exact").length
      - a.evidence.filter((entry) => !entry.field.endsWith(".imprint") && entry.match === "exact").length;
}

/** Pure candidate search: no image model, persistence, AI requests or medication activation. */
export function searchPillCandidates(input: unknown, catalog?: PillCatalog, options: { limit?: number } = {}): PillSearchResult {
  const metrics: PillSearchMetrics = {
    catalogRecords: 0, stages: [], candidateCount: 0, returnedCount: 0,
    heldCandidateCount: 0, heldReturnedCount: 0, matchedItemCount: 0, unsupportedCatalogRecords: 0,
  };
  const result = (status: PillSearchResult["status"], reason: string, message: string): PillSearchResult => ({
    status, reason, message, notice: NOTICE, candidates: [], heldCandidates: [], metrics,
    catalogVersion: catalog?.version ?? null, truncated: false, heldTruncated: false,
    observationSchemaVersion: PILL_OBSERVATION_SCHEMA_VERSION,
    searchRulesVersion: PILL_SEARCH_RULES_VERSION, formPolicyVersion: PILL_FORM_POLICY_VERSION,
  });
  const parsed = pillObservationSchema.safeParse(input);
  const limit = options.limit ?? 20;
  if (!parsed.success || !Number.isInteger(limit) || limit < 1 || limit > 100) return result("invalid_input", "invalid_observation", "약의 상태와 특징 입력을 확인해주세요.");
  const observation = parsed.data;
  if (["powder", "granule", "liquid", "other"].includes(observation.form)) return result("unsupported_form", "unsupported_dosage_form", "가루약·과립·액상 등은 낱알 후보 검색을 지원하지 않아요. 포장과 약사 안내로 확인해주세요.");
  if (observation.integrity === "split" || observation.integrity === "damaged") return result("unsupported_form", "altered_pill", "반쪽·훼손 약은 원래 제품으로 추정하지 않아요. 약 봉투와 약사 안내를 확인해주세요.");
  if (observation.count === 0) return result("unidentified", "no_pill", "확인할 알약 한 개가 필요해요.");
  if (observation.count !== 1 || observation.overlapping) return result("needs_retake", "multiple_or_overlapping", "약을 한 개씩 분리하고 겹치지 않게 확인해주세요.");
  if (observation.quality !== "clear" || observation.integrity === "unknown") return result("needs_retake", "unclear_observation", "밝은 곳에서 단색 배경에 약 한 개를 놓고 가까이 초점을 맞춰 앞뒤를 확인해주세요.");
  if (!observation.front || !observation.back || primaryObservedImprint(observation.front) === null || primaryObservedImprint(observation.back) === null) return result("needs_retake", "missing_surface", "같은 약의 앞면과 뒷면 각인을 모두 확인해주세요. 글자가 없는 면도 직접 확인이 필요해요.");
  if (!observation.shape || observation.colors.length === 0) return result("needs_retake", "missing_features", "모양과 색상을 확인할 수 있도록 다시 관찰하거나 촬영해주세요.");
  if (observation.form === "unknown") return result("unidentified", "unknown_form", "온전한 정제·캡슐인지 확인하지 못했어요.");
  if (!catalog) return result("not_configured", "catalog_not_configured", "공식 낱알 카탈로그가 아직 연결되지 않았어요.");
  if (catalog.completeness !== "complete" || !catalog.version.trim() || catalog.totalCount !== catalog.items.length) return result("unavailable", "incomplete_catalog", "공식 데이터 수집이 완료되지 않아 후보 검색을 보류했어요.");

  metrics.catalogRecords = catalog.items.length;
  const assessed = catalog.items.map((item) => ({ item, formAssessment: classifyPillForm(item.formName), evidence: [] as PillFeatureMatch[] }));
  metrics.unsupportedCatalogRecords = assessed.filter((entry) => entry.formAssessment.status === "unsupported").length;
  let records = assessed.filter((entry) => entry.formAssessment.status !== "unsupported");
  const filter = (stage: PillSearchMetrics["stages"][number]["stage"], evidence: (item: OfficialPillItem, form: PillFormAssessment) => PillFeatureMatch) => {
    records = records.map((entry) => ({ ...entry, evidence: [...entry.evidence, evidence(entry.item, entry.formAssessment)] }))
      .filter((entry) => entry.evidence.every((feature) => feature.match !== "mismatch"));
    metrics.stages.push({ stage, remaining: records.length });
  };
  filter("form", (_item, assessment) => compareText("form", observation.form, assessment.form));
  filter("color", (item) => {
    const wanted = [...new Set(observation.colors.map(normalize))].sort();
    const actual = [...new Set(item.colors.map(normalize))].sort();
    const match: Match = actual.length === 0 ? "unknown" : !wanted.every((color) => actual.includes(color)) ? "mismatch"
      : actual.length === wanted.length ? "exact" : "partial";
    return { field: "colors", observed: wanted.join("/"), official: actual.length ? actual.join("/") : null, match };
  });
  filter("shape", (item) => {
    // Two different irregular shapes can both be classified as 기타.
    if (normalize(observation.shape!) === "기타" || item.shape && normalize(item.shape) === "기타") {
      return { field: "shape", observed: observation.shape!, official: item.shape, match: "unknown" };
    }
    return compareText("shape", observation.shape!, item.shape);
  });
  records = records.filter(({ item }) => matchingSides(observation, item, false).length > 0);
  metrics.stages.push({ stage: "imprint", remaining: records.length });
  const variants: PillCandidateVariant[] = [];
  for (const entry of records) {
    const choices = matchingSides(observation, entry.item, true).map((choice) => {
      const evidence = [...entry.evidence, ...choice.evidence];
      const reviewReasons: PillReviewReason[] = [];
      if (entry.formAssessment.status !== "supported") reviewReasons.push("unknown_official_form");
      if (imprintMatches(evidence).length === 0) reviewReasons.push("no_imprint_evidence");
      return { item: entry.item, orientation: choice.orientation, matchType: matchType(evidence), evidence,
        formAssessment: entry.formAssessment, reviewReasons };
    }).filter((choice) => choice.evidence.some((feature) => feature.match === "exact" || feature.match === "partial"))
      .sort(compareVariantEvidence);
    if (choices[0]) variants.push(choices[0]);
  }
  metrics.stages.push({ stage: "score_line", remaining: variants.length });
  // Stable code/record tie-breaks, not a fabricated probability or a clinical confidence score.
  variants.sort((a, b) => compareVariantEvidence(a, b) || compare(a.item.itemSeq, b.item.itemSeq) || compare(stableJson(a.item), stableJson(b.item)));
  const grouped = new Map<string, PillCandidate>();
  const held = new Map<string, PillCandidate>();
  for (const variant of variants) {
    // Partition variants too: a strong variant must not promote weak variants of the same product.
    const destination = variant.reviewReasons.length ? held : grouped;
    const candidate = destination.get(variant.item.itemSeq);
    if (candidate) candidate.variants.push(variant);
    else destination.set(variant.item.itemSeq, { itemSeq: variant.item.itemSeq, matchType: variant.matchType, variants: [variant] });
  }
  metrics.candidateCount = grouped.size;
  metrics.heldCandidateCount = held.size;
  metrics.matchedItemCount = new Set([...grouped.keys(), ...held.keys()]).size;
  const candidates = [...grouped.values()].slice(0, limit);
  const heldCandidates = [...held.values()].slice(0, limit);
  metrics.returnedCount = candidates.length;
  metrics.heldReturnedCount = heldCandidates.length;
  if (!candidates.length && !heldCandidates.length) return result("unidentified", "no_candidates", "입력한 특징에 맞는 공식 후보가 없어요. 약 이름을 추측하지 않으니 약 봉투와 약사 안내로 확인해주세요.");
  return {
    ...(candidates.length
      ? result("candidates_found", "comparison_required", "각인 비교 근거가 있는 후보예요. 약의 확정이 아니므로 공식 이미지와 각인을 함께 비교해주세요.")
      : result("needs_review", "insufficient_official_evidence", "공식 각인·제형 정보가 부족해 후보 제시를 보류했어요. 약을 찾았다는 뜻이 아니며 약 봉투와 약사 안내로 확인해주세요.")),
    candidates, heldCandidates, truncated: metrics.candidateCount > candidates.length,
    heldTruncated: metrics.heldCandidateCount > heldCandidates.length,
  };
}
