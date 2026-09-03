import { createHash } from "node:crypto";

import { dateKeyInSeoul } from "./dates.ts";
import type {
  CareSnapshot,
  DailyCheckIn,
  DoseEvent,
  DoseObservation,
  ObservationActorRole,
  ObservationEvidence,
  ObservationInputSource,
  SymptomEvent,
  SymptomObservation,
} from "./types.ts";

export type ObservationCheckInScope = "full" | "wellbeing";

export interface ObservationCheckInInput {
  doseResponses: Array<Pick<DoseEvent, "medicationPlanId" | "response" | "scheduledAt">>;
  symptoms: string[];
  severity: number;
  note: string;
  actorId: string;
  actorRole: ObservationActorRole;
  evidenceLevel: ObservationEvidence;
  inputSource: Exclude<ObservationInputSource, "correction" | "legacy_import">;
  idempotencyKey: string;
  correctionReason?: string;
  scope: ObservationCheckInScope;
}

export interface DoseResponseObservationInput {
  doseResponse: Pick<DoseEvent, "medicationPlanId" | "response" | "scheduledAt">;
  actorId: string;
  actorRole: ObservationActorRole;
  evidenceLevel: ObservationEvidence;
  idempotencyKey: string;
  correctionReason?: string;
}

const observationId = (kind: "dose" | "symptom", key: string, identity: string) =>
  `${kind}-observation-${createHash("sha256").update(`${key}:${identity}`).digest("hex").slice(0, 32)}`;

export function doseOccurrenceKey(event: Pick<DoseEvent | DoseObservation, "medicationPlanId" | "scheduledAt">) {
  return `${event.medicationPlanId}\u0000${event.scheduledAt}`;
}

export function symptomOccurrenceKey(event: Pick<SymptomEvent | SymptomObservation, "symptomType" | "occurredAt">) {
  return `${event.symptomType}\u0000${event.occurredAt}`;
}

function newest<T extends { id: string; recordedAt: string }>(left: T, right: T) {
  return left.recordedAt === right.recordedAt
    ? (left.id.localeCompare(right.id) < 0 ? right : left)
    : (left.recordedAt < right.recordedAt ? right : left);
}

function currentObservations<T extends { id: string; recordedAt: string; supersedesObservationId?: string }>(observations: T[]) {
  const superseded = new Set(observations.flatMap((item) => item.supersedesObservationId ? [item.supersedesObservationId] : []));
  return observations.filter((item) => !superseded.has(item.id));
}

export function projectDoseObservations(observations: DoseObservation[], legacy: DoseEvent[] = []) {
  const projected = new Map<string, DoseObservation>();
  for (const observation of currentObservations(observations)) {
    const key = doseOccurrenceKey(observation);
    projected.set(key, projected.has(key) ? newest(projected.get(key)!, observation) : observation);
  }
  const observedKeys = new Set(observations.map(doseOccurrenceKey));
  return [
    ...[...projected.values()].map((observation): DoseEvent => ({
      id: doseEventId(observation),
      medicationPlanId: observation.medicationPlanId,
      scheduledAt: observation.scheduledAt,
      response: observation.response,
      ...(observation.nonAdherenceReason ? { nonAdherenceReason: observation.nonAdherenceReason } : {}),
      answeredBy: observation.actorRole,
      answeredAt: observation.recordedAt,
      observationId: observation.id,
      occurredAt: observation.occurredAt,
      recordedAt: observation.recordedAt,
      actorId: observation.actorId,
      evidenceLevel: observation.evidenceLevel,
      inputSource: observation.inputSource,
      ...(observation.supersedesObservationId ? { supersedesObservationId: observation.supersedesObservationId } : {}),
      ...(observation.correctionReason ? { correctionReason: observation.correctionReason } : {}),
    })),
    ...legacy.filter((event) => !observedKeys.has(doseOccurrenceKey(event))),
  ].sort((left, right) => right.scheduledAt.localeCompare(left.scheduledAt));
}

export function projectSymptomObservations(observations: SymptomObservation[], legacy: SymptomEvent[] = []) {
  const projected = new Map<string, SymptomObservation>();
  for (const observation of currentObservations(observations)) {
    const key = symptomOccurrenceKey(observation);
    projected.set(key, projected.has(key) ? newest(projected.get(key)!, observation) : observation);
  }
  const observedKeys = new Set(observations.map(symptomOccurrenceKey));
  return [
    ...[...projected.values()].filter((observation) => observation.status === "observed").map((observation): SymptomEvent => ({
      id: observation.id,
      symptomType: observation.symptomType,
      occurredAt: observation.occurredAt,
      severity: observation.severity,
      dailyLifeImpact: observation.dailyLifeImpact,
      reporterType: observation.actorRole === "recipient" ? "recipient_reported" : "caregiver_observed",
      ...(observation.note ? { note: observation.note } : {}),
      observationId: observation.id,
      recordedAt: observation.recordedAt,
      actorId: observation.actorId,
      actorRole: observation.actorRole,
      evidenceLevel: observation.evidenceLevel,
      inputSource: observation.inputSource,
      ...(observation.supersedesObservationId ? { supersedesObservationId: observation.supersedesObservationId } : {}),
      ...(observation.correctionReason ? { correctionReason: observation.correctionReason } : {}),
    })),
    ...legacy.filter((event) => !observedKeys.has(symptomOccurrenceKey(event))),
  ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

function doseEventId(event: Pick<DoseObservation, "medicationPlanId" | "scheduledAt">) {
  const date = dateKeyInSeoul(event.scheduledAt);
  const medication = event.medicationPlanId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(event.scheduledAt)).replace(":", "");
  return `${date}-${medication}-${time}`;
}

function inferredEvidence(event: DoseEvent | SymptomEvent): ObservationEvidence {
  if (event.evidenceLevel) return event.evidenceLevel;
  if ("answeredBy" in event) return event.answeredBy === "recipient" ? "self_reported" : "caregiver_observed";
  return event.reporterType === "recipient_reported" ? "self_reported" : "caregiver_observed";
}

function legacyDoseObservation(event: DoseEvent): DoseObservation {
  const id = event.observationId ?? observationId("dose", `legacy:${event.id}`, doseOccurrenceKey(event));
  return {
    id,
    kind: "dose",
    medicationPlanId: event.medicationPlanId,
    scheduledAt: event.scheduledAt,
    occurredAt: event.occurredAt ?? event.scheduledAt,
    recordedAt: event.recordedAt ?? event.answeredAt ?? event.scheduledAt,
    actorId: event.actorId ?? "legacy:unknown",
    actorRole: event.answeredBy,
    evidenceLevel: inferredEvidence(event),
    inputSource: event.inputSource ?? "legacy_import",
    idempotencyKey: `legacy:${event.id}`,
    response: event.response,
    ...(event.nonAdherenceReason ? { nonAdherenceReason: event.nonAdherenceReason } : {}),
  };
}

function legacySymptomObservation(event: SymptomEvent): SymptomObservation {
  const id = event.observationId ?? observationId("symptom", `legacy:${event.id}`, symptomOccurrenceKey(event));
  const actorRole = event.actorRole ?? (event.reporterType === "recipient_reported" ? "recipient" : "caregiver");
  return {
    id,
    kind: "symptom",
    symptomType: event.symptomType,
    occurredAt: event.occurredAt,
    recordedAt: event.recordedAt ?? event.occurredAt,
    actorId: event.actorId ?? "legacy:unknown",
    actorRole,
    evidenceLevel: inferredEvidence(event),
    inputSource: event.inputSource ?? "legacy_import",
    idempotencyKey: `legacy:${event.id}`,
    severity: event.severity,
    dailyLifeImpact: event.dailyLifeImpact,
    ...(event.note ? { note: event.note } : {}),
    status: "observed",
  };
}

function correctionReason(input: ObservationCheckInInput) {
  return input.correctionReason?.trim() || "기존 기록을 다시 확인해 갱신함";
}

function sameDose(event: DoseEvent, input: ObservationCheckInInput, response: ObservationCheckInInput["doseResponses"][number]) {
  const evidence = response.response === "unconfirmed" ? "unconfirmed" : input.evidenceLevel;
  return event.response === response.response && event.answeredBy === input.actorRole &&
    event.actorId === input.actorId && inferredEvidence(event) === evidence;
}

/** Records or corrects one dose occurrence without changing today's wellbeing check-in. */
export function applyDoseResponseObservation(
  snapshot: CareSnapshot,
  input: DoseResponseObservationInput,
  now = new Date(),
) {
  if (!/^[^/]{8,256}$/.test(input.idempotencyKey)) throw new Error("OBSERVATION_IDEMPOTENCY_KEY_REQUIRED");
  if (!/^[^/]{1,256}$/.test(input.actorId)) throw new Error("OBSERVATION_ACTOR_REQUIRED");
  const response = input.doseResponse;
  const current = snapshot.doseEvents.find((event) => doseOccurrenceKey(event) === doseOccurrenceKey(response));
  const recordedAt = now.toISOString();
  const evidenceLevel = response.response === "unconfirmed" ? "unconfirmed" : input.evidenceLevel;
  let supersedesObservationId: string | undefined;
  const doseObservations: DoseObservation[] = [];

  if (current) {
    const previous = legacyDoseObservation(current);
    supersedesObservationId = previous.id;
    if (!current.observationId) doseObservations.push(previous);
  }

  doseObservations.push({
    id: observationId("dose", input.idempotencyKey, doseOccurrenceKey(response)),
    kind: "dose",
    medicationPlanId: response.medicationPlanId,
    scheduledAt: response.scheduledAt,
    occurredAt: response.scheduledAt,
    recordedAt,
    actorId: input.actorId,
    actorRole: input.actorRole,
    evidenceLevel,
    inputSource: supersedesObservationId ? "correction" : "daily_check_in",
    idempotencyKey: input.idempotencyKey,
    response: response.response,
    ...(supersedesObservationId ? {
      supersedesObservationId,
      correctionReason: input.correctionReason?.trim() || "지난 복약 기록을 다시 확인해 수정함",
    } : {}),
  });

  return {
    doseObservations,
    nextSnapshot: {
      ...snapshot,
      doseEvents: projectDoseObservations(doseObservations, snapshot.doseEvents),
    },
  };
}

function sameSymptom(event: SymptomEvent, input: ObservationCheckInInput) {
  return event.severity === input.severity && (event.note ?? "") === input.note &&
    (event.actorRole ?? (event.reporterType === "recipient_reported" ? "recipient" : "caregiver")) === input.actorRole &&
    event.actorId === input.actorId &&
    inferredEvidence(event) === input.evidenceLevel;
}

export function applyObservationCheckIn(
  snapshot: CareSnapshot,
  input: ObservationCheckInInput,
  now = new Date(),
) {
  if (!/^[^/]{8,256}$/.test(input.idempotencyKey)) throw new Error("OBSERVATION_IDEMPOTENCY_KEY_REQUIRED");
  if (!/^[^/]{1,256}$/.test(input.actorId)) throw new Error("OBSERVATION_ACTOR_REQUIRED");
  const recordedAt = now.toISOString();
  const today = dateKeyInSeoul(now);
  const doseObservations: DoseObservation[] = [];
  const symptomObservations: SymptomObservation[] = [];

  if (input.scope === "full") for (const response of input.doseResponses) {
    const current = snapshot.doseEvents.find((event) => doseOccurrenceKey(event) === doseOccurrenceKey(response));
    if (current?.observationId && sameDose(current, input, response)) continue;
    let supersedesObservationId: string | undefined;
    if (current) {
      const previous = legacyDoseObservation(current);
      supersedesObservationId = previous.id;
      if (!current.observationId) doseObservations.push(previous);
    }
    doseObservations.push({
      id: observationId("dose", input.idempotencyKey, doseOccurrenceKey(response)),
      kind: "dose",
      medicationPlanId: response.medicationPlanId,
      scheduledAt: response.scheduledAt,
      occurredAt: response.scheduledAt,
      recordedAt,
      actorId: input.actorId,
      actorRole: input.actorRole,
      evidenceLevel: response.response === "unconfirmed" ? "unconfirmed" : input.evidenceLevel,
      inputSource: supersedesObservationId ? "correction" : input.inputSource,
      idempotencyKey: input.idempotencyKey,
      response: response.response,
      ...(supersedesObservationId ? { supersedesObservationId, correctionReason: correctionReason(input) } : {}),
    });
  }

  const selectedSymptoms = new Set(input.symptoms);
  const todaySymptoms = snapshot.symptomEvents.filter((event) => dateKeyInSeoul(event.occurredAt) === today);
  for (const symptomType of selectedSymptoms) {
    const current = todaySymptoms.filter((event) => event.symptomType === symptomType)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0];
    if (current?.observationId && sameSymptom(current, input)) continue;
    let supersedesObservationId: string | undefined;
    let occurredAt = recordedAt;
    if (current) {
      const previous = legacySymptomObservation(current);
      supersedesObservationId = previous.id;
      occurredAt = previous.occurredAt;
      if (!current.observationId) symptomObservations.push(previous);
    }
    symptomObservations.push({
      id: observationId("symptom", input.idempotencyKey, `observed:${symptomType}:${supersedesObservationId ?? occurredAt}`),
      kind: "symptom",
      symptomType,
      occurredAt,
      recordedAt,
      actorId: input.actorId,
      actorRole: input.actorRole,
      evidenceLevel: input.evidenceLevel,
      inputSource: supersedesObservationId ? "correction" : input.inputSource,
      idempotencyKey: input.idempotencyKey,
      severity: input.severity,
      dailyLifeImpact: input.note || "일상 영향은 기록하지 않았어요.",
      ...(input.note ? { note: input.note } : {}),
      status: "observed",
      ...(supersedesObservationId ? { supersedesObservationId, correctionReason: correctionReason(input) } : {}),
    });
  }
  for (const current of todaySymptoms.filter((event) => !selectedSymptoms.has(event.symptomType))) {
    const previous = legacySymptomObservation(current);
    if (!current.observationId) symptomObservations.push(previous);
    symptomObservations.push({
      ...previous,
      id: observationId("symptom", input.idempotencyKey, `retracted:${previous.id}`),
      recordedAt,
      actorId: input.actorId,
      actorRole: input.actorRole,
      evidenceLevel: input.evidenceLevel,
      inputSource: "correction",
      idempotencyKey: input.idempotencyKey,
      status: "retracted",
      supersedesObservationId: previous.id,
      correctionReason: correctionReason(input),
    });
  }

  const doseEvents = input.scope === "wellbeing"
    ? snapshot.doseEvents
    : projectDoseObservations(doseObservations, snapshot.doseEvents);
  const symptomEvents = projectSymptomObservations(symptomObservations, snapshot.symptomEvents);
  const prior = snapshot.todayCheckIn;
  const checkIn: DailyCheckIn = {
    id: today,
    completedAt: recordedAt,
    completedBy: input.scope === "wellbeing" && prior ? prior.completedBy : input.actorRole,
    medicationResponses: input.scope === "wellbeing" ? prior?.medicationResponses ?? [] : input.doseResponses,
    symptoms: input.symptoms,
    severity: input.symptoms.length ? input.severity : 0,
    note: input.note,
    evidenceLevel: input.evidenceLevel,
    ...(input.scope === "full" ? {
      medicationRecordedAt: recordedAt,
      medicationRecordedBy: input.actorRole,
      medicationEvidenceLevel: input.evidenceLevel,
    } : prior?.medicationRecordedAt ? {
      medicationRecordedAt: prior.medicationRecordedAt,
      medicationRecordedBy: prior.medicationRecordedBy,
      medicationEvidenceLevel: prior.medicationEvidenceLevel,
    } : {}),
    wellbeingRecordedAt: recordedAt,
    wellbeingRecordedBy: input.actorRole,
    wellbeingEvidenceLevel: input.evidenceLevel,
    ...(input.correctionReason?.trim() ? { correctionReason: input.correctionReason.trim() } : {}),
    ...(prior?.questionSetId ? { questionSetId: prior.questionSetId } : {}),
    ...(prior?.questionResponseId ? { questionResponseId: prior.questionResponseId } : {}),
  };
  return {
    doseObservations,
    symptomObservations,
    nextSnapshot: { ...snapshot, doseEvents, symptomEvents, todayCheckIn: checkIn },
    checkIn,
  };
}
