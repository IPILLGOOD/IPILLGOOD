import { Check, Clock3, HelpCircle, Minus, Pill } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import type { MedicationScheduleTask } from "@/lib/presentation";

function taskState(task: MedicationScheduleTask) {
  if (task.response === "completed") {
    return { label: "완료", tone: "success" as const, icon: Check, className: "is-complete" };
  }
  if (task.response === "partial") {
    return { label: "일부 복용", tone: "warning" as const, icon: Minus, className: "needs-review" };
  }
  if (task.response === "skipped" || task.response === "unconfirmed") {
    return { label: "확인 필요", tone: "warning" as const, icon: HelpCircle, className: "needs-review" };
  }
  return { label: "예정", tone: "neutral" as const, icon: Clock3, className: "is-upcoming" };
}

export function TodayTaskList({ tasks }: { tasks: MedicationScheduleTask[] }) {
  return (
    <ol className="today-task-list" aria-label="오늘 복약 일정">
      {tasks.map((task) => {
        const state = taskState(task);
        const Icon = state.icon;
        return (
          <li className={`today-task ${state.className}`} key={task.id}>
            <time dateTime={task.scheduledAt}>{task.timeLabel}</time>
            <span className="today-task__state" aria-hidden="true">
              <Icon size={18} />
            </span>
            <span className="today-task__medicine">
              <span className="pill-mark" aria-hidden="true">
                <Pill size={18} />
              </span>
              <span>
                <strong>{task.productName}</strong>
                <small>
                  {task.doseAmount} · {task.slotLabel} · {task.frequency}
                </small>
              </span>
            </span>
            <Badge tone={state.tone}>{state.label}</Badge>
          </li>
        );
      })}
    </ol>
  );
}
