import type { PatientQuestionSet } from "@care-atlas/backend";
import type { useCheckInForm } from "./useCheckInForm";

export function DynamicQuestionFields({
  questionSet,
  compact = false,
  controls,
}: {
  questionSet: PatientQuestionSet;
  compact?: boolean;
  controls: Pick<ReturnType<typeof useCheckInForm>, "field" | "check">;
}) {
  return (
    <fieldset className={compact ? "quick-checkin__section" : "question-block"}>
      <legend>기록을 바탕으로 확인할 안부</legend>
      <input type="hidden" name="questionSetId" value={questionSet.question_set_id} />
      <p className="question-block__helper">
        {questionSet.generation_source === "agent"
          ? "Care Agent가 최근 기록을 살핀 뒤 안전한 질문 템플릿으로 골랐어요."
          : "에이전트 연결 전이라 최근 기록을 안전한 질문 템플릿에 반영했어요."}
      </p>
      <div className={compact ? "dynamic-questions dynamic-questions--compact" : "dynamic-questions"}>
        {questionSet.questions.map((question) => (
          <div className="dynamic-question" key={question.question_id}>
            <div className="dynamic-question__heading">
              <span>{question.display.badge}</span>
              <strong>{question.display.caregiver_text}</strong>
            </div>
            <p>{question.display.helper_text}</p>
            <div className={compact ? "dynamic-question__select" : "choice-grid"}>
              {compact ? (
                <select
                  aria-label={question.display.caregiver_text}
                  name={`question_${question.question_id}`}
                  {...controls.field(`question_${question.question_id}`)}
                  required={question.required}
                >
                  <option value="" disabled>
                    답변 선택
                  </option>
                  {question.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                question.options.map((option) => (
                  <label className="choice-card" key={option.value}>
                    <input
                      name={`question_${question.question_id}`}
                      type="radio"
                      value={option.value}
                      {...controls.check(`question_${question.question_id}`, option.value)}
                      required={question.required}
                    />
                    {option.label}
                  </label>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  );
}
