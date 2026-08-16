import type { DoseEvent, MedicationPlan, SymptomEvent } from "@care-atlas/backend";

export interface MedicationScheduleTask {
  id: string;
  medicationPlanId: string;
  productName: string;
  doseAmount: string;
  frequency: string;
  timing: string;
  slotLabel: string;
  timeLabel: string;
  scheduledAt: string;
  response: DoseEvent["response"];
}

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

function dateKeyInSeoul(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function frequencyRule(frequency: string) {
  const dailyMatch = frequency.match(/(?:하루|1일)\s*(\d+)회/);
  if (dailyMatch) return { count: Number(dailyMatch[1]), intervalDays: 1 };

  const intervalMatch = frequency.match(/(\d+)일\s*1회/);
  if (intervalMatch) return { count: 1, intervalDays: Number(intervalMatch[1]) };

  return { count: 1, intervalDays: 1 };
}

function isDueOnDate(medication: MedicationPlan, dateKey: string, intervalDays: number) {
  if (medication.startDate > dateKey) return false;
  if (medication.endDate && medication.endDate < dateKey) return false;
  if (intervalDays === 1) return true;

  const start = new Date(`${medication.startDate}T00:00:00+09:00`).getTime();
  const target = new Date(`${dateKey}T00:00:00+09:00`).getTime();
  const elapsedDays = Math.floor((target - start) / 86_400_000);
  return elapsedDays % intervalDays === 0;
}

function timeForSlot(label: string, index: number, count: number) {
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

function timingSlots(timing: string, count: number) {
  const pieces = timing
    .split(/[·,/]/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (pieces.length === count) return pieces;
  if (count === 1) return [timing];
  return Array.from({ length: count }, (_, index) => `${index + 1}번째 복용`);
}

export function createMedicationSchedule(
  medications: MedicationPlan[],
  events: DoseEvent[] = [],
  date = new Date(),
): MedicationScheduleTask[] {
  const dateKey = dateKeyInSeoul(date);
  const tasks: MedicationScheduleTask[] = [];

  for (const medication of activeMedications(medications)) {
    const rule = frequencyRule(medication.frequency);
    if (!isDueOnDate(medication, dateKey, rule.intervalDays)) continue;

    const slots = timingSlots(medication.timing, rule.count);
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

    slots.forEach((slotLabel, index) => {
      const timeLabel = timeForSlot(slotLabel, index, rule.count);
      const scheduledAt = `${dateKey}T${timeLabel}:00+09:00`;
      const exactEvent = eventsForMedication.find(
        (event) => event.scheduledAt.slice(11, 16) === timeLabel,
      );

      tasks.push({
        id: `${medication.id}__${index}`,
        medicationPlanId: medication.id,
        productName: medication.productName,
        doseAmount: medication.doseAmount,
        frequency: medication.frequency,
        timing: medication.timing,
        slotLabel,
        timeLabel,
        scheduledAt,
        response: exactEvent?.response ?? "not_yet",
      });
    });
  }

  return tasks.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}
