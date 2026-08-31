import { z } from "zod";
import type { OfficialPillItem, OfficialPillSide, PillScoreLine } from "./official-pill-catalog.ts";
import { stableJson } from "./stable-json.ts";

const sideSchema = z.object({
  // null = unreadable/unknown; "" = the observer explicitly saw no text.
  imprint: z.string().trim().max(80).nullable(),
  scoreLine: z.enum(["none", "single", "cross", "other", "unknown"]),
}).strict();

export const pillObservationSchema = z.object({
  source: z.enum(["manual", "image_features"]),
  form: z.enum(["tablet", "capsule", "powder", "granule", "liquid", "other", "unknown"]),
  integrity: z.enum(["intact", "split", "damaged", "unknown"]),
  count: z.number().int().min(0).max(100),
  overlapping: z.boolean(),
  quality: z.enum(["clear", "blurred", "dark", "too_small", "unknown"]),
  shape: z.string().trim().min(1).max(40).nullable(),
  colors: z.array(z.string().trim().min(1).max(20)).max(4),
  front: sideSchema.nullable(),
  back: sideSchema.nullable(),
}).strict();

export type PillObservation = z.infer<typeof pillObservationSchema>;
export interface PillCatalog {
  items: OfficialPillItem[];
  totalCount: number;
  completeness: "complete" | "partial";
  version: string;
}
type Match = "exact" | "partial" | "unknown" | "mismatch";
type MatchType = "exact" | "partial" | "incomplete";
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
}
export interface PillCandidate {
  itemSeq: string;
  matchType: MatchType;
  variants: PillCandidateVariant[];
}
export interface PillSearchMetrics {
  catalogRecords: number;
  stages: Array<{ stage: "form" | "color" | "shape" | "imprint" | "score_line"; remaining: number }>;
  candidateCount: number;
  returnedCount: number;
}
export interface PillSearchResult {
  status: "candidates_found" | "needs_retake" | "unsupported_form" | "unidentified" | "not_configured" | "unavailable" | "invalid_input";
  reason: string;
  message: string;
  notice: string;
  candidates: PillCandidate[];
  metrics: PillSearchMetrics;
  catalogVersion: string | null;
  truncated: boolean;
}

const NOTICE = "공식 데이터와 외형을 비교한 후보이며 약의 확정이나 복용 가능 여부를 뜻하지 않아요. 원본 약 봉투·처방전·약사 안내와 함께 확인해주세요.";
const matchOrder: Record<MatchType, number> = { exact: 0, partial: 1, incomplete: 2 };
const normalize = (text: string) => text.normalize("NFKC").trim().toUpperCase();
const imprintText = (text: string) => normalize(text).replace(/\s+/g, "");
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

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
  const imprint = compareText(`${label}.imprint`, observed.imprint!, actual.imprint, true);
  // A separate official logo is not evidence of an unmarked surface.
  if (observed.imprint === "" && actual.mark) imprint.match = "mismatch";
  return [imprint, ...(withScore ? [compareScore(`${label}.scoreLine`, observed.scoreLine, actual.scoreLine)] : [])];
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

/** Pure candidate search: no image model, persistence, AI requests or medication activation. */
export function searchPillCandidates(input: unknown, catalog?: PillCatalog, options: { limit?: number } = {}): PillSearchResult {
  const metrics: PillSearchMetrics = { catalogRecords: 0, stages: [], candidateCount: 0, returnedCount: 0 };
  const result = (status: PillSearchResult["status"], reason: string, message: string): PillSearchResult => ({
    status, reason, message, notice: NOTICE, candidates: [], metrics, catalogVersion: catalog?.version ?? null, truncated: false,
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
  if (!observation.front || !observation.back || observation.front.imprint === null || observation.back.imprint === null) return result("needs_retake", "missing_surface", "같은 약의 앞면과 뒷면 각인을 모두 확인해주세요. 글자가 없는 면도 직접 확인이 필요해요.");
  if (!observation.shape || observation.colors.length === 0) return result("needs_retake", "missing_features", "모양과 색상을 확인할 수 있도록 다시 관찰하거나 촬영해주세요.");
  if (observation.form === "unknown") return result("unidentified", "unknown_form", "온전한 정제·캡슐인지 확인하지 못했어요.");
  if (!catalog) return result("not_configured", "catalog_not_configured", "공식 낱알 카탈로그가 아직 연결되지 않았어요.");
  if (catalog.completeness !== "complete" || !catalog.version.trim() || catalog.totalCount !== catalog.items.length) return result("unavailable", "incomplete_catalog", "공식 데이터 수집이 완료되지 않아 후보 검색을 보류했어요.");

  metrics.catalogRecords = catalog.items.length;
  let records = catalog.items.map((item) => ({ item, evidence: [] as PillFeatureMatch[] }));
  const filter = (stage: PillSearchMetrics["stages"][number]["stage"], evidence: (item: OfficialPillItem) => PillFeatureMatch) => {
    records = records.map((entry) => ({ ...entry, evidence: [...entry.evidence, evidence(entry.item)] }))
      .filter((entry) => entry.evidence.every((feature) => feature.match !== "mismatch"));
    metrics.stages.push({ stage, remaining: records.length });
  };
  filter("form", (item) => compareText("form", observation.form, item.form === "unknown" ? null : item.form));
  filter("color", (item) => {
    const wanted = [...new Set(observation.colors.map(normalize))].sort();
    const actual = [...new Set(item.colors.map(normalize))].sort();
    const match: Match = actual.length === 0 ? "unknown" : !wanted.every((color) => actual.includes(color)) ? "mismatch"
      : actual.length === wanted.length ? "exact" : "partial";
    return { field: "colors", observed: wanted.join("/"), official: actual.length ? actual.join("/") : null, match };
  });
  filter("shape", (item) => compareText("shape", observation.shape!, item.shape));
  records = records.filter(({ item }) => matchingSides(observation, item, false).length > 0);
  metrics.stages.push({ stage: "imprint", remaining: records.length });
  const variants: PillCandidateVariant[] = [];
  for (const entry of records) {
    const choices = matchingSides(observation, entry.item, true).map((choice) => {
      const evidence = [...entry.evidence, ...choice.evidence];
      return { item: entry.item, orientation: choice.orientation, matchType: matchType(evidence), evidence };
    }).filter((choice) => choice.evidence.some((feature) => feature.match === "exact" || feature.match === "partial"))
      .sort((a, b) => matchOrder[a.matchType] - matchOrder[b.matchType]);
    if (choices[0]) variants.push(choices[0]);
  }
  metrics.stages.push({ stage: "score_line", remaining: variants.length });
  // Stable code/record tie-breaks, not a fabricated probability or a clinical confidence score.
  variants.sort((a, b) => matchOrder[a.matchType] - matchOrder[b.matchType] || compare(a.item.itemSeq, b.item.itemSeq) || compare(stableJson(a.item), stableJson(b.item)));
  const grouped = new Map<string, PillCandidate>();
  for (const variant of variants) {
    const candidate = grouped.get(variant.item.itemSeq);
    if (candidate) candidate.variants.push(variant);
    else grouped.set(variant.item.itemSeq, { itemSeq: variant.item.itemSeq, matchType: variant.matchType, variants: [variant] });
  }
  metrics.candidateCount = grouped.size;
  const candidates = [...grouped.values()].slice(0, limit);
  metrics.returnedCount = candidates.length;
  if (!candidates.length) return result("unidentified", "no_candidates", "입력한 특징에 맞는 공식 후보가 없어요. 약 이름을 추측하지 않으니 약 봉투와 약사 안내로 확인해주세요.");
  return {
    ...result("candidates_found", "comparison_required", "외형이 일치하거나 추가 확인이 필요한 후보예요. 공식 이미지와 각인을 비교해주세요."),
    candidates, truncated: metrics.candidateCount > candidates.length,
  };
}
