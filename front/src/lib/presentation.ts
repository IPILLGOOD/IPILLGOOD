import type { DoseEvent, MedicationPlan, SymptomEvent } from "@care-atlas/backend";

export { createMedicationSchedule, type MedicationScheduleTask } from "@care-atlas/backend";

export function formatDate(date: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    ...options,
  }).format(new Date(date));
}

export function daysSince(date: string) {
  const start = new Date(date).getTime();
  const now = new Date().getTime();
  return Math.max(1, Math.floor((now - start) / 86_400_000) + 1);
}

export function adherenceSummary(events: DoseEvent[]) {
  const answerable = events.filter((event) => event.response !== "not_yet");
  const confirmed = answerable.filter((event) => event.response === "completed").length;
  const rate = answerable.length === 0 ? 0 : Math.round((confirmed / answerable.length) * 100);
  return { confirmed, total: answerable.length, rate };
}

export function uniqueSymptomDays(events: SymptomEvent[]) {
  return new Set(events.map((event) => event.occurredAt.slice(0, 10))).size;
}

export function activeMedications(medications: MedicationPlan[]) {
  return medications.filter((medication) => medication.status === "active");
}
