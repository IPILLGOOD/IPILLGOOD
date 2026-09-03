import { SEOUL_TIME_ZONE, addCalendarDays, calendarDayDifference, dateKeyInSeoul, dateKeyInTimeZone, seoulTimeLabel } from "./dates.ts";
import { createHash } from "node:crypto";

import type {
  DoseEvent,
  MedicationPlan,
  MedicationRecurrence,
  MedicationWeekday,
} from "./types.ts";

export const MEDICATION_TIME_ZONE = SEOUL_TIME_ZONE;

export interface MedicationScheduleTask {
  id: string;
  medicationPlanId: string;
  productName: string;
  doseAmount: string;
  frequency: string;
  timing: string;
  slotIndex: number;
  slotLabel: string;
  timeLabel: string;
  scheduledAt: string;
  response: DoseEvent["response"];
  hasRecordedResponse: boolean;
}

export interface MedicationReminderSchedule {
  id: string;
  recipientId: string;
  medicationPlanId: string;
  slotIndex: number;
  slotLabel: string;
  timeLabel: string;
  recurrence?: ScheduledMedicationRecurrence;
  /** Compatibility for schedules written before structured recurrence. */
  intervalDays?: number;
  startDate: string;
  endDate?: string;
  nextDueAt: string;
  timeZone: typeof MEDICATION_TIME_ZONE;
  status: "active" | "ended";
  updatedAt: string;
  planRevisionId?: string;
}

export type ScheduledMedicationRecurrence = Exclude<
  MedicationRecurrence,
  { kind: "as_needed" } | { kind: "unknown" }
>;

const KOREAN_WEEKDAYS: Record<string, MedicationWeekday> = {
  월: "mon",
  화: "tue",
  수: "wed",
  목: "thu",
  금: "fri",
  토: "sat",
  일: "sun",
};
const WEEKDAY_ORDER: MedicationWeekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DATE_WEEKDAYS: MedicationWeekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function activeMedications(medications: MedicationPlan[]) {
  return medications.filter((medication) => medication.status === "active");
}

function parseWeekdays(value: string): MedicationWeekday[] | null {
  const hasWeekdaySyntax = /요일/.test(value)
    || /[월화수목금토일]\s*[·,/]|[·,/]\s*[월화수목금토일]/.test(value)
    || /^(?:매주|주\s*\d+회)\s*\(?\s*[월화수목금토일]/.test(value);
  if (!hasWeekdaySyntax) return null;

  const weekdays = [...value.matchAll(/(?<!요)([월화수목금토일])(?:요일)?/g)]
    .map((match) => KOREAN_WEEKDAYS[match[1]!])
    .filter((weekday): weekday is MedicationWeekday => Boolean(weekday));
  return [...new Set(weekdays)].sort(
    (left, right) => WEEKDAY_ORDER.indexOf(left) - WEEKDAY_ORDER.indexOf(right),
  );
}

export function normalizeMedicationRecurrence(frequency: string): MedicationRecurrence {
  const source = frequency.trim();
  const normalized = source.replace(/\s+/g, " ");
  if (!normalized) return { kind: "unknown", reason: "empty", source };
  if (/(?:필요\s*시|필요할\s*때|증상\s*시|통증(?:이)?\s*있을\s*때|PRN)/i.test(normalized)) {
    return { kind: "as_needed", source };
  }

  const dailyMatch = normalized.match(/^(?:하루|1일)\s*(\d+)회(?:\s*복용)?$/);
  if (dailyMatch) {
    const count = Number(dailyMatch[1]);
    return Number.isInteger(count) && count >= 1 && count <= 6
      ? { kind: "daily", count, source }
      : { kind: "unknown", reason: "unsupported", source };
  }

  if (/^매일(?:\s*1회)?$/.test(normalized)) return { kind: "daily", count: 1, source };

  const intervalMatch = normalized.match(/^(\d+)일\s*1회(?:\s*복용)?$/);
  if (intervalMatch) {
    const intervalDays = Number(intervalMatch[1]);
    return Number.isInteger(intervalDays) && intervalDays >= 1 && intervalDays <= 365
      ? { kind: "interval_days", count: 1, intervalDays, source }
      : { kind: "unknown", reason: "unsupported", source };
  }

  const weekdays = parseWeekdays(normalized);
  if (weekdays?.length) {
    const declaredCount = normalized.match(/주\s*(\d+)회/)?.[1];
    if (declaredCount && Number(declaredCount) !== weekdays.length) {
      return { kind: "unknown", reason: "weekday_confirmation_required", source };
    }
    return { kind: "weekdays", weekdays, count: 1, source };
  }

  const weeklyMatch = normalized.match(/^(?:(\d+)주\s*1회|주\s*1회|매주(?:\s*1회)?|격주(?:\s*1회)?)$/);
  if (weeklyMatch) {
    const intervalWeeks = normalized.startsWith("격주") ? 2 : Number(weeklyMatch[1] ?? 1);
    return Number.isInteger(intervalWeeks) && intervalWeeks >= 1 && intervalWeeks <= 52
      ? { kind: "weekly", intervalWeeks, count: 1, source }
      : { kind: "unknown", reason: "unsupported", source };
  }

  if (/^주\s*\d+회/.test(normalized)) {
    return { kind: "unknown", reason: "weekday_confirmation_required", source };
  }

  return { kind: "unknown", reason: "unsupported", source };
}

export function isScheduledMedicationRecurrence(
  recurrence: MedicationRecurrence,
): recurrence is ScheduledMedicationRecurrence {
  return recurrence.kind !== "as_needed" && recurrence.kind !== "unknown";
}

function recurrenceForMedication(medication: Pick<MedicationPlan, "frequency" | "recurrence">) {
  const source = medication.frequency.trim();
  return medication.recurrence?.source === source
    ? medication.recurrence
    : normalizeMedicationRecurrence(source);
}

function recurrenceCount(recurrence: ScheduledMedicationRecurrence) {
  return recurrence.kind === "daily" ? recurrence.count : 1;
}

function legacyIntervalDays(recurrence: ScheduledMedicationRecurrence) {
  if (recurrence.kind === "daily") return 1;
  if (recurrence.kind === "interval_days") return recurrence.intervalDays;
  if (recurrence.kind === "weekly") return recurrence.intervalWeeks * 7;
  return undefined;
}

/** Compatibility wrapper for callers that still consume count/intervalDays. */
export function medicationFrequencyRule(frequency: string) {
  const recurrence = normalizeMedicationRecurrence(frequency);
  if (!isScheduledMedicationRecurrence(recurrence)) return null;
  const intervalDays = legacyIntervalDays(recurrence);
  return {
    count: recurrenceCount(recurrence),
    recurrence,
    ...(intervalDays !== undefined ? { intervalDays } : {}),
  };
}

export { dateKeyInTimeZone } from "./dates.ts";

export function isMedicationDueOnDate(
  medication: Pick<MedicationPlan, "startDate" | "endDate">,
  dateKey: string,
  recurrenceOrIntervalDays: MedicationRecurrence | number,
) {
  if (medication.startDate > dateKey) return false;
  if (medication.endDate && medication.endDate < dateKey) return false;
  const recurrence: MedicationRecurrence = typeof recurrenceOrIntervalDays === "number"
    ? { kind: "interval_days", intervalDays: recurrenceOrIntervalDays, count: 1, source: "legacy" }
    : recurrenceOrIntervalDays;
  if (recurrence.kind === "as_needed" || recurrence.kind === "unknown") return false;
  if (recurrence.kind === "daily") return true;
  if (recurrence.kind === "weekdays") {
    const weekday = DATE_WEEKDAYS[new Date(`${dateKey}T12:00:00Z`).getUTCDay()];
    return weekday ? recurrence.weekdays.includes(weekday) : false;
  }

  const elapsedDays = calendarDayDifference(medication.startDate, dateKey);
  const intervalDays = recurrence.kind === "weekly"
    ? recurrence.intervalWeeks * 7
    : recurrence.intervalDays;
  return elapsedDays >= 0 && elapsedDays % intervalDays === 0;
}

export function timeForMedicationSlot(label: string, _index: number, _count: number) {
  const clock = label.match(/(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)(?:\D|$)/);
  if (clock) return `${clock[1]!.padStart(2, "0")}:${clock[2]}`;
  if (label.includes("아침")) return "08:00";
  if (label.includes("점심")) return "13:00";
  if (label.includes("저녁")) return "19:00";
  if (label.includes("취침") || label.includes("자기 전")) return "21:00";

  return null;
}

export function medicationTimingSlots(timing: string, count: number) {
  const pieces = timing
    .split(/[·,/]/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (pieces.length === count) return pieces;
  if (count === 1) return [timing];
  return [];
}

function isoAtSeoulTime(dateKey: string, timeLabel: string) {
  return `${dateKey}T${timeLabel}:00+09:00`;
}



export function nextMedicationDueAt(
  medication: Pick<MedicationPlan, "startDate" | "endDate">,
  timeLabel: string,
  recurrence: ScheduledMedicationRecurrence | number,
  after: Date,
) {
  const firstDate = dateKeyInTimeZone(after);
  for (let offset = 0; offset <= 366; offset += 1) {
    const dateKey = addCalendarDays(firstDate, offset);
    if (medication.endDate && dateKey > medication.endDate) return null;
    if (!isMedicationDueOnDate(medication, dateKey, recurrence)) continue;
    const candidate = new Date(isoAtSeoulTime(dateKey, timeLabel));
    if (candidate.getTime() > after.getTime()) return candidate.toISOString();
  }
  return null;
}

export function createMedicationSchedule(
  medications: MedicationPlan[],
  events: DoseEvent[] = [],
  date = new Date(),
): MedicationScheduleTask[] {
  const dateKey = dateKeyInTimeZone(date);
  const tasks: MedicationScheduleTask[] = [];

  for (const medication of activeMedications(medications)) {
    const recurrence = recurrenceForMedication(medication);
    if (!isScheduledMedicationRecurrence(recurrence)) continue;
    if (!isMedicationDueOnDate(medication, dateKey, recurrence)) continue;

    const count = recurrenceCount(recurrence);
    const slots = medicationTimingSlots(medication.timing, count);
    const eventsForMedication = events
      .filter(
        (event) =>
          event.medicationPlanId === medication.id && dateKeyInSeoul(event.scheduledAt) === dateKey,
      )
      .sort((a, b) =>
        String(b.answeredAt ?? b.scheduledAt).localeCompare(
          String(a.answeredAt ?? a.scheduledAt),
        ),
      );

    slots.forEach((slotLabel, slotIndex) => {
      const timeLabel = timeForMedicationSlot(slotLabel, slotIndex, count);
      if (!timeLabel) return;
      const scheduledAt = isoAtSeoulTime(dateKey, timeLabel);
      const exactEvent = eventsForMedication.find(
        (event) => seoulTimeLabel(event.scheduledAt) === timeLabel,
      );

      tasks.push({
        id: `${medication.id}__${slotIndex}`,
        medicationPlanId: medication.id,
        productName: medication.productName,
        doseAmount: medication.doseAmount,
        frequency: medication.frequency,
        timing: medication.timing,
        slotIndex,
        slotLabel,
        timeLabel,
        scheduledAt,
        response: exactEvent?.response ?? "not_yet",
        hasRecordedResponse: Boolean(exactEvent),
      });
    });
  }

  return tasks.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

function reminderScheduleId(recipientId: string, medicationPlanId: string, slotIndex: number) {
  return createHash("sha256")
    .update(`${recipientId}\u0000${medicationPlanId}\u0000${slotIndex}`)
    .digest("hex")
    .slice(0, 40);
}

export function buildMedicationReminderSchedules(
  recipientId: string,
  medications: MedicationPlan[],
  now = new Date(),
): MedicationReminderSchedule[] {
  const updatedAt = now.toISOString();
  return activeMedications(medications).flatMap((medication) => {
    const recurrence = recurrenceForMedication(medication);
    if (!isScheduledMedicationRecurrence(recurrence)) return [];
    const count = recurrenceCount(recurrence);
    const slots = medicationTimingSlots(medication.timing, count);
    return slots.flatMap((slotLabel, slotIndex) => {
      const timeLabel = timeForMedicationSlot(slotLabel, slotIndex, count);
      if (!timeLabel) return [];
      const nextDueAt = nextMedicationDueAt(medication, timeLabel, recurrence, now);
      if (!nextDueAt) return [];
      const intervalDays = legacyIntervalDays(recurrence);
      return [
        {
          id: reminderScheduleId(recipientId, medication.id, slotIndex),
          recipientId,
          medicationPlanId: medication.id,
          slotIndex,
          slotLabel,
          timeLabel,
          recurrence,
          ...(intervalDays !== undefined ? { intervalDays } : {}),
          startDate: medication.startDate,
          ...(medication.endDate ? { endDate: medication.endDate } : {}),
          nextDueAt,
          timeZone: MEDICATION_TIME_ZONE,
          status: "active",
          updatedAt,
        } satisfies MedicationReminderSchedule,
      ];
    });
  });
}

export function advanceMedicationReminderSchedule(
  schedule: MedicationReminderSchedule,
  now = new Date(),
): MedicationReminderSchedule {
  const afterCurrentOccurrence = new Date(
    Math.max(new Date(schedule.nextDueAt).getTime(), now.getTime()) + 1_000,
  );
  const recurrence = schedule.recurrence ?? (schedule.intervalDays !== undefined
    ? {
        kind: "interval_days" as const,
        intervalDays: schedule.intervalDays,
        count: 1 as const,
        source: "legacy",
      }
    : null);
  const nextDueAt = recurrence
    ? nextMedicationDueAt(schedule, schedule.timeLabel, recurrence, afterCurrentOccurrence)
    : null;
  return {
    ...schedule,
    nextDueAt: nextDueAt ?? schedule.nextDueAt,
    status: nextDueAt ? "active" : "ended",
    updatedAt: now.toISOString(),
  };
}
