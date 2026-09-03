"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useCheckInForm } from "./useCheckInForm";
import { QuestionRecovery } from "./QuestionRecovery";
import { DynamicQuestionFields } from "@/components/check-in/DynamicQuestionFields";
import { FormMessage } from "@/components/ui/FormMessage";
import { SubmitButton } from "@/components/ui/SubmitButton";
import type { DailyCheckIn, PatientQuestionResponse, PatientQuestionSet } from "@care-atlas/backend";
const symptoms = ["어지러움", "두통", "졸림", "속 불편함", "휘청거림"];

export function CheckInForm({
  questionSet: initialQuestions,
  initialCheckIn,
  initialQuestionResponse,
  revision,
  observationIdempotencyKey,
}: {
  questionSet: PatientQuestionSet | null;
  initialCheckIn: DailyCheckIn | null;
  initialQuestionResponse: PatientQuestionResponse | null;
  revision: number;
  observationIdempotencyKey: string;
}) {
  const router = useRouter();
  const initialDraft = {
    ...(initialCheckIn
      ? {
          reportSource: [initialReportSource(initialCheckIn)],
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
    <form className="checkin-form" action={formAction} onReset={(event) => event.preventDefault()} aria-label="오늘의 안부 기록">
      <input type="hidden" name="expectedRevision" value={form.baselineRevision} />
      <input type="hidden" name="checkInScope" value="guided_wellbeing" />
      <input type="hidden" name="observationIdempotencyKey" value={observationIdempotencyKey} />
      {!form.recoveryMessage && <FormMessage state={state} />}
      {state.conflict ? (
        <button className="button button--secondary" type="button" disabled={!form.latestRevisionReady} onClick={form.acceptLatestRevision}>
          {form.latestRevisionReady ? "최신 내용 확인 후 다시 저장" : "최신 내용 불러오는 중…"}
        </button>
      ) : null}
      {(state.recoverQuestions || form.recoveryMessage) && recovery}

      <fieldset className="question-block">
        <legend>1. 누가 어떻게 오늘의 상태를 확인했나요?</legend>
        <p className="question-block__helper">기록의 근거가 화면과 상담용 보고서에 함께 표시돼요.</p>
        <div className="choice-grid">
          <label className="choice-card">
            <input name="reportSource" type="radio" value="caregiver_observed" {...form.check("reportSource", "caregiver_observed", !initialCheckIn)} required />
            보호자가 직접 보거나 확인했어요
          </label>
          <label className="choice-card">
            <input name="reportSource" type="radio" value="recipient_self_reported" {...form.check("reportSource", "recipient_self_reported", initialCheckIn?.completedBy === "recipient")} required />
            어르신이 직접 답했어요
          </label>
          <label className="choice-card">
            <input name="reportSource" type="radio" value="caregiver_relayed" {...form.check("reportSource", "caregiver_relayed")} required />
            보호자가 전달받아 확인했어요
          </label>
          <label className="choice-card">
            <input name="reportSource" type="radio" value="unconfirmed" {...form.check("reportSource", "unconfirmed")} required />
            확인하지 못했어요
          </label>
        </div>
      </fieldset>

      <fieldset className="question-block">
        <legend>2. 오늘 평소와 다른 몸 상태가 있었나요?</legend>
        <p className="question-block__helper">없으면 선택하지 않아도 괜찮아요. 여러 증상은 각각 저장 시각의 관찰로 남아요.</p>
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

      {initialCheckIn ? (
        <div className="field">
          <label htmlFor="correctionReason">기존 기록을 수정하는 이유</label>
          <textarea
            id="correctionReason"
            name="correctionReason"
            {...form.field("correctionReason")}
            maxLength={300}
            required
            placeholder="예: 어르신에게 다시 확인해 복용 여부를 바로잡아요."
          />
          <p className="field-hint">이전 기록은 지우지 않고 정정 전후 내용, 확인한 사람과 시각을 함께 보존해요.</p>
        </div>
      ) : null}

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

function initialReportSource(checkIn: DailyCheckIn) {
  const evidence = checkIn.wellbeingEvidenceLevel ?? checkIn.medicationEvidenceLevel ?? checkIn.evidenceLevel;
  if (evidence === "self_reported") return "recipient_self_reported";
  if (evidence === "relayed_confirmation") return "caregiver_relayed";
  if (evidence === "unconfirmed") return "unconfirmed";
  return checkIn.completedBy === "recipient" ? "recipient_self_reported" : "caregiver_observed";
}
