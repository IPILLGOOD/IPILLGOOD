import knowledge from "./data/nutrition-knowledge.json" with { type: "json" };

import type {
  CareSnapshot,
  ConfirmedCondition,
  NutritionInsight,
  NutritionInsightStatus,
  NutritionKnowledgeRule,
  NutritionSafetyMatch,
} from "./types.ts";

export const NUTRITION_CONDITIONS = [
  { id: "condition-hypertension", standardName: "고혈압", code: "I10", aliases: ["고혈압", "혈압 관리 중"] },
  { id: "condition-hyperlipidemia", standardName: "고지혈증", code: "E78", aliases: ["고지혈증", "이상지질혈증", "콜레스테롤 관리 중"] },
  { id: "condition-knee-osteoarthritis", standardName: "무릎 골관절염", code: "M17", aliases: ["무릎 골관절염", "퇴행성 무릎 관절염"] },
] as const;

const ingredientNames: Record<string, string> = {
  calcium: "칼슘", magnesium: "마그네슘", potassium: "칼륨",
  "omega-3": "오메가-3", ginkgo: "은행잎 추출물", glucosamine: "글루코사민",
};

const safetyEvidence = {
  title: "식약처 건강기능식품 의약품 병용 섭취정보",
  url: "https://data.mfds.go.kr/hid/opeaa01/drugUsjntIntkAttnMttrLst.do?menu_grp=MENU_NEW01&menu_no=5313",
  sourceVersion: "의약품 병용 섭취정보",
  evidenceLevel: "official_safety" as const,
  lastReviewedAt: "2026-08-29",
  reviewer: "IPILLGOOD MVP 콘텐츠 검토 · 전문가 검수 전",
};

const medicationSafetyRules = [
  {
    ingredientIds: ["potassium"],
    medicationPattern: /(리시노프릴|에날라프릴|라미프릴|캡토프릴|로사르탄|발사르탄|텔미사르탄|칸데사르탄|올메사르탄|스피로놀락톤|lisinopril|enalapril|ramipril|captopril|losartan|valsartan|telmisartan|candesartan|olmesartan|spironolactone)/i,
    severity: "avoid" as const,
    action: "현재 약은 칼륨에 영향을 줄 수 있어 칼륨 섭취를 의도적으로 크게 늘리거나 칼륨 대체소금을 쓰기 전에 의료진에게 확인해야 해요.",
  },
  {
    ingredientIds: ["omega-3", "ginkgo", "glucosamine"],
    medicationPattern: /(와파린|아픽사반|리바록사반|다비가트란|클로피도그렐|아스피린|warfarin|apixaban|rivaroxaban|dabigatran|clopidogrel|aspirin)/i,
    severity: "professional_confirmation" as const,
    action: "출혈에 영향을 줄 수 있는 약과 함께 먹기 전 의료진이나 약사에게 원료명을 알려주세요.",
  },
] as const;

const statusPriority: Record<NutritionInsightStatus, number> = {
  consider: 0,
  caution: 1,
  professional_confirmation: 2,
  avoid: 3,
};

function ingredientName(id: string) {
  return ingredientNames[id] ?? id;
}

export function conditionFromDiagnosis(
  diagnosis: { name: string; code?: string },
  source: { documentId?: string; sourceLabel: string; confirmedAt?: string },
): ConfirmedCondition | null {
  const normalizedCode = (diagnosis.code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const normalizedName = diagnosis.name.normalize("NFKC").replace(/\s/g, "");
  const option = NUTRITION_CONDITIONS.find((condition) =>
    normalizedCode.startsWith(condition.code) ||
    condition.aliases.some((alias) => normalizedName.includes(alias.replace(/\s/g, ""))),
  );
  if (!diagnosis.name.trim()) return null;
  return {
    id: option?.id ?? `condition-${normalizedCode || normalizedName.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-")}`,
    standardName: option?.standardName ?? diagnosis.name.trim(),
    code: option?.code ?? diagnosis.code?.trim() ?? "코드 미기재",
    ...(source.documentId ? { sourceDocumentId: source.documentId } : {}),
    sourceLabel: source.sourceLabel,
    confirmedAt: source.confirmedAt ?? new Date().toISOString(),
  };
}

function safetyMatches(snapshot: CareSnapshot, rule: NutritionKnowledgeRule): NutritionSafetyMatch[] {
  return medicationSafetyRules.flatMap((safetyRule) => {
    const ingredientIds = rule.relatedSupplementIngredientIds.filter((id) => safetyRule.ingredientIds.includes(id as never));
    if (ingredientIds.length === 0) return [];
    const medications = snapshot.medications.filter((medication) =>
      medication.status === "active" && safetyRule.medicationPattern.test(`${medication.productName} ${medication.ingredientName}`),
    );
    if (medications.length === 0) return [];
    return ingredientIds.map((id) => ({
      ingredientId: id,
      ingredientName: ingredientName(id),
      severity: safetyRule.severity,
      medicationPlanIds: medications.map((medication) => medication.id),
      medicationNames: medications.map((medication) => medication.productName),
      action: safetyRule.action,
      evidence: safetyEvidence,
    }));
  });
}

export function buildNutritionInsights(snapshot: CareSnapshot): NutritionInsight[] {
  const confirmed = snapshot.recipient.confirmedConditions ?? [];
  if (confirmed.length === 0) return [];
  const activeSupplements = (snapshot.recipient.supplementIntakes ?? []).filter((item) => item.status === "active");
  const rules = knowledge.rules as NutritionKnowledgeRule[];

  return rules.flatMap((rule): NutritionInsight[] => {
    const triggerConditions = confirmed.filter((condition) => rule.conditionIds.includes(condition.id));
    if (triggerConditions.length === 0) return [];
    const matches = safetyMatches(snapshot, rule);
    const status = matches.reduce<NutritionInsightStatus>(
      (current, match) => statusPriority[match.severity] > statusPriority[current] ? match.severity : current,
      rule.defaultStatus,
    );
    const evidence = [...rule.evidence, ...matches.map((match) => match.evidence)]
      .filter((item, index, items) => items.findIndex((candidate) => candidate.url === item.url) === index);
    const relatedIds = new Set(rule.relatedSupplementIngredientIds);
    const currentSupplementNames = activeSupplements
      .filter((item) => relatedIds.has(item.ingredientId))
      .map((item) => item.ingredientName);
    const matchedMedicationIds = [...new Set(matches.flatMap((match) => match.medicationPlanIds))];
    const matchedMedicationNames = [...new Set(matches.flatMap((match) => match.medicationNames))];
    const safetyAction = matches[0]?.action;
    return [{
      id: rule.id,
      kind: rule.kind,
      status,
      title: rule.title,
      source: "curated",
      nutrientName: rule.title,
      summary: safetyAction ? `${rule.summary} ${safetyAction}` : rule.summary,
      supplementGuidance: rule.kind === "safety" ? (safetyAction ?? rule.summary) : "식품으로 먼저 섭취하고, 보충제 형태는 검사 결과와 복용약을 아는 전문가에게 확인하세요.",
      foodExamples: rule.foodExamples,
      triggerConditions,
      relatedSupplementIngredientIds: rule.relatedSupplementIngredientIds,
      matchedMedicationIds,
      matchedMedicationNames,
      currentSupplementNames,
      professionalQuestion: rule.professionalQuestion,
      evidence,
      lastReviewedAt: evidence.map((item) => item.lastReviewedAt).sort().at(-1) ?? "",
    }];
  }).sort((a, b) => statusPriority[b.status] - statusPriority[a.status] || (a.kind === "food" ? -1 : 1));
}
