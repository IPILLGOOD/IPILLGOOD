import { SEOUL_TIME_ZONE, addCalendarDays, calendarDayDifference, dateKeyInSeoul, dateKeyInTimeZone, seoulTimeLabel } from "./dates.ts";
import { createHash } from "node:crypto";

import type { DoseEvent, MedicationPlan } from "./types.ts";

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
  intervalDays: number;
  startDate: string;
  endDate?: string;
  nextDueAt: string;
  timeZone: typeof MEDICATION_TIME_ZONE;
  status: "active" | "ended";
  updatedAt: string;
  planRevisionId?: string;
}

export function activeMedications(medications: MedicationPlan[]) {
  return medications.filter((medication) => medication.status === "active");
}

export function medicationFrequencyRule(frequency: string) {
  const normalized = frequency.trim();
  if (/(?:필요\s*시|필요할\s*때|증상\s*시|주\s*\d+회|매주|격주|요일)/.test(normalized)) return null;

  const dailyMatch = normalized.match(/^(?:하루|1일)\s*(\d+)회(?:\s*복용)?$/);
  if (dailyMatch) {
    const count = Number(dailyMatch[1]);
    return Number.isInteger(count) && count >= 1 && count <= 6
      ? { count, intervalDays: 1 }
      : null;
  }

  if (/^매일(?:\s*1회)?$/.test(normalized)) return { count: 1, intervalDays: 1 };

  const intervalMatch = normalized.match(/^(\d+)일\s*1회(?:\s*복용)?$/);
  if (intervalMatch) {
    const intervalDays = Number(intervalMatch[1]);
    return Number.isInteger(intervalDays) && intervalDays >= 1 && intervalDays <= 365
      ? { count: 1, intervalDays }
      : null;
  }

  // PRN, weekly and unknown text must never silently become a daily schedule.
  return null;
}

export { dateKeyInTimeZone } from "./dates.ts";

export function isMedicationDueOnDate(
  medication: Pick<MedicationPlan, "startDate" | "endDate">,
  dateKey: string,
  intervalDays: number,
) {
  if (medication.startDate > dateKey) return false;
  if (medication.endDate && medication.endDate < dateKey) return false;
  if (intervalDays === 1) return true;

  const elapsedDays = calendarDayDifference(medication.startDate, dateKey);
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
  intervalDays: number,
  after: Date,
) {
  const firstDate = dateKeyInTimeZone(after);
  for (let offset = 0; offset <= 366; offset += 1) {
    const dateKey = addCalendarDays(firstDate, offset);
    if (medication.endDate && dateKey > medication.endDate) return null;
    if (!isMedicationDueOnDate(medication, dateKey, intervalDays)) continue;
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
    const rule = medicationFrequencyRule(medication.frequency);
    if (!rule) continue;
    if (!isMedicationDueOnDate(medication, dateKey, rule.intervalDays)) continue;

    const slots = medicationTimingSlots(medication.timing, rule.count);
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
      const timeLabel = timeForMedicationSlot(slotLabel, slotIndex, rule.count);
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
    const rule = medicationFrequencyRule(medication.frequency);
    if (!rule) return [];
    const slots = medicationTimingSlots(medication.timing, rule.count);
    return slots.flatMap((slotLabel, slotIndex) => {
      const timeLabel = timeForMedicationSlot(slotLabel, slotIndex, rule.count);
      if (!timeLabel) return [];
      const nextDueAt = nextMedicationDueAt(medication, timeLabel, rule.intervalDays, now);
      if (!nextDueAt) return [];
      return [
        {
          id: reminderScheduleId(recipientId, medication.id, slotIndex),
          recipientId,
          medicationPlanId: medication.id,
          slotIndex,
          slotLabel,
          timeLabel,
          intervalDays: rule.intervalDays,
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
  const nextDueAt = nextMedicationDueAt(
    schedule,
    schedule.timeLabel,
    schedule.intervalDays,
    afterCurrentOccurrence,
  );
  return {
    ...schedule,
    nextDueAt: nextDueAt ?? schedule.nextDueAt,
    status: nextDueAt ? "active" : "ended",
    updatedAt: now.toISOString(),
  };
}
