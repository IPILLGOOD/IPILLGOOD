import { randomUUID } from "node:crypto";

import type { PatientQuestionResponse, PatientQuestionSet } from "../../types.ts";

export function buildPatientQuestionResponse(input: {
  questionSet: PatientQuestionSet;
  answeredBy: "caregiver" | "recipient";
  answers: Record<string, string | number | string[] | null | undefined>;
}): PatientQuestionResponse {
  const responses = input.questionSet.questions.map((question) => {
    const answer = input.answers[question.question_id] ?? null;
    const skipped =
      answer === null ||
      answer === "" ||
      (Array.isArray(answer) && answer.length === 0);
    if (question.required && skipped) {
      throw new Error("맞춤 안부 질문에 모두 답해주세요.");
    }
    if (!skipped && question.options.length > 0) {
      const allowedValues = new Set(question.options.map((option) => option.value));
      const values = Array.isArray(answer) ? answer : [String(answer)];
      if (values.some((value) => !allowedValues.has(value))) {
        throw new Error("맞춤 안부 질문의 답변 값이 올바르지 않습니다.");
      }
    }
    return { question_id: question.question_id, answer, skipped };
  });
  const triggeredByResponse = responses.flatMap((response) => {
    const question = input.questionSet.questions.find(
      (candidate) => candidate.question_id === response.question_id,
    );
    if (!question || response.skipped || Array.isArray(response.answer)) return [];
    const answerValue = String(response.answer);
    if (!question.safety.urgent_answer_values.includes(answerValue)) return [];
    return [
      {
        question_id: response.question_id,
        answer_value: answerValue,
        action: "show_urgent_guidance" as const,
      },
    ];
  });
  return {
    schema_version: "patient-question-response.v1",
    response_id: `question-response-${input.questionSet.target_date}-${randomUUID()}`,
    question_set_id: input.questionSet.question_set_id,
    subject_ref: input.questionSet.subject_ref,
    answered_by: input.answeredBy,
    answered_at: new Date().toISOString(),
    timezone: "Asia/Seoul",
    responses,
    triggered_by_response: triggeredByResponse,
    source_refs: [
      {
        source_type: "patient_question_set",
        source_id: input.questionSet.question_set_id,
      },
    ],
  };
}
