// Search-time MVP eligibility, not dosing advice or a replacement for MFDS classification.
// Keep this policy separate from the immutable, hashed catalog's legacy coarse `form`.
export const PILL_FORM_POLICY_VERSION = "pill-form-policy-v1";

export type PillFormAssessment =
  | { status: "supported"; form: "tablet" | "capsule"; reason: "listed_tablet" | "listed_capsule" }
  | { status: "unsupported"; form: null; reason: "outside_mvp_form" | "empty_capsule" }
  | { status: "unknown"; form: null; reason: "missing_form_label" | "unreviewed_form_label" };

// Explicit official FORM_CODE_NAME labels observed in the catalog. Do not use endsWith("정")
// or includes("캡슐"): vaginal tablets/capsules must not become oral-pill candidates.
const TABLETS = new Set([
  "정제", "나정", "필름코팅정", "당의정", "다층정", "서방정", "서방성다층정",
  "서방성필름코팅정", "장용성필름코팅정", "구강붕해정", "추어블정(저작정)",
  "장용정", "서방성장용필름코팅정", "장용성당의정", "장용성필름코팅당의정",
  "설하정", "박칼정", "발포정", "분산정(현탁정)", "유핵정",
]);
const CAPSULES = new Set([
  "캡슐", "경질캡슐제", "연질캡슐제", "서방성캡슐제", "장용성캡슐제",
  "장용성필름코팅캡슐제", "젤라틴코팅성경질캡슐제",
]);
const CAPSULE_CONTENTS = new Set([
  "미분류", "산제", "과립제", "과립제정제", "정제", "서방성장용성펠렛",
  "장용성과립제", "펠렛", "액상", "현탁상",
]);
const UNSUPPORTED = new Set([
  "산제", "과립제", "액제", "시럽제", "구강붕해필름", "껌제",
  "흡입제", "정량흡입제", "정량분말분무제", "지지체가있는첩부제",
  "질정", "질연질캡슐제", "질좌제",
]);

/** Unknown labels remain on hold, even if the old normalizer inferred tablet/capsule. */
export function classifyPillForm(formName: string | null): PillFormAssessment {
  const label = formName?.normalize("NFKC").trim();
  if (!label) return { status: "unknown", form: null, reason: "missing_form_label" };
  const [primary, ...suffixes] = label.split(",").map((part) => part.trim());
  if (UNSUPPORTED.has(primary!)) return { status: "unsupported", form: null, reason: "outside_mvp_form" };
  if (CAPSULES.has(primary!) && suffixes.includes("공캡슐")) return { status: "unsupported", form: null, reason: "empty_capsule" };
  if (TABLETS.has(primary!) && (suffixes.length === 0 || suffixes.length === 1 && suffixes[0] === "미분류")) {
    return { status: "supported", form: "tablet", reason: "listed_tablet" };
  }
  // 산제/액상 here describes contents of an intact capsule, not loose powder/liquid.
  if (CAPSULES.has(primary!) && (suffixes.length === 0 || suffixes.length === 1 && CAPSULE_CONTENTS.has(suffixes[0]!))) {
    return { status: "supported", form: "capsule", reason: "listed_capsule" };
  }
  return { status: "unknown", form: null, reason: "unreviewed_form_label" };
}

export function summarizePillFormPolicy(items: Iterable<{ formName: string | null }>) {
  const counts = { tablet: 0, capsule: 0, unsupported: 0, unknown: 0 };
  const unsupported = new Map<string, number>();
  const unknown = new Map<string, number>();
  for (const item of items) {
    const assessment = classifyPillForm(item.formName);
    counts[assessment.status === "supported" ? assessment.form : assessment.status]++;
    if (assessment.status !== "supported") {
      const labels = assessment.status === "unsupported" ? unsupported : unknown;
      const label = item.formName ?? "(missing)";
      labels.set(label, (labels.get(label) ?? 0) + 1);
    }
  }
  return {
    version: PILL_FORM_POLICY_VERSION, counts,
    unsupportedForms: Object.fromEntries([...unsupported].sort()),
    unknownForms: Object.fromEntries([...unknown].sort()),
  };
}
