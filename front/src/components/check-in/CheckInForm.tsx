"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useCheckInForm } from "./useCheckInForm";
import { QuestionRecovery } from "./QuestionRecovery";
import { DynamicQuestionFields } from "@/components/check-in/DynamicQuestionFields";
import { FormMessage } from "@/components/ui/FormMessage";
import { SubmitButton } from "@/components/ui/SubmitButton";
import type { MedicationScheduleTask } from "@/lib/presentation";
import type { DailyCheckIn, PatientQuestionResponse, PatientQuestionSet } from "@care-atlas/backend";
const doseOptions = [
  { value: "completed", label: "모두 먹었어요" },
  { value: "partial", label: "일부만 먹었어요" },
  { value: "not_yet", label: "아직 안 먹었어요" },
  { value: "skipped", label: "먹지 못했어요" },
  { value: "unconfirmed", label: "확인하지 못했어요" },
];
const symptoms = ["어지러움", "두통", "졸림", "속 불편함", "휘청거림"];

export function CheckInForm({
  tasks,
  questionSet: initialQuestions,
  initialCheckIn,
  initialQuestionResponse,
  revision,
}: {
  tasks: MedicationScheduleTask[];
  questionSet: PatientQuestionSet | null;
  initialCheckIn: DailyCheckIn | null;
  initialQuestionResponse: PatientQuestionResponse | null;
  revision: number;
}) {
  const router = useRouter();
  const initialDraft = {
    ...(initialCheckIn
      ? {
          answeredBy: [initialCheckIn.completedBy],
          symptoms: initialCheckIn.symptoms,
          severity: [String(initialCheckIn.severity ?? 3)],
          note: [initialCheckIn.note],
        }
      : {}),
    ...Object.fromEntries(
      (initialQuestionResponse?.responses ?? []).map((response) => [
        `question_${response.question_id}`,
        Array.isArray(response.answer)
          ? response.answer.map(String)
          : response.answer === null
            ? []
            : [String(response.answer)],
      ]),
    ),
  };
  const form = useCheckInForm(initialQuestions, revision, initialDraft);
  const { state, formAction, questionSet } = form;
  useEffect(() => { if (state.conflict) router.refresh(); }, [router, state.conflict]);
  const recovery = <QuestionRecovery unavailable={!questionSet} pending={form.pending} message={form.recoveryMessage} onRetry={form.recover} />;
  if (!questionSet) return recovery;

  if (state.status === "success") {
    return (
      <div>
        <FormMessage state={state} />
        <div className="completion-panel">
          <h2>답변이 돌봄 기록에 반영됐어요</h2>
          <p>
            오늘의 답변은 약의 처방 내용을 바꾸지 않아요. 대시보드와 상담용 기록에서 시간에
            따른 변화를 확인할 수 있어요.
          </p>
          <div className="form-actions">
            <Link className="button button--secondary" href="/report">
              상담용 기록 보기
            </Link>
            <Link className="button button--primary" href="/today">
              오늘 화면으로 돌아가기
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form className="checkin-form" action={formAction} onReset={(event) => event.preventDefault()} aria-label="오늘의 복약과 안부 기록">
      <input type="hidden" name="expectedRevision" value={form.baselineRevision} />
      {!form.recoveryMessage && <FormMessage state={state} />}
      {state.conflict ? (
        <button className="button button--secondary" type="button" disabled={!form.latestRevisionReady} onClick={form.acceptLatestRevision}>
          {form.latestRevisionReady ? "최신 내용 확인 후 다시 저장" : "최신 내용 불러오는 중…"}
        </button>
      ) : null}
      {(state.recoverQuestions || form.recoveryMessage) && recovery}

      <fieldset className="question-block">
        <legend>1. 누가 오늘의 상태를 확인했나요?</legend>
        <div className="choice-grid">
          <label className="choice-card">
            <input name="answeredBy" type="radio" value="caregiver" {...form.check("answeredBy", "caregiver", !initialCheckIn)} required />
            보호자가 확인했어요
          </label>
          <label className="choice-card">
            <input name="answeredBy" type="radio" value="recipient" {...form.check("answeredBy", "recipient", initialCheckIn?.completedBy === "recipient")} required />
            어르신이 직접 답했어요
          </label>
        </div>
      </fieldset>

      {tasks.map((task, index) => (
        <fieldset className="question-block dose-question" key={task.id}>
          <legend>
            {index + 2}. {task.slotLabel}의 {task.productName}은 챙기셨나요?
          </legend>
          <div className="dose-question__meta">
            <span>{task.timeLabel}</span>
            <span>{task.doseAmount}</span>
            <span>{task.frequency}</span>
          </div>
          <div className="dose-choice-grid">
            {doseOptions.map((option) => (
              <label className="choice-card" key={option.value}>
                <input
                  name={`dose_${task.id}`}
                  type="radio"
                  value={option.value}
                  {...form.check(
                    `dose_${task.id}`,
                    option.value,
                    task.hasRecordedResponse && option.value === task.response,
                  )}
                  required
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      <fieldset className="question-block">
        <legend>{tasks.length + 2}. 오늘 평소와 다른 몸 상태가 있었나요?</legend>
        <p className="question-block__helper">없으면 선택하지 않아도 괜찮아요.</p>
        <div className="choice-grid">
          {symptoms.map((symptom) => (
            <label className="choice-card" key={symptom}>
              <input name="symptoms" type="checkbox" value={symptom} {...form.check("symptoms", symptom, initialCheckIn?.symptoms.includes(symptom) ?? false)} />
              {symptom}
            </label>
          ))}
        </div>
      </fieldset>

      <DynamicQuestionFields questionSet={questionSet} controls={form} />

      <div className="form-grid form-grid--check-in-details">
        <div className="field">
          <label htmlFor="severity">불편한 정도</label>
          <select id="severity" name="severity" {...form.field("severity", String(initialCheckIn?.severity || 3))}>
            <option value="1">1 — 아주 조금</option>
            <option value="3">3 — 조금 불편함</option>
            <option value="5">5 — 일상에 영향이 있음</option>
            <option value="7">7 — 많이 불편함</option>
            <option value="10">10 — 견디기 매우 어려움</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="note">보호자 메모</label>
          <textarea
            id="note"
            name="note"
            {...form.field("note", initialCheckIn?.note ?? "")}
            maxLength={500}
            placeholder="예: 걸을 때 잠시 벽을 짚었고, 10분 정도 쉬었어요."
          />
          <p className="field-hint">진단보다 직접 보거나 들은 사실을 적어주세요.</p>
        </div>
      </div>

      <div className="form-actions">
        <Link className="button button--quiet" href="/today">
          나중에 하기
        </Link>
        <SubmitButton disabled={form.pending} pendingText="기록하는 중…">
          {initialCheckIn ? "오늘의 답변 수정" : "오늘의 답변 저장"}
        </SubmitButton>
      </div>
    </form>
  );
}
