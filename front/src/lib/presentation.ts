import { calendarDayDifference, dateKeyInSeoul, formatInSeoul } from "@care-atlas/backend/dates";
import type { MedicationPlan } from "@care-atlas/backend";

export { adherenceSummary, uniqueSymptomDays } from "./recent-care-records";

export { createMedicationSchedule, type MedicationScheduleTask } from "@care-atlas/backend";

export function formatDate(date: string, options?: Intl.DateTimeFormatOptions) {
  return formatInSeoul(date, { ...(!options?.dateStyle && !options?.timeStyle ? { month: "short" as const, day: "numeric" as const } : {}), ...options });
}

export function daysSince(date: string, now = new Date()) {
  return Math.max(1, calendarDayDifference(dateKeyInSeoul(date), dateKeyInSeoul(now)) + 1);
}

export function activeMedications(medications: MedicationPlan[]) {
  return medications.filter((medication) => medication.status === "active");
}
