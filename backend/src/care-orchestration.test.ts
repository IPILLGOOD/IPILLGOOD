import assert from "node:assert/strict";
import test from "node:test";

import { careInputRevision, runCareAgent } from "./ai/care-agent.ts";
import {
  buildPatientQuestionSet,
  questionSetIdFor,
} from "./ai/questions/generate-question-set.ts";
import { buildPatientQuestionResponse } from "./ai/questions/apply-question-response.ts";
import type { CareAgentOutput, CareSnapshot } from "./types.ts";

const snapshot: CareSnapshot = {
  recipient: {
    id: "recipient-1",
    displayName: "테스트 대상자",
    ageBand: "70대",
    allergies: [],
    conditions: [],
    mobilityNote: "",
    accessibilityPreferences: [],
    caregiverNote: "",
    consentConfirmed: true,
    lastConfirmedAt: "2026-08-15T00:00:00+09:00",
  },
  medications: [
    {
      id: "med-1",
      productName: "테스트정",
      ingredientName: "테스트성분",
      purposePlain: "",
      descriptionPlain: "",
      doseAmount: "1정",
      frequency: "하루 1회",
      timing: "아침",
      startDate: "2026-08-12",
      status: "active",
      isNew: true,
      sourceLabel: "테스트",
      watchFor: [],
    },
  ],
  doseEvents: [
    {
      id: "dose-1",
      medicationPlanId: "med-1",
      scheduledAt: "2026-08-15T08:00:00+09:00",
      response: "unconfirmed",
      answeredBy: "caregiver",
    },
  ],
  symptomEvents: [
    {
      id: "symptom-1",
      symptomType: "어지러움",
      occurredAt: "2026-08-15T10:00:00+09:00",
      severity: 3,
      dailyLifeImpact: "잠시 쉬었어요.",
      reporterType: "caregiver_observed",
    },
  ],
  documents: [],
  clinicianQuestions: [],
  dataSource: "local-fallback",
};

const analysis: CareAgentOutput = {
  schema_version: "care-agent.v1",
  analysis_id: "analysis-1",
  generated_at: "2026-08-16T08:00:00+09:00",
  timezone: "Asia/Seoul",
  status: "completed",
  findings: [
    {
      finding_id: "finding-1",
      type: "symptom_repeated",
      summary: "최근 어지러움 기록이 있어요.",
      symptom_type: "어지러움",
      medication_plan_id: "",
      event_refs: ["symptom-1"],
    },
    {
      finding_id: "finding-2",
      type: "medication_unconfirmed",
      summary: "복용 확인이 필요해요.",
      symptom_type: "",
      medication_plan_id: "med-1",
      event_refs: ["dose-1"],
    },
  ],
  missing_data: [],
  urgency: "unknown",
  source_refs: [
    { source_type: "symptom_event", source_id: "symptom-1" },
    { source_type: "dose_event", source_id: "dose-1" },
  ],
};

test("같은 날짜와 입력 리비전은 같은 질문 세트 ID를 만든다", () => {
  const revision = careInputRevision(snapshot, "2026-08-16");
  const input = {
    recipientId: snapshot.recipient.id,
    targetDate: "2026-08-16",
    answerer: "caregiver" as const,
    inputRevision: revision,
  };
  assert.equal(questionSetIdFor(input), questionSetIdFor(input));
});

test("Care Agent finding을 승인된 질문 템플릿 최대 3개로 변환한다", () => {
  const questionSet = buildPatientQuestionSet({
    snapshot,
    analysis,
    targetDate: "2026-08-16",
    answerer: "caregiver",
    inputRevision: careInputRevision(snapshot, "2026-08-16"),
    source: "agent",
  });

  assert.equal(questionSet.schema_version, "patient-question-set.v1");
  assert.ok(questionSet.questions.length <= 3);
  assert.ok(questionSet.questions.some((question) => question.display.caregiver_text.includes("어지러움")));
  assert.ok(questionSet.questions.every((question) => question.safety.validation_status === "pass"));
  assert.equal(questionSet.response_status, "unanswered");
});

test("질문 응답은 질문 정의와 분리된 response 문서로 만든다", () => {
  const questionSet = buildPatientQuestionSet({
    snapshot,
    analysis,
    targetDate: "2026-08-16",
    answerer: "caregiver",
    inputRevision: careInputRevision(snapshot, "2026-08-16"),
    source: "agent",
  });
  const answers = Object.fromEntries(
    questionSet.questions.map((question) => [question.question_id, question.options[0]?.value]),
  );
  const response = buildPatientQuestionResponse({
    questionSet,
    answeredBy: "caregiver",
    answers,
  });

  assert.equal(response.question_set_id, questionSet.question_set_id);
  assert.equal(response.responses.length, questionSet.questions.length);
  assert.ok(response.responses.every((item) => item.skipped === false));
});

test("허용되지 않은 맞춤 질문 답변은 거부한다", () => {
  const questionSet = buildPatientQuestionSet({
    snapshot,
    analysis,
    targetDate: "2026-08-16",
    answerer: "caregiver",
    inputRevision: careInputRevision(snapshot, "2026-08-16"),
    source: "agent",
  });
  assert.throws(
    () =>
      buildPatientQuestionResponse({
        questionSet,
        answeredBy: "caregiver",
        answers: Object.fromEntries(
          questionSet.questions.map((question) => [question.question_id, "tampered-value"]),
        ),
      }),
    /답변 값/,
  );
});

test("OpenAI 미설정 시에도 기록에서 안전 폴백 분석을 만든다", async () => {
  const result = await runCareAgent({
    snapshot,
    targetDate: "2026-08-16",
    apiKey: "",
  });
  assert.equal(result.source, "safe_fallback");
  assert.equal(result.run.status, "not_configured");
  assert.ok(result.output.findings.some((finding) => finding.event_refs.includes("symptom-1")));
});
