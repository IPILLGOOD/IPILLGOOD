import { dateKeyInSeoul, seoulDateRange } from "@care-atlas/backend/dates";
import type { DoseEvent, MedicationPlan, ObservationEvidence, SymptomEvent } from "@care-atlas/backend";

type Records = {
  medications: MedicationPlan[];
  doseEvents: DoseEvent[];
  symptomEvents: SymptomEvent[];
};

/** Read-only, inclusive Seoul calendar window. Never changes stored records. */
export function recentCareRecords(records: Records, now = new Date()) {
  const range = seoulDateRange(dateKeyInSeoul(now), 7);
  const inRange = (value: string) => {
    try {
      const date = dateKeyInSeoul(value);
      return date >= range.startDate && date <= range.endDate;
    } catch {
      // Legacy invalid dates cannot be assigned to a reporting period.
      return false;
    }
  };
  return {
    range,
    medications: records.medications.filter((item) => inRange(item.startDate)),
    doseEvents: records.doseEvents.filter((item) => inRange(item.scheduledAt)),
    symptomEvents: records.symptomEvents.filter((item) => inRange(item.occurredAt)),
  };
}

/** Existing response-only denominator; not an estimate of actual adherence. */
export function adherenceSummary(events: DoseEvent[]) {
  const answerable = events.filter((event) => event.response !== "not_yet");
  const confirmed = answerable.filter((event) => event.response === "completed").length;
  const rate = answerable.length === 0 ? null : Math.round((confirmed / answerable.length) * 100);
  return { confirmed, total: answerable.length, rate };
}

export function uniqueSymptomDays(events: SymptomEvent[]) {
  return new Set(events.map((event) => dateKeyInSeoul(event.occurredAt))).size;
}

export function observationEvidenceLabel(evidence: ObservationEvidence | undefined, role?: "caregiver" | "recipient") {
  const value = evidence ?? (role === "recipient" ? "self_reported" : "caregiver_observed");
  return {
    self_reported: "어르신 자가보고",
    caregiver_observed: "보호자 직접 관찰",
    relayed_confirmation: "보호자가 전달받아 확인",
    unconfirmed: "확인 불가",
  }[value];
}

export function observationEvidenceCounts(events: Array<DoseEvent | SymptomEvent>) {
  const counts = new Map<string, number>();
  for (const event of events) {
    const role = "answeredBy" in event
      ? event.answeredBy
      : event.actorRole ?? (event.reporterType === "recipient_reported" ? "recipient" : "caregiver");
    const label = observationEvidenceLabel(event.evidenceLevel, role);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([label, count]) => ({ label, count }));
}

export function careTimelineItems(medications: MedicationPlan[], symptoms: SymptomEvent[]) {
  const items = [
    ...medications.filter((medication) => medication.isNew).map((medication) => ({
      id: `medication-${medication.id}`,
      date: medication.startDate,
      title: `${medication.productName} 복용 시작`,
      detail: medication.sourceLabel,
    })),
    ...symptoms.map((symptom) => ({
      id: `symptom-${symptom.id}`,
      date: symptom.occurredAt,
      title: `${symptom.symptomType} ${symptom.severity}/10 기록`,
      detail: `${observationEvidenceLabel(symptom.evidenceLevel, symptom.actorRole ?? (symptom.reporterType === "recipient_reported" ? "recipient" : "caregiver"))} · ${symptom.dailyLifeImpact}`,
    })),
  ];
  const timestamp = (value: string) => Date.parse(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+09:00` : value,
  );
  return items.sort((a, b) => timestamp(b.date) - timestamp(a.date)).slice(0, 5);
}
