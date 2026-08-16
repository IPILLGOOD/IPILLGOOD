import { CheckCircle2, CircleAlert } from "lucide-react";

import type { ActionState } from "@care-atlas/backend";

export function FormMessage({ state }: { state: ActionState }) {
  if (state.status === "idle") return null;
  const success = state.status === "success";
  const Icon = success ? CheckCircle2 : CircleAlert;
  return (
    <div
      className={`form-message form-message--${state.status}`}
      role={success ? "status" : "alert"}
      aria-live="polite"
    >
      <Icon size={20} aria-hidden="true" />
      <span>{state.message}</span>
    </div>
  );
}
