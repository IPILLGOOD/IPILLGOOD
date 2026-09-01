import { z } from "zod";
import type { OfficialPillItem, OfficialPillSide, PillScoreLine } from "./official-pill-catalog.ts";
import { stableJson } from "./stable-json.ts";
import { classifyPillForm, PILL_FORM_POLICY_VERSION, type PillFormAssessment } from "./pill-form-policy.ts";

export const PILL_SEARCH_RULES_VERSION = "pill-structured-v4-imprint-first";
export const PILL_OBSERVATION_SCHEMA_VERSION = "pill-observation.v2";
export const PILL_IMPRINT_CONFUSION_RULES_VERSION = "pill-imprint-confusion-v1";
export const MAX_IMPRINT_CANDIDATES_PER_SIDE = 5;
export const MAX_IMPRINT_EXPANSIONS_PER_CANDIDATE = 16;
export const MAX_IMPRINT_READINGS_PER_SIDE = 40;

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
  imprintCandidates: z.array(imprintCandidateSchema).max(MAX_IMPRINT_CANDIDATES_PER_SIDE),
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
export type PillCandidateGrade = "strong" | "possible";
export type PillImprintReadingOrigin = "observed_candidate" | "server_confusion_expansion";
export type PillReviewReason = "no_imprint_evidence" | "unknown_official_form";
export interface PillImprintSubstitution {
  index: number;
  from: string;
  to: string;
}
export interface PillImprintReadingEvidence {
  value: string;
  normalized: string;
  origin: PillImprintReadingOrigin;
  observedCandidate: string;
  observedCandidateIndex: number | null;
  substitutions: PillImprintSubstitution[];
}
export interface PillFeatureMatch {
  field: string;
  observed: string;
  official: string | null;
  match: Match;
  imprintReading?: PillImprintReadingEvidence;
}
export interface PillCandidateVariant {
  item: OfficialPillItem;
  orientation: "direct" | "swapped";
  matchType: MatchType;
  grade: PillCandidateGrade;
  evidence: PillFeatureMatch[];
  conflicts: PillFeatureMatch[];
  formAssessment: PillFormAssessment;
  reviewReasons: PillReviewReason[];
}
export interface PillCandidate {
  itemSeq: string;
  matchType: MatchType;
  grade: PillCandidateGrade;
  variants: PillCandidateVariant[];
}
export interface PillImprintExpansionSideSummary {
  observedCandidateCount: number;
  serverExpansionCount: number;
  totalReadingCount: number;
  truncated: boolean;
}
export interface PillImprintExpansionSummary {
  front: PillImprintExpansionSideSummary;
  back: PillImprintExpansionSideSummary;
}
export interface PillSearchMetrics {
  catalogRecords: number;
  /** Imprint-generated records and subsequent soft-ranking stages; not identified products. */
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
  imprintExpansionRulesVersion: string;
  imprintExpansion: PillImprintExpansionSummary | null;
  searchRulesVersion: string;
  formPolicyVersion: string;
}

const NOTICE = "공식 데이터와 외형을 비교한 후보이며 약의 확정이나 복용 가능 여부를 뜻하지 않아요. 원본 약 봉투·처방전·약사 안내와 함께 확인해주세요.";
const matchOrder: Record<MatchType, number> = { exact: 0, partial: 1, incomplete: 2 };
const gradeOrder: Record<PillCandidateGrade, number> = { strong: 0, possible: 1 };
const normalize = (text: string) => text.normalize("NFKC").trim().toUpperCase();
const imprintText = (text: string) => normalize(text).replace(/\s+/g, "");
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

const confusionGroups = [
  ["O", "0"],
  ["I", "1", "L"],
  ["B", "8"],
  ["S", "5"],
  ["Z", "2"],
  ["A", "4"],
] as const;
const confusionAlternatives = new Map<string, string[]>();
for (const group of confusionGroups) {
  for (const value of group) confusionAlternatives.set(value, group.filter((candidate) => candidate !== value));
}

interface PreparedObservedSide {
  side: ObservedPillSide;
  readings: PillImprintReadingEvidence[];
  summary: PillImprintExpansionSideSummary;
}

function expandImprintCandidate(candidate: string, candidateIndex: number) {
  const normalized = imprintText(candidate);
  const characters = [...normalized];
  const variants = [{ value: normalized, substitutions: [] as PillImprintSubstitution[] }];
  const seen = new Set([normalized]);
  let truncated = false;

  expansion: for (let index = 0; index < characters.length; index++) {
    const alternatives = confusionAlternatives.get(characters[index]!);
    if (!alternatives) continue;
    const previousVariants = [...variants];
    for (const variant of previousVariants) {
      for (const alternative of alternatives) {
        const next = [...variant.value];
        next[index] = alternative;
        const value = next.join("");
        if (seen.has(value)) continue;
        if (variants.length - 1 >= MAX_IMPRINT_EXPANSIONS_PER_CANDIDATE) {
          truncated = true;
          break expansion;
        }
        seen.add(value);
        variants.push({
          value,
          substitutions: [...variant.substitutions, { index, from: characters[index]!, to: alternative }],
        });
      }
    }
  }

  return {
    readings: variants.slice(1).map((variant): PillImprintReadingEvidence => ({
      value: variant.value,
      normalized: variant.value,
      origin: "server_confusion_expansion",
      observedCandidate: candidate,
      observedCandidateIndex: candidateIndex,
      substitutions: variant.substitutions,
    })),
    truncated,
  };
}

function prepareObservedSide(side: ObservedPillSide): PreparedObservedSide {
  const readings: PillImprintReadingEvidence[] = [];
  const seen = new Set<string>();
  if (side.noImprintObserved) {
    readings.push({
      value: "", normalized: "", origin: "observed_candidate", observedCandidate: "",
      observedCandidateIndex: null, substitutions: [],
    });
    seen.add("");
  } else {
    for (const [candidateIndex, candidate] of side.imprintCandidates.entries()) {
      const normalized = imprintText(candidate);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      readings.push({
        value: candidate, normalized, origin: "observed_candidate", observedCandidate: candidate,
        observedCandidateIndex: candidateIndex, substitutions: [],
      });
    }
  }

  let truncated = false;
  if (!side.noImprintObserved) {
    expansion: for (const [candidateIndex, candidate] of side.imprintCandidates.entries()) {
      const expanded = expandImprintCandidate(candidate, candidateIndex);
      truncated ||= expanded.truncated;
      for (const reading of expanded.readings) {
        if (seen.has(reading.normalized)) continue;
        if (readings.length >= MAX_IMPRINT_READINGS_PER_SIDE) {
          truncated = true;
          break expansion;
        }
        seen.add(reading.normalized);
        readings.push(reading);
      }
    }
  }

  return {
    side,
    readings,
    summary: {
      observedCandidateCount: side.noImprintObserved ? 0 : side.imprintCandidates.length,
      serverExpansionCount: readings.filter((reading) => reading.origin === "server_confusion_expansion").length,
      totalReadingCount: readings.length,
      truncated,
    },
  };
}

function compareText(field: string, observed: string, official: string | null, partial = false): PillFeatureMatch {
  const normalizer = partial ? imprintText : normalize;
  const wanted = normalizer(observed);
  const actual = official === null ? null : normalizer(official);
  const match: Match = actual === null ? "unknown" : wanted === actual ? "exact"
    : partial && wanted.length >= 2 && actual.includes(wanted) ? "partial" : "mismatch";
  return { field, observed, official, match };
}

function compareScore(field: string, observed: PillScoreLine, official: PillScoreLine): PillFeatureMatch {
  // "other" does not mean two unrecognized line patterns are the same.
  const unknown = [observed, official].some((value) => value === "unknown" || value === "other");
  return { field, observed, official, match: unknown ? "unknown" : observed === official ? "exact" : "mismatch" };
}

function imprintEvidence(readings: PillImprintReadingEvidence[], actual: OfficialPillSide, label: string): PillFeatureMatch {
  const ranked = readings.map((reading) => ({
    ...compareText(`${label}.imprint`, reading.value, actual.imprint, true),
    imprintReading: reading,
  })).sort((a, b) => {
    const rank = (entry: PillFeatureMatch) => entry.match === "exact"
      ? entry.imprintReading?.origin === "observed_candidate" ? 0 : 1
      : entry.match === "partial" ? entry.imprintReading?.origin === "observed_candidate" ? 2 : 3
      : entry.match === "unknown" ? entry.imprintReading?.origin === "observed_candidate" ? 4 : 5
      : 6;
    return rank(a) - rank(b)
      || (a.imprintReading?.substitutions.length ?? 0) - (b.imprintReading?.substitutions.length ?? 0)
      || (a.imprintReading?.observedCandidateIndex ?? -1) - (b.imprintReading?.observedCandidateIndex ?? -1)
      || compare(a.imprintReading?.normalized ?? "", b.imprintReading?.normalized ?? "");
  });
  return ranked[0] ?? {
    field: `${label}.imprint`, observed: "unreadable", official: actual.imprint, match: "mismatch",
  };
}

function sideEvidence(observed: PreparedObservedSide, actual: OfficialPillSide, label: string, withScore: boolean): PillFeatureMatch[] {
  const imprint = imprintEvidence(observed.readings, actual, label);
  // A separate official logo is not evidence of an unmarked surface.
  if (observed.side.noImprintObserved && actual.mark) imprint.match = "mismatch";
  return [
    imprint,
    // Extracted letters are searchable, but the removed notation/mark was not compared.
    ...(actual.imprintHasDescription ? [{ field: `${label}.imprintDescription`, observed: "not_compared", official: actual.rawImprint, match: "unknown" as const }] : []),
    ...(actual.mark ? [{ field: `${label}.mark`, observed: "not_compared", official: actual.mark, match: "unknown" as const }] : []),
    ...(withScore ? [compareScore(`${label}.scoreLine`, observed.side.scoreLine, actual.scoreLine)] : []),
  ];
}

function matchingSides(prepared: { front: PreparedObservedSide; back: PreparedObservedSide }, item: OfficialPillItem, withScore: boolean) {
  return (["direct", "swapped"] as const).map((orientation) => ({
    orientation,
    evidence: [
      ...sideEvidence(prepared.front, orientation === "direct" ? item.front : item.back, "front", withScore),
      ...sideEvidence(prepared.back, orientation === "direct" ? item.back : item.front, "back", withScore),
    ],
  })).filter(({ evidence }) => evidence.filter((entry) => entry.field.endsWith(".imprint"))
    .every((entry) => entry.match !== "mismatch"));
}

function matchType(evidence: PillFeatureMatch[]): MatchType {
  return evidence.some((entry) => entry.match === "unknown" || entry.match === "mismatch") ? "incomplete"
    : evidence.some((entry) => entry.match === "partial") ? "partial" : "exact";
}

function imprintMatches(evidence: PillFeatureMatch[]) {
  // Matching two blank surfaces is not distinctive lettering evidence.
  return evidence.filter((entry) => entry.field.endsWith(".imprint") && entry.imprintReading?.normalized.length
    && (entry.match === "exact" || entry.match === "partial"));
}

function candidateGrade(evidence: PillFeatureMatch[], conflicts: PillFeatureMatch[], reviewReasons: PillReviewReason[]): PillCandidateGrade {
  const imprints = evidence.filter((entry) => entry.field.endsWith(".imprint"));
  const hasDistinctiveImprint = imprintMatches(evidence).length > 0;
  const exactObservedSurfaces = imprints.every((entry) => entry.match === "exact"
    && entry.imprintReading?.origin === "observed_candidate");
  return reviewReasons.length === 0 && conflicts.length === 0 && hasDistinctiveImprint
    && exactObservedSurfaces && matchType(evidence) === "exact" ? "strong" : "possible";
}

function compareVariantEvidence(a: PillCandidateVariant, b: PillCandidateVariant): number {
  const aImprints = imprintMatches(a.evidence);
  const bImprints = imprintMatches(b.evidence);
  const count = (entries: PillFeatureMatch[], match: Match, origin: PillImprintReadingOrigin) => entries
    .filter((entry) => entry.match === match && entry.imprintReading?.origin === origin).length;
  // Imprint evidence always outranks soft visual agreement. This is a deterministic grade, not a probability.
  return Number(a.reviewReasons.length > 0) - Number(b.reviewReasons.length > 0)
    || gradeOrder[a.grade] - gradeOrder[b.grade]
    || count(bImprints, "exact", "observed_candidate") - count(aImprints, "exact", "observed_candidate")
    || count(bImprints, "exact", "server_confusion_expansion") - count(aImprints, "exact", "server_confusion_expansion")
    || count(bImprints, "partial", "observed_candidate") - count(aImprints, "partial", "observed_candidate")
    || count(bImprints, "partial", "server_confusion_expansion") - count(aImprints, "partial", "server_confusion_expansion")
    || bImprints.length - aImprints.length
    || a.conflicts.length - b.conflicts.length
    || matchOrder[a.matchType] - matchOrder[b.matchType]
    || b.evidence.filter((entry) => !entry.field.endsWith(".imprint") && entry.match === "exact").length
      - a.evidence.filter((entry) => !entry.field.endsWith(".imprint") && entry.match === "exact").length;
}

function formEvidence(observed: PillObservation["form"], assessment: PillFormAssessment): PillFeatureMatch {
  if (assessment.status !== "supported") {
    return { field: "form", observed, official: null, match: "unknown" };
  }
  return compareText("form", observed, assessment.form);
}

function colorEvidence(observed: string[], item: OfficialPillItem): PillFeatureMatch {
  const wanted = [...new Set(observed.map(normalize))].sort();
  const actual = [...new Set(item.colors.map(normalize))].sort();
  const match: Match = wanted.length === 0 || actual.length === 0 ? "unknown"
    : !wanted.every((color) => actual.includes(color)) ? "mismatch"
    : actual.length === wanted.length ? "exact" : "partial";
  return { field: "colors", observed: wanted.join("/"), official: actual.length ? actual.join("/") : null, match };
}

function shapeEvidence(observed: string | null, item: OfficialPillItem): PillFeatureMatch {
  if (!observed || !item.shape || normalize(observed) === "기타" || normalize(item.shape) === "기타") {
    return { field: "shape", observed: observed ?? "unknown", official: item.shape, match: "unknown" };
  }
  return compareText("shape", observed, item.shape);
}

/** Pure candidate search: no image model, persistence, AI requests or medication activation. */
export function searchPillCandidates(input: unknown, catalog?: PillCatalog, options: { limit?: number } = {}): PillSearchResult {
  let imprintExpansion: PillImprintExpansionSummary | null = null;
  const metrics: PillSearchMetrics = {
    catalogRecords: 0, stages: [], candidateCount: 0, returnedCount: 0,
    heldCandidateCount: 0, heldReturnedCount: 0, matchedItemCount: 0, unsupportedCatalogRecords: 0,
  };
  const result = (status: PillSearchResult["status"], reason: string, message: string): PillSearchResult => ({
    status, reason, message, notice: NOTICE, candidates: [], heldCandidates: [], metrics,
    catalogVersion: catalog?.version ?? null, truncated: false, heldTruncated: false,
    observationSchemaVersion: PILL_OBSERVATION_SCHEMA_VERSION,
    imprintExpansionRulesVersion: PILL_IMPRINT_CONFUSION_RULES_VERSION,
    imprintExpansion,
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
  if (!observation.front || !observation.back
    || !observation.front.noImprintObserved && observation.front.imprintCandidates.length === 0
    || !observation.back.noImprintObserved && observation.back.imprintCandidates.length === 0) {
    return result("needs_retake", "missing_surface", "같은 약의 앞면과 뒷면 각인을 모두 확인해주세요. 글자가 없는 면도 직접 확인이 필요해요.");
  }
  if (observation.form === "unknown") return result("unidentified", "unknown_form", "온전한 정제·캡슐인지 확인하지 못했어요.");
  const prepared = {
    front: prepareObservedSide(observation.front),
    back: prepareObservedSide(observation.back),
  };
  imprintExpansion = { front: prepared.front.summary, back: prepared.back.summary };
  if (!catalog) return result("not_configured", "catalog_not_configured", "공식 낱알 카탈로그가 아직 연결되지 않았어요.");
  if (catalog.completeness !== "complete" || !catalog.version.trim() || catalog.totalCount !== catalog.items.length) return result("unavailable", "incomplete_catalog", "공식 데이터 수집이 완료되지 않아 후보 검색을 보류했어요.");

  metrics.catalogRecords = catalog.items.length;
  const assessed = catalog.items.map((item) => ({ item, formAssessment: classifyPillForm(item.formName) }));
  metrics.unsupportedCatalogRecords = assessed.filter((entry) => entry.formAssessment.status === "unsupported").length;
  const records = assessed.filter((entry) => entry.formAssessment.status !== "unsupported")
    .filter(({ item }) => matchingSides(prepared, item, false).length > 0);
  metrics.stages.push({ stage: "imprint", remaining: records.length });
  metrics.stages.push({ stage: "form", remaining: records.length });
  metrics.stages.push({ stage: "shape", remaining: records.length });
  metrics.stages.push({ stage: "color", remaining: records.length });
  const variants: PillCandidateVariant[] = [];
  for (const entry of records) {
    const visualEvidence = [
      formEvidence(observation.form, entry.formAssessment),
      shapeEvidence(observation.shape, entry.item),
      colorEvidence(observation.colors, entry.item),
    ];
    const choices = matchingSides(prepared, entry.item, true).map((choice) => {
      const evidence = [...visualEvidence, ...choice.evidence];
      const conflicts = evidence.filter((feature) => feature.match === "mismatch");
      const reviewReasons: PillReviewReason[] = [];
      if (entry.formAssessment.status !== "supported") reviewReasons.push("unknown_official_form");
      if (imprintMatches(evidence).length === 0) reviewReasons.push("no_imprint_evidence");
      return { item: entry.item, orientation: choice.orientation, matchType: matchType(evidence),
        grade: candidateGrade(evidence, conflicts, reviewReasons), evidence, conflicts,
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
    else destination.set(variant.item.itemSeq, {
      itemSeq: variant.item.itemSeq, matchType: variant.matchType, grade: variant.grade, variants: [variant],
    });
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
