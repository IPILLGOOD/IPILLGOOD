"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { ArrowRight, ClipboardCheck } from "lucide-react";
import { useRouter } from "next/navigation";

import { saveCheckInAction } from "@/app/actions";
import { FormMessage } from "@/components/ui/FormMessage";
import { SubmitButton } from "@/components/ui/SubmitButton";
import type { MedicationScheduleTask } from "@/lib/presentation";
import type { ActionState, DailyCheckIn } from "@care-atlas/backend";

const initialState: ActionState = { status: "idle", message: "" };
const doseOptions = [
  { value: "completed", label: "복용 완료" },
  { value: "partial", label: "일부 복용" },
  { value: "not_yet", label: "아직 안 먹음" },
  { value: "skipped", label: "먹지 못함" },
  { value: "unconfirmed", label: "확인 못함" },
];
const symptoms = ["어지러움", "두통", "졸림", "속 불편함", "휘청거림"];

export function TodayQuickCheckIn({
  tasks,
  checkIn,
}: {
  tasks: MedicationScheduleTask[];
  checkIn: DailyCheckIn | null;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(saveCheckInAction, initialState);

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  return (
    <form
      className="quick-checkin-form"
      action={formAction}
      aria-label="오늘의 안부 바로 기록"
    >
      <div className="quick-checkin__header">
        <ClipboardCheck size={23} aria-hidden="true" />
        <div>
          <h2>오늘의 안부 확인</h2>
          <p>이 화면에서 바로 확인하고 수정할 수 있어요.</p>
        </div>
      </div>

      <FormMessage state={state} />

      <div className="field quick-checkin__reporter">
        <label htmlFor="quick-answered-by">확인한 사람</label>
        <select
          id="quick-answered-by"
          name="answeredBy"
          defaultValue={checkIn?.completedBy ?? "caregiver"}
        >
          <option value="caregiver">보호자</option>
          <option value="recipient">어르신 본인</option>
        </select>
      </div>

      <fieldset className="quick-checkin__section">
        <legend>복약 확인</legend>
        {tasks.length > 0 ? (
          <div className="quick-dose-list">
            {tasks.map((task) => (
              <div className="quick-dose-row" key={task.id}>
                <label htmlFor={`quick-dose-${task.id}`}>
                  <span>
                    <time>{task.timeLabel}</time>
                    {task.productName}
                  </span>
                  <small>
                    {task.doseAmount} · {task.slotLabel}
                  </small>
                </label>
                <select
                  id={`quick-dose-${task.id}`}
                  name={`dose_${task.id}`}
                  defaultValue={task.response}
                >
                  {doseOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        ) : (
          <p className="quick-checkin__empty">오늘 예정된 복용 일정이 없어요.</p>
        )}
      </fieldset>

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
                defaultChecked={checkIn?.symptoms.includes(symptom)}
              />
              <span>{symptom}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label htmlFor="quick-severity">불편한 정도</label>
        <select
          id="quick-severity"
          name="severity"
          defaultValue={String(checkIn?.severity ?? 3)}
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
          defaultValue={checkIn?.note ?? ""}
          placeholder="직접 보거나 들은 내용을 적어주세요."
        />
      </div>

      <div className="quick-checkin__actions">
        <SubmitButton pendingText="저장하는 중…">안부 기록 저장</SubmitButton>
        <Link href="/check-in">
          더 자세히 기록 <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </form>
  );
}
