import { Check, Clock3, HelpCircle, Minus, X } from "lucide-react";

import type { MedicationScheduleTask } from "@/lib/presentation";

function taskResult(task: MedicationScheduleTask) {
  if (task.response === "completed") return { label: "복용 완료", icon: Check, className: "is-complete" };
  if (task.response === "partial") return { label: "일부 복용", icon: Minus, className: "is-partial" };
  if (task.response === "skipped") return { label: "미복용", icon: X, className: "is-skipped" };
  if (task.response === "unconfirmed") return { label: "복용 여부 확인 필요", icon: HelpCircle, className: "is-unconfirmed" };
  return { label: "복용 예정", icon: Clock3, className: "is-upcoming" };
}

export function TodayTaskList({ tasks }: { tasks: MedicationScheduleTask[] }) {
  return (
    <ol className="today-task-list" aria-label="오늘 복약 일정">
      {tasks.map((task) => {
        const timingLabel = task.slotLabel.replace(task.timeLabel, "").replace(/\s+/g, " ").trim();
        const result = taskResult(task);
        const ResultIcon = result.icon;
        return (
          <li className="today-task" key={task.id}>
            <time dateTime={task.scheduledAt}>{task.timeLabel}</time>
            <span className="today-task__medicine">
              <span>
                <strong>{task.productName}</strong>
                <small>
                  {[task.doseAmount, timingLabel, task.frequency].filter(Boolean).join(" · ")}
                </small>
              </span>
            </span>
            <span className={`today-task__result ${result.className}`} title={result.label}>
              <ResultIcon size={24} strokeWidth={2.5} aria-hidden="true" />
              <span className="sr-only">{result.label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
