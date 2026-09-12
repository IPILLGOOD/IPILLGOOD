"use client";

import { Check, Clock3, X } from "lucide-react";
import { useActionState, useContext, useEffect } from "react";
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

function timeLabel(value: string) {
  const match = value.match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "";
}

export function DoseResponseEditor({ dose, medication, revision, className = "" }: { dose: Dose; medication?: Medication; revision: number; className?: string }) {
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
