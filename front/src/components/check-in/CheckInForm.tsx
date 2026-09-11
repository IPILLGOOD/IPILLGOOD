"use client";

import Link from "next/link";
import { Check, CheckCircle2, Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useCheckInForm } from "./useCheckInForm";
import { QuestionRecovery } from "./QuestionRecovery";
import { FormMessage } from "@/components/ui/FormMessage";
import { SubmitButton } from "@/components/ui/SubmitButton";
import type {
  DailyCheckIn,
  PatientQuestionResponse,
  PatientQuestionSet,
} from "@care-atlas/backend";
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
  const [currentStep, setCurrentStep] = useState(0);
  const [editing, setEditing] = useState(!initialCheckIn);
  const stepRefs = useRef<Array<HTMLDivElement | null>>([]);
  useEffect(() => {
    if (state.conflict) router.refresh();
  }, [router, state.conflict]);
  const recovery = (
    <QuestionRecovery
      unavailable={!questionSet}
      pending={form.pending}
      message={form.recoveryMessage}
      onRetry={form.recover}
    />
  );
  if (initialCheckIn && !editing && state.status !== "success") {
    const recordedAt =
      initialCheckIn.wellbeingRecordedAt ?? initialCheckIn.completedAt;
    const symptomSummary = initialCheckIn.symptoms.length
      ? initialCheckIn.symptoms.join(" · ")
      : "특별히 선택한 증상 없음";
    return (
      <section
        className="checkin-complete"
        aria-labelledby="checkin-complete-title"
      >
        <span className="checkin-complete__icon" aria-hidden="true">
          <CheckCircle2 size={28} />
        </span>
        <p className="checkin-complete__eyebrow">오늘 기록 완료</p>
        <h2 id="checkin-complete-title">오늘 안부에 이미 답변했어요</h2>
        <p className="checkin-complete__description">
          내용이 달라졌다면 기존 답변을 불러와 수정할 수 있어요.
        </p>
        <dl className="checkin-complete__summary">
          <div>
            <dt>기록 시각</dt>
            <dd>{formatRecordedAt(recordedAt)}</dd>
          </div>
          <div>
            <dt>확인한 상태</dt>
            <dd>{symptomSummary}</dd>
          </div>
          {initialCheckIn.symptoms.length ? (
            <div>
              <dt>불편한 정도</dt>
              <dd>{initialCheckIn.severity ?? 0} / 10</dd>
            </div>
          ) : null}
        </dl>
        <div className="checkin-complete__actions">
          <Link className="button button--secondary" href="/today">
            오늘 화면으로
          </Link>
          <button
            className="button button--primary"
            type="button"
            onClick={() => setEditing(true)}
          >
            <Pencil size={17} aria-hidden="true" /> 오늘 답변 수정
          </button>
        </div>
      </section>
    );
  }
  if (!questionSet) return recovery;
  const totalSteps = questionSet.questions.length + 3;

  function goNext() {
    const invalid = stepRefs.current[currentStep]?.querySelector<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >("input:invalid, select:invalid, textarea:invalid");
    if (invalid) {
      invalid.reportValidity();
      return;
    }
    setCurrentStep((step) => Math.min(step + 1, totalSteps - 1));
  }

  if (state.status === "success") {
    return (
      <div>
        <FormMessage state={state} />
        <div className="completion-panel">
          <h2>답변이 돌봄 기록에 반영됐어요</h2>
          <p>
            오늘의 답변은 약의 처방 내용을 바꾸지 않아요. 대시보드와 상담용
            기록에서 시간에 따른 변화를 확인할 수 있어요.
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
    <form
      className="checkin-form"
      action={formAction}
      onReset={(event) => event.preventDefault()}
      aria-label="오늘의 안부 기록"
    >
      <input
        type="hidden"
        name="expectedRevision"
        value={form.baselineRevision}
      />
      <input type="hidden" name="checkInScope" value="guided_wellbeing" />
      <input
        type="hidden"
        name="observationIdempotencyKey"
        value={observationIdempotencyKey}
      />
      <input
        type="hidden"
        name="questionSetId"
        value={questionSet.question_set_id}
      />
      {!form.recoveryMessage && <FormMessage state={state} />}
      {state.conflict ? (
        <button
          className="button button--secondary"
          type="button"
          disabled={!form.latestRevisionReady}
          onClick={form.acceptLatestRevision}
        >
          {form.latestRevisionReady
            ? "최신 내용 확인 후 다시 저장"
            : "최신 내용 불러오는 중…"}
        </button>
      ) : null}
      {(state.recoverQuestions || form.recoveryMessage) && recovery}

      <div
        className="checkin-step-progress"
        aria-label={`전체 ${totalSteps}단계 중 ${currentStep + 1}단계`}
      >
        <span>
          {currentStep + 1} / {totalSteps}
        </span>
        <progress max={totalSteps} value={currentStep + 1} />
      </div>

      <div
        ref={(node) => {
          stepRefs.current[0] = node;
        }}
        hidden={currentStep !== 0}
      >
        <fieldset className="checkin-step-card">
          <legend>누가 오늘의 상태를 확인했나요?</legend>
          <p>기록을 확인한 사람을 선택해주세요.</p>
          <div className="checkin-answer-list">
            {[
              [
                "caregiver_observed",
                "보호자가 직접 보거나 확인했어요",
                !initialCheckIn,
              ],
              [
                "recipient_self_reported",
                "이용자가 직접 답했어요",
                initialCheckIn?.completedBy === "recipient",
              ],
              ["caregiver_relayed", "보호자가 전달받아 확인했어요", false],
              ["unconfirmed", "확인하지 못했어요", false],
            ].map(([value, label, fallback]) => (
              <label key={String(value)}>
                <input
                  name="reportSource"
                  type="radio"
                  value={String(value)}
                  {...form.check(
                    "reportSource",
                    String(value),
                    Boolean(fallback),
                  )}
                  required
                />
                <span>{String(label)}</span>
                <Check size={20} aria-hidden="true" />
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div
        ref={(node) => {
          stepRefs.current[1] = node;
        }}
        hidden={currentStep !== 1}
      >
        <fieldset className="checkin-step-card">
          <legend>오늘 평소와 다른 몸 상태가 있었나요?</legend>
          <p>해당하는 증상을 모두 선택해주세요. 없으면 넘어가도 괜찮아요.</p>
          <div className="checkin-answer-list">
            {symptoms.map((symptom) => (
              <label key={symptom}>
                <input
                  name="symptoms"
                  type="checkbox"
                  value={symptom}
                  {...form.check(
                    "symptoms",
                    symptom,
                    initialCheckIn?.symptoms.includes(symptom) ?? false,
                  )}
                />
                <span>{symptom}</span>
                <Check size={20} aria-hidden="true" />
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {questionSet.questions.map((question, index) => {
        const step = index + 2;
        return (
          <div
            key={question.question_id}
            ref={(node) => {
              stepRefs.current[step] = node;
            }}
            hidden={currentStep !== step}
          >
            <fieldset className="checkin-step-card">
              <span className="checkin-step-card__eyebrow">
                {question.display.badge}
              </span>
              <legend>{question.display.caregiver_text}</legend>
              <p>{question.display.helper_text}</p>
              <div className="checkin-answer-list">
                {question.options.map((option) => (
                  <label key={option.value}>
                    <input
                      name={`question_${question.question_id}`}
                      type="radio"
                      value={option.value}
                      {...form.check(
                        `question_${question.question_id}`,
                        option.value,
                      )}
                      required={question.required}
                    />
                    <span>{option.label}</span>
                    <Check size={20} aria-hidden="true" />
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        );
      })}

      <div
        ref={(node) => {
          stepRefs.current[totalSteps - 1] = node;
        }}
        hidden={currentStep !== totalSteps - 1}
      >
        <fieldset className="checkin-step-card checkin-step-card--details">
          <legend>오늘 상태를 조금 더 남겨주세요</legend>
          <p>
            불편한 정도와 직접 확인한 내용을 기록하면 상담할 때 도움이 돼요.
          </p>
          <div className="form-grid form-grid--check-in-details">
            <div className="field">
              <label htmlFor="severity">불편한 정도</label>
              <select
                id="severity"
                name="severity"
                {...form.field(
                  "severity",
                  String(initialCheckIn?.severity || 3),
                )}
              >
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
              <p className="field-hint">
                진단보다 직접 보거나 들은 사실을 적어주세요.
              </p>
            </div>
          </div>
          {initialCheckIn ? (
            <div className="field">
              <label htmlFor="correctionReason">
                기존 기록을 수정하는 이유
              </label>
              <textarea
                id="correctionReason"
                name="correctionReason"
                {...form.field("correctionReason")}
                maxLength={300}
                required
                placeholder="예: 이용자에게 다시 확인해 복용 여부를 바로잡아요."
              />
              <p className="field-hint">
                이전 기록은 지우지 않고 정정 전후 내용, 확인한 사람과 시각을
                함께 보존해요.
              </p>
            </div>
          ) : null}
        </fieldset>
      </div>

      <div className="checkin-step-actions">
        {currentStep === 0 ? (
          <Link className="button button--quiet" href="/today">
            나중에
          </Link>
        ) : (
          <button
            className="button button--secondary"
            type="button"
            onClick={() => setCurrentStep((step) => Math.max(0, step - 1))}
          >
            이전
          </button>
        )}
        {currentStep < totalSteps - 1 ? (
          <button
            className="button button--primary"
            type="button"
            onClick={goNext}
          >
            다음 질문
          </button>
        ) : (
          <SubmitButton disabled={form.pending} pendingText="기록하는 중…">
            {initialCheckIn ? "오늘의 답변 수정" : "오늘의 답변 저장"}
          </SubmitButton>
        )}
      </div>
    </form>
  );
}

function formatRecordedAt(value: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Seoul",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("month")}월 ${part("day")}일 ${part("hour")}:${part("minute")}`;
}

function initialReportSource(checkIn: DailyCheckIn) {
  const evidence =
    checkIn.wellbeingEvidenceLevel ??
    checkIn.medicationEvidenceLevel ??
    checkIn.evidenceLevel;
  if (evidence === "self_reported") return "recipient_self_reported";
  if (evidence === "relayed_confirmation") return "caregiver_relayed";
  if (evidence === "unconfirmed") return "unconfirmed";
  return checkIn.completedBy === "recipient"
    ? "recipient_self_reported"
    : "caregiver_observed";
}
