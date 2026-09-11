export const medicationDoseQuantities = ["0.25", "0.5", "1", "1.5", "2", "3"] as const;
export const medicationDoseUnits = ["정", "캡슐", "포", "mL", "방울"] as const;

export const medicationFrequencyOptions = [
  { value: "하루 1회", label: "매일 · 하루 1회", slots: 1 },
  { value: "하루 2회", label: "매일 · 하루 2회", slots: 2 },
  { value: "하루 3회", label: "매일 · 하루 3회", slots: 3 },
  { value: "하루 4회", label: "매일 · 하루 4회", slots: 4 },
  { value: "2일 1회", label: "2일마다 1회", slots: 1 },
  { value: "3일 1회", label: "3일마다 1회", slots: 1 },
  { value: "매주 1회", label: "매주 1회 · 시작일과 같은 요일", slots: 1 },
  { value: "필요할 때", label: "필요할 때만 복용", slots: 0 },
] as const;

export const medicationTimingOptions = [
  { value: "기상 직후 06:30", label: "기상 직후 · 오전 6:30" },
  { value: "아침 식사 전 07:30", label: "아침 식사 전 · 오전 7:30" },
  { value: "아침 식사 후 08:30", label: "아침 식사 후 · 오전 8:30" },
  { value: "오전 09:00", label: "오전 · 오전 9:00" },
  { value: "점심 식사 전 12:00", label: "점심 식사 전 · 낮 12:00" },
  { value: "점심 식사 후 13:00", label: "점심 식사 후 · 오후 1:00" },
  { value: "저녁 식사 전 18:00", label: "저녁 식사 전 · 오후 6:00" },
  { value: "저녁 식사 후 19:00", label: "저녁 식사 후 · 오후 7:00" },
  { value: "자기 전 21:00", label: "자기 전 · 오후 9:00" },
  { value: "취침 직전 22:00", label: "취침 직전 · 오후 10:00" },
] as const;

const quantitySet = new Set<string>(medicationDoseQuantities);
const unitSet = new Set<string>(medicationDoseUnits);
const frequencyMap = new Map<string, number>(
  medicationFrequencyOptions.map((option) => [option.value, option.slots]),
);
const timingSet = new Set<string>(medicationTimingOptions.map((option) => option.value));

export type MedicationRegistrationSelection = {
  doseAmount: string;
  frequency: string;
  timing: string;
};

export function medicationSlotCount(frequency: string) {
  return frequencyMap.get(frequency) ?? null;
}

export function parseMedicationRegistrationSelection(input: {
  doseQuantity: string;
  doseUnit: string;
  frequency: string;
  timings: string[];
}): MedicationRegistrationSelection | null {
  const slots = medicationSlotCount(input.frequency);
  if (!quantitySet.has(input.doseQuantity) || !unitSet.has(input.doseUnit) || slots === null) {
    return null;
  }
  if (slots === 0) {
    return {
      doseAmount: `${input.doseQuantity}${input.doseUnit}`,
      frequency: input.frequency,
      timing: "증상이 있을 때",
    };
  }
  if (
    input.timings.length !== slots ||
    input.timings.some((timing) => !timingSet.has(timing)) ||
    new Set(input.timings).size !== input.timings.length
  ) {
    return null;
  }
  return {
    doseAmount: `${input.doseQuantity}${input.doseUnit}`,
    frequency: input.frequency,
    timing: input.timings.join("·"),
  };
}
