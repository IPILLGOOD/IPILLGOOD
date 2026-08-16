import { createHash } from "node:crypto";

import type {
  CareAgentOutput,
  CareSnapshot,
  PatientQuestion,
  PatientQuestionSet,
} from "../../types.ts";
import { CARE_AGENT_PROMPT_VERSION } from "../care-agent.ts";

const yesNoUnknown = [
  { value: "yes", label: "네" },
  { value: "no", label: "아니요" },
  { value: "unknown", label: "확인하지 못했어요" },
];

function questionId(questionSetId: string, templateId: string, triggerRef: string) {
  return `q-${createHash("sha256")
    .update(`${questionSetId}:${templateId}:${triggerRef}`)
    .digest("hex")
    .slice(0, 16)}`;
}

function baseQuestion(input: {
  questionSetId: string;
  templateId: string;
  category: string;
  priority: PatientQuestion["priority"];
  triggerRefs: string[];
  badge: string;
  caregiverText: string;
  recipientText: string;
  helperText: string;
  options: PatientQuestion["options"];
  allowUnknown?: boolean;
}): PatientQuestion {
  return {
    question_id: questionId(
      input.questionSetId,
      input.templateId,
      input.triggerRefs[0] ?? "general",
    ),
    template_id: input.templateId,
    category: input.category,
    priority: input.priority,
    source_agents: ["care", "safety"],
    trigger_refs: input.triggerRefs,
    display: {
      badge: input.badge,
      caregiver_text: input.caregiverText,
      recipient_text: input.recipientText,
      helper_text: input.helperText,
    },
    answer_type: "single_choice",
    options: input.options,
    options_source: null,
    required: true,
    allow_unknown: input.allowUnknown ?? true,
    follow_up_rules: [],
    safety: { validation_status: "pass", urgent_answer_values: [] },
  };
}

export function buildPatientQuestionSet(input: {
  snapshot: CareSnapshot;
  analysis: CareAgentOutput;
  targetDate: string;
  answerer: "caregiver" | "recipient";
  inputRevision: string;
  source: "agent" | "safe_fallback";
}): PatientQuestionSet {
  const questionSetId = questionSetIdFor({
    recipientId: input.snapshot.recipient.id,
    targetDate: input.targetDate,
    answerer: input.answerer,
    inputRevision: input.inputRevision,
  });
  const medications = new Map(
    input.snapshot.medications.map((medication) => [medication.id, medication]),
  );
  const questions: PatientQuestion[] = [];
  const usedTemplates = new Set<string>();

  for (const finding of input.analysis.findings) {
    if (questions.length >= 3) break;
    if (
      [
        "symptom_onset",
        "symptom_persistence",
        "symptom_repeated",
        "symptom_worsening",
      ].includes(finding.type) &&
      finding.symptom_type &&
      !usedTemplates.has(`symptom:${finding.symptom_type}`)
    ) {
      const templateKey = `symptom:${finding.symptom_type}`;
      usedTemplates.add(templateKey);
      questions.push(
        baseQuestion({
          questionSetId,
          templateId: "recent-symptom-follow-up.v1",
          category: "symptom_follow_up",
          priority: finding.type === "symptom_worsening" ? "high" : "normal",
          triggerRefs: finding.event_refs,
          badge: "최근 기록",
          caregiverText: `최근 기록된 ${finding.symptom_type}이 오늘도 있었나요?`,
          recipientText: `오늘도 ${finding.symptom_type}이 있었나요?`,
          helperText: "시간적으로 이어진 기록을 확인하는 질문이며 약이 원인이라는 뜻은 아니에요.",
          options: [
            { value: "present", label: "오늘도 있었어요" },
            { value: "absent", label: "오늘은 없었어요" },
            { value: "unknown", label: "확인하지 못했어요" },
          ],
        }),
      );
      continue;
    }

    if (
      (finding.type === "medication_missed" || finding.type === "medication_unconfirmed") &&
      finding.medication_plan_id &&
      !usedTemplates.has(`dose:${finding.medication_plan_id}`)
    ) {
      const medication = medications.get(finding.medication_plan_id);
      if (!medication) continue;
      usedTemplates.add(`dose:${finding.medication_plan_id}`);
      questions.push(
        baseQuestion({
          questionSetId,
          templateId: "recent-dose-barrier.v1",
          category: "medication_follow_up",
          priority: "high",
          triggerRefs: finding.event_refs,
          badge: "복약 확인",
          caregiverText: `${medication.productName}을 챙기기 어려운 점이 오늘도 있었나요?`,
          recipientText: `${medication.productName}을 챙기기 어려운 점이 오늘도 있었나요?`,
          helperText: "답변이 처방이나 복약 계획을 자동으로 바꾸지는 않아요.",
          options: yesNoUnknown,
        }),
      );
    }
  }

  if (questions.length < 3) {
    const newMedication = input.snapshot.medications.find(
      (medication) => medication.status === "active" && medication.isNew,
    );
    if (newMedication) {
      questions.push(
        baseQuestion({
          questionSetId,
          templateId: "new-medication-change.v1",
          category: "medication_observation",
          priority: "normal",
          triggerRefs: [newMedication.id],
          badge: "새 복용약",
          caregiverText: `${newMedication.productName}을 시작한 뒤 평소와 다른 불편함이 있었나요?`,
          recipientText: `${newMedication.productName}을 시작한 뒤 평소와 다른 불편함이 있었나요?`,
          helperText: "있었다고 답해도 그 약이 원인이라는 뜻은 아니며, 변화 기록에만 연결해요.",
          options: yesNoUnknown,
        }),
      );
    }
  }

  if (questions.length < 3) {
    questions.push(
      baseQuestion({
        questionSetId,
        templateId: "daily-condition-comparison.v1",
        category: "daily_condition",
        priority: "normal",
        triggerRefs: [input.snapshot.recipient.id],
        badge: "오늘의 변화",
        caregiverText: "평소와 비교해 오늘 전반적인 몸 상태는 어땠나요?",
        recipientText: "평소와 비교해 오늘 몸 상태는 어땠나요?",
        helperText: "좋고 나쁨을 판단하기보다 평소와 다른 변화를 기록해요.",
        options: [
          { value: "better", label: "평소보다 나았어요" },
          { value: "same", label: "평소와 비슷했어요" },
          { value: "worse", label: "평소보다 불편했어요" },
          { value: "unknown", label: "확인하지 못했어요" },
        ],
      }),
    );
  }

  return {
    schema_version: "patient-question-set.v1",
    question_set_id: questionSetId,
    generated_at: new Date().toISOString(),
    timezone: "Asia/Seoul",
    target_date: input.targetDate,
    subject_ref: input.snapshot.recipient.id,
    answerer: input.answerer,
    status: input.analysis.urgency === "emergency" ? "urgent" : "ready",
    maximum_display_count: 3,
    questions: questions.slice(0, 3),
    source_analysis_refs: [input.analysis.analysis_id],
    safety_validation_ref: "patient-question-safety.v1",
    input_revision: input.inputRevision,
    prompt_version: CARE_AGENT_PROMPT_VERSION,
    generation_source: input.source,
    response_status: "unanswered",
    answered_at: null,
  };
}

export function questionSetIdFor(input: {
  recipientId: string;
  targetDate: string;
  answerer: "caregiver" | "recipient";
  inputRevision: string;
}) {
  const digest = createHash("sha256")
    .update(
      [
        input.recipientId,
        input.targetDate,
        input.answerer,
        input.inputRevision,
        CARE_AGENT_PROMPT_VERSION,
      ].join(":"),
    )
    .digest("hex")
    .slice(0, 16);
  return `question-set-${input.targetDate}-${digest}`;
}
