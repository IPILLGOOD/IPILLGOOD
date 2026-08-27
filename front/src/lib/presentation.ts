import { calendarDayDifference, dateKeyInSeoul, formatInSeoul } from "@care-atlas/backend/dates";
import type { DoseEvent, MedicationPlan, SymptomEvent } from "@care-atlas/backend";

export { createMedicationSchedule, type MedicationScheduleTask } from "@care-atlas/backend";

export function formatDate(date: string, options?: Intl.DateTimeFormatOptions) {
  return formatInSeoul(date, { ...(!options?.dateStyle && !options?.timeStyle ? { month: "short" as const, day: "numeric" as const } : {}), ...options });
}

export function daysSince(date: string, now = new Date()) {
  return Math.max(1, calendarDayDifference(dateKeyInSeoul(date), dateKeyInSeoul(now)) + 1);
}

export function adherenceSummary(events: DoseEvent[]) {
  const answerable = events.filter((event) => event.response !== "not_yet");
  const confirmed = answerable.filter((event) => event.response === "completed").length;
  const rate = answerable.length === 0 ? 0 : Math.round((confirmed / answerable.length) * 100);
  return { confirmed, total: answerable.length, rate };
}

export function uniqueSymptomDays(events: SymptomEvent[]) {
  return new Set(events.map((event) => dateKeyInSeoul(event.occurredAt))).size;
}

export function activeMedications(medications: MedicationPlan[]) {
  return medications.filter((medication) => medication.status === "active");
}
