import { createHash } from "node:crypto";

import type { DoseEvent, MedicationPlan } from "./types.ts";

export const MEDICATION_TIME_ZONE = "Asia/Seoul" as const;

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
  const dailyMatch = frequency.match(/(?:하루|1일)\s*(\d+)회/);
  if (dailyMatch) {
    return { count: Math.max(1, Number(dailyMatch[1])), intervalDays: 1 };
  }

  const intervalMatch = frequency.match(/(\d+)일\s*1회/);
  if (intervalMatch) {
    return { count: 1, intervalDays: Math.max(1, Number(intervalMatch[1])) };
  }

  return { count: 1, intervalDays: 1 };
}

export function dateKeyInTimeZone(date: Date, timeZone = MEDICATION_TIME_ZONE) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function isMedicationDueOnDate(
  medication: Pick<MedicationPlan, "startDate" | "endDate">,
  dateKey: string,
  intervalDays: number,
) {
  if (medication.startDate > dateKey) return false;
  if (medication.endDate && medication.endDate < dateKey) return false;
  if (intervalDays === 1) return true;

  const start = new Date(`${medication.startDate}T00:00:00+09:00`).getTime();
  const target = new Date(`${dateKey}T00:00:00+09:00`).getTime();
  const elapsedDays = Math.floor((target - start) / 86_400_000);
  return elapsedDays >= 0 && elapsedDays % intervalDays === 0;
}

export function timeForMedicationSlot(label: string, index: number, count: number) {
  if (label.includes("아침")) return "08:00";
  if (label.includes("점심")) return "13:00";
  if (label.includes("저녁")) return "19:00";
  if (label.includes("취침") || label.includes("자기 전")) return "21:00";

  const defaults: Record<number, string[]> = {
    1: ["09:00"],
    2: ["08:00", "19:00"],
    3: ["08:00", "13:00", "19:00"],
    4: ["08:00", "12:00", "16:00", "20:00"],
  };
  return defaults[count]?.[index] ?? `${String(8 + index * 4).padStart(2, "0")}:00`;
}

export function medicationTimingSlots(timing: string, count: number) {
  const pieces = timing
    .split(/[·,/]/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (pieces.length === count) return pieces;
  if (count === 1) return [timing];
  return Array.from({ length: count }, (_, index) => `${index + 1}번째 복용`);
}

function isoAtSeoulTime(dateKey: string, timeLabel: string) {
  return `${dateKey}T${timeLabel}:00+09:00`;
}

function addDays(dateKey: string, days: number) {
  const timestamp = new Date(`${dateKey}T00:00:00+09:00`).getTime() + days * 86_400_000;
  return dateKeyInTimeZone(new Date(timestamp));
}

export function nextMedicationDueAt(
  medication: Pick<MedicationPlan, "startDate" | "endDate">,
  timeLabel: string,
  intervalDays: number,
  after: Date,
) {
  const firstDate = dateKeyInTimeZone(after);
  for (let offset = 0; offset <= 366; offset += 1) {
    const dateKey = addDays(firstDate, offset);
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
    if (!isMedicationDueOnDate(medication, dateKey, rule.intervalDays)) continue;

    const slots = medicationTimingSlots(medication.timing, rule.count);
    const eventsForMedication = events
      .filter(
        (event) =>
          event.medicationPlanId === medication.id && event.scheduledAt.slice(0, 10) === dateKey,
      )
      .sort((a, b) =>
        String(b.answeredAt ?? b.scheduledAt).localeCompare(
          String(a.answeredAt ?? a.scheduledAt),
        ),
      );

    slots.forEach((slotLabel, slotIndex) => {
      const timeLabel = timeForMedicationSlot(slotLabel, slotIndex, rule.count);
      const scheduledAt = isoAtSeoulTime(dateKey, timeLabel);
      const exactEvent = eventsForMedication.find(
        (event) => event.scheduledAt.slice(11, 16) === timeLabel,
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
    const slots = medicationTimingSlots(medication.timing, rule.count);
    return slots.flatMap((slotLabel, slotIndex) => {
      const timeLabel = timeForMedicationSlot(slotLabel, slotIndex, rule.count);
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
