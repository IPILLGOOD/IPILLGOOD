import { dateKeyInSeoul } from "./dates.ts";

import { applyObservationCheckIn, type ObservationCheckInInput } from "./observations.ts";
import type { CareSnapshot, DailyCheckIn, DoseEvent, SymptomEvent } from "./types.ts";

export const MAX_DOSE_EVENTS = 90;
export const MAX_SYMPTOM_EVENTS = 45;
export const MAX_DOCUMENTS = 10;

export type DailyCheckInInput = ObservationCheckInInput;

export { dateKeyInSeoul } from "./dates.ts";

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
  const update = applyObservationCheckIn(snapshot, input, now);
  return {
    ...update,
    doseEvents: update.nextSnapshot.doseEvents,
    symptomEvents: update.nextSnapshot.symptomEvents,
    replacedSymptomEvents: [] as SymptomEvent[],
  };
}
