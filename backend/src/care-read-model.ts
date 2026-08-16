import { createHash } from "node:crypto";

import type { CareSnapshot, DailyCheckIn, DoseEvent, SymptomEvent } from "./types.ts";

export const MAX_DOSE_EVENTS = 90;
export const MAX_SYMPTOM_EVENTS = 45;
export const MAX_DOCUMENTS = 10;

export interface DailyCheckInInput {
  doseResponses: Array<Pick<DoseEvent, "medicationPlanId" | "response" | "scheduledAt">>;
  symptoms: string[];
  severity: number;
  note: string;
  answeredBy: "caregiver" | "recipient";
}

export function dateKeyInSeoul(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export function currentDailyCheckIn(
  checkIn: DailyCheckIn | null | undefined,
  now = new Date(),
) {
  return checkIn?.id === dateKeyInSeoul(now) ? checkIn : null;
}

export function byDateDescending<T>(field: keyof T) {
  return (a: T, b: T) =>
    String(b[field]).localeCompare(String(a[field]));
}

export function applyDailyCheckInToSnapshot(
  snapshot: CareSnapshot,
  input: DailyCheckInInput,
  now = new Date(),
) {
  const nowIso = now.toISOString();
  const dateKey = dateKeyInSeoul(now);
  const doseEvents = input.doseResponses.map((response) => {
    const medicationKey = response.medicationPlanId.replace(/[^a-zA-Z0-9_-]/g, "-");
    const timeKey = response.scheduledAt.slice(11, 16).replace(":", "");
    return {
      id: `${dateKey}-${medicationKey}-${timeKey}`,
      medicationPlanId: response.medicationPlanId,
      scheduledAt: response.scheduledAt,
      response: response.response,
      answeredBy: input.answeredBy,
      answeredAt: nowIso,
    } satisfies DoseEvent;
  });
  const doseEventIds = new Set(doseEvents.map((event) => event.id));
  const replacedSymptomEvents = snapshot.symptomEvents.filter(
    (event) => dateKeyInSeoul(new Date(event.occurredAt)) === dateKey,
  );
  const symptomEvents = input.symptoms.map((symptom) => {
    const symptomKey = createHash("sha256").update(symptom).digest("hex").slice(0, 12);
    return {
      id: `${dateKey}-${symptomKey}`,
      symptomType: symptom,
      occurredAt: nowIso,
      severity: input.severity,
      dailyLifeImpact: input.note || "일상 영향은 기록하지 않았어요.",
      reporterType:
        input.answeredBy === "caregiver"
          ? "caregiver_observed"
          : "recipient_reported",
      note: input.note,
    } satisfies SymptomEvent;
  });
  const checkIn = {
    id: dateKey,
    completedAt: nowIso,
    completedBy: input.answeredBy,
    medicationResponses: input.doseResponses,
    symptoms: input.symptoms,
    severity: input.severity,
    note: input.note,
  } satisfies DailyCheckIn;

  const nextSnapshot: CareSnapshot = {
    ...snapshot,
    doseEvents: [
      ...doseEvents,
      ...snapshot.doseEvents.filter((event) => !doseEventIds.has(event.id)),
    ]
      .sort(byDateDescending<DoseEvent>("scheduledAt"))
      .slice(0, MAX_DOSE_EVENTS),
    symptomEvents: [
      ...symptomEvents,
      ...snapshot.symptomEvents.filter(
        (event) => dateKeyInSeoul(new Date(event.occurredAt)) !== dateKey,
      ),
    ]
      .sort(byDateDescending<SymptomEvent>("occurredAt"))
      .slice(0, MAX_SYMPTOM_EVENTS),
    todayCheckIn: checkIn,
  };

  return { nextSnapshot, checkIn, doseEvents, symptomEvents, replacedSymptomEvents };
}
