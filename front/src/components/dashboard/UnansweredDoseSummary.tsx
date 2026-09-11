"use client";

import { ArrowUpRight, Check, ChevronDown, Clock3, Pill, X } from "lucide-react";
import { useActionState, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { PreviewDoseAction } from "@/components/preview/PreviewActions";

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

export function DoseResponseEditor({ dose, medication, revision, className = "" }: { dose: Dose; medication?: Medication; revision: number; className?: string; initiallyOpen?: boolean }) {
  const router = useRouter();
  const previewAction = useContext(PreviewDoseAction);
  const [state, action, pending] = useActionState(previewAction ?? saveDoseResponseAction, { status: "idle" as const, message: "" });
  useEffect(() => {
    if (state.status === "success" && !previewAction) router.refresh();
  }, [router, state.status, previewAction]);
  const time = timeLabel(dose.scheduledAt);

  return (
    <form className={`dose-quick-check is-${dose.response === "partial" ? "skipped" : dose.response} ${className}`.trim()} action={action}>
      <input type="hidden" name="eventId" value={dose.id} />
      <input type="hidden" name="medicationPlanId" value={dose.medicationPlanId} />
      <input type="hidden" name="scheduledAt" value={dose.scheduledAt} />
      <input type="hidden" name="expectedRevision" value={revision} />
      <input type="hidden" name="reportSource" value={dose.answeredBy === "recipient" ? "recipient" : "caregiver"} />
      <div className="dose-quick-check__info">
        <span className="unanswered-dose__copy">
          <strong>{medication?.productName ?? "복약 일정"}</strong>
          <span><Clock3 size={12} aria-hidden="true" /> {time || medication?.timing}</span>
        </span>
      </div>
      <div className="dose-quick-check__actions" aria-label={`${medication?.productName ?? "복약 일정"} 복용 여부`}>
        <button className="is-skipped" type="submit" name="response" value="skipped" disabled={pending} aria-label="미복용" title="미복용"><X size={18} /></button>
        <button className="is-completed" type="submit" name="response" value="completed" disabled={pending} aria-label="복용 완료" title="복용 완료"><Check size={18} /></button>
      </div>
      {state.status === "error" ? <p className="unanswered-dose__message" role="alert">{state.message}</p> : null}
    </form>
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
