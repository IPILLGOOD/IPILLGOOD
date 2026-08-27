"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowRight, ClipboardCheck } from "lucide-react";
import { useRouter } from "next/navigation";

import { useCheckInForm } from "@/components/check-in/useCheckInForm";
import { QuestionRecovery } from "@/components/check-in/QuestionRecovery";
import { DynamicQuestionFields } from "@/components/check-in/DynamicQuestionFields";
import { FormMessage } from "@/components/ui/FormMessage";
import { SubmitButton } from "@/components/ui/SubmitButton";
import type { MedicationScheduleTask } from "@/lib/presentation";
import type {
  DailyCheckIn,
  PatientQuestionSet,
} from "@care-atlas/backend";

const symptoms = ["어지러움", "두통", "졸림", "속 불편함", "휘청거림"];

export function TodayQuickCheckIn({
  tasks,
  checkIn,
  questionSet: initialQuestions,
}: {
  tasks: MedicationScheduleTask[];
  checkIn: DailyCheckIn | null;
  questionSet: PatientQuestionSet | null;
}) {
  const router = useRouter();
  const form = useCheckInForm(initialQuestions);
  const { state, formAction, questionSet } = form;

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  const recovery = <QuestionRecovery unavailable={!questionSet} pending={form.pending} message={form.recoveryMessage} onRetry={form.recover} />;
  if (!questionSet) return recovery;

  return (
    <form
      className="quick-checkin-form"
      action={formAction}
      onReset={(event) => event.preventDefault()}
      aria-label="오늘의 안부 바로 기록"
    >
      <div className="quick-checkin__header">
        <ClipboardCheck size={23} aria-hidden="true" />
        <div>
          <h2>오늘의 안부 확인</h2>
          <p>복약 확인은 왼쪽 일정에서, 여기서는 몸 상태를 기록해요.</p>
        </div>
      </div>

      {!form.recoveryMessage && <FormMessage state={state} />}
      {(state.recoverQuestions || form.recoveryMessage) && recovery}
      <input type="hidden" name="checkInScope" value="wellbeing" />

      {tasks.map((task) => (
        <input
          key={task.id}
          type="hidden"
          name={`dose_${task.id}`}
          value={task.response}
        />
      ))}

      <div className="field quick-checkin__reporter">
        <label htmlFor="quick-answered-by">확인한 사람</label>
        <select
          id="quick-answered-by"
          name="answeredBy"
          {...form.field("answeredBy", checkIn?.completedBy ?? "caregiver")}
          required
        >
          <option value="caregiver">보호자</option>
          <option value="recipient">어르신 본인</option>
        </select>
      </div>

      <fieldset className="quick-checkin__section">
        <legend>불편한 증상</legend>
        <p>없으면 선택하지 않아도 괜찮아요.</p>
        <div className="quick-symptoms">
          {symptoms.map((symptom) => (
            <label key={symptom}>
              <input
                name="symptoms"
                type="checkbox"
                value={symptom}
                {...form.check("symptoms", symptom, checkIn?.symptoms.includes(symptom) ?? false)}
              />
              <span>{symptom}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <DynamicQuestionFields questionSet={questionSet} controls={form} compact />

      <div className="field">
        <label htmlFor="quick-severity">불편한 정도</label>
        <select
          id="quick-severity"
          name="severity"
          {...form.field("severity", String(checkIn?.severity ?? 3))}
        >
          <option value="1">아주 조금</option>
          <option value="3">조금 불편함</option>
          <option value="5">일상에 영향이 있음</option>
          <option value="7">많이 불편함</option>
          <option value="10">견디기 매우 어려움</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor="quick-note">보호자 메모</label>
        <textarea
          id="quick-note"
          name="note"
          maxLength={500}
          {...form.field("note", checkIn?.note ?? "")}
          placeholder="직접 보거나 들은 내용을 적어주세요."
        />
      </div>

      <div className="quick-checkin__actions">
        <SubmitButton disabled={form.pending} pendingText="저장하는 중…">안부 기록 저장</SubmitButton>
        <Link href="/check-in">
          더 자세히 기록 <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </form>
  );
}
