"use client";

import { ArrowUpRight, Check, ChevronDown, Clock3, Pill } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { saveDoseResponseAction } from "@/app/actions";

type Dose = {
  id: string;
  medicationPlanId: string;
  scheduledAt: string;
  response: "completed" | "partial" | "skipped" | "not_yet" | "unconfirmed";
  answeredBy: "caregiver" | "recipient";
};

type Medication = { id: string; productName: string; timing: string };

function dateLabel(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${Number(match[2])}월 ${Number(match[3])}일` : "날짜 확인 필요";
}

function timeLabel(value: string) {
  const match = value.match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "";
}

const responseLabels: Record<Dose["response"], string> = {
  completed: "복용 완료",
  partial: "일부 복용",
  skipped: "먹지 못함",
  not_yet: "응답 안 함",
  unconfirmed: "확인 못함",
};

export function DoseResponseEditor({ dose, medication, revision, className = "", initiallyOpen = false }: { dose: Dose; medication?: Medication; revision: number; className?: string; initiallyOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(initiallyOpen);
  const [state, action, pending] = useActionState(saveDoseResponseAction, { status: "idle" as const, message: "" });
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);
  const time = timeLabel(dose.scheduledAt);

  return (
    <div className={`unanswered-dose ${open ? "is-open" : ""} ${className}`.trim()}>
      <button className="unanswered-dose__toggle" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className={`unanswered-doses__icon ${dose.response !== "not_yet" ? "is-recorded" : ""}`} aria-hidden="true">
          {dose.response === "completed" ? <Check size={15} /> : <Pill size={15} />}
        </span>
        <span className="unanswered-dose__copy">
          <strong>{medication?.productName ?? "복약 일정"}</strong>
          <span><Clock3 size={12} aria-hidden="true" /> {dateLabel(dose.scheduledAt)}{time ? ` · ${time}` : ""}{medication?.timing ? ` · ${medication.timing}` : ""}</span>
        </span>
        <span className={`unanswered-dose__status unanswered-dose__status--${dose.response}`}>{responseLabels[dose.response]}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>

      {open ? (
        <form className="unanswered-dose__form" action={action}>
          <input type="hidden" name="eventId" value={dose.id} />
          <input type="hidden" name="medicationPlanId" value={dose.medicationPlanId} />
          <input type="hidden" name="scheduledAt" value={dose.scheduledAt} />
          <input type="hidden" name="expectedRevision" value={revision} />
          <label>
            누가 확인했나요?
            <select name="reportSource" defaultValue={dose.answeredBy === "recipient" ? "recipient" : "caregiver"}>
              <option value="caregiver">보호자가 확인했어요</option>
              <option value="recipient">어르신이 직접 답했어요</option>
              <option value="unconfirmed">확인하지 못했어요</option>
            </select>
          </label>
          <div className="unanswered-dose__choices" aria-label="복용 여부 수정">
            <button type="submit" name="response" value="completed" disabled={pending}>복용 완료</button>
            <button type="submit" name="response" value="partial" disabled={pending}>일부 복용</button>
            <button type="submit" name="response" value="not_yet" disabled={pending}>아직 안 먹음</button>
            <button type="submit" name="response" value="skipped" disabled={pending}>먹지 못함</button>
            <button type="submit" name="response" value="unconfirmed" disabled={pending}>확인 못함</button>
          </div>
          {state.status === "error" ? <p className="unanswered-dose__message" role="alert">{state.message}</p> : null}
          {pending ? <p className="unanswered-dose__message">저장하는 중…</p> : null}
        </form>
      ) : null}
    </div>
  );
}

export function UnansweredDoseSummary({
  doses,
  medications,
  today,
}: {
  doses: Dose[];
  medications: Medication[];
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const pastDoses = doses.filter((dose) => dose.scheduledAt.slice(0, 10) < today);
  const unanswered = pastDoses.filter((dose) => dose.response === "not_yet");

  return (
    <>
      <button
        className={`metric metric--action ${open ? "is-open" : ""} ${unanswered.length === 0 ? "is-empty" : ""}`}
        type="button"
        aria-expanded={open}
        aria-controls="unanswered-dose-list"
        onClick={() => unanswered.length > 0 && setOpen((current) => !current)}
        disabled={unanswered.length === 0}
      >
        <strong>{unanswered.length}건</strong>
        <span>{unanswered.length === 0 ? "모두 응답했어요" : "응답하지 않은 일정"}</span>
        {unanswered.length > 0 ? <ChevronDown size={15} aria-hidden="true" /> : null}
      </button>

      {open ? (
        <div className="unanswered-doses" id="unanswered-dose-list">
          <div className="unanswered-doses__heading">
            <div>
              <strong>응답하지 않은 지난 복약</strong>
              <p>오늘 일정은 제외했어요. 약을 눌러 응답할 수 있어요.</p>
            </div>
            <span>{unanswered.length}건</span>
          </div>

          {unanswered.length > 0 ? (
            <div className="unanswered-doses__list">
              {unanswered.map((dose) => {
                const medication = medications.find((item) => item.id === dose.medicationPlanId);
                const time = timeLabel(dose.scheduledAt);
                return (
                  <button
                    className="unanswered-dose-jump"
                    type="button"
                    key={dose.id}
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent("care-diary:select-dose", {
                        detail: { date: dose.scheduledAt.slice(0, 10), doseId: dose.id },
                      }));
                    }}
                  >
                    <span className="unanswered-doses__icon" aria-hidden="true"><Pill size={15} /></span>
                    <span className="unanswered-dose__copy">
                      <strong>{medication?.productName ?? "복약 일정"}</strong>
                      <span><Clock3 size={12} aria-hidden="true" /> {dateLabel(dose.scheduledAt)}{time ? ` · ${time}` : ""}{medication?.timing ? ` · ${medication.timing}` : ""}</span>
                    </span>
                    <span className="unanswered-dose__status unanswered-dose__status--not_yet">응답 안 함</span>
                    <ArrowUpRight className="unanswered-dose-jump__arrow" size={15} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="unanswered-doses__empty">응답하지 않은 지난 복약 일정이 없어요.</p>
          )}
        </div>
      ) : null}
    </>
  );
}
