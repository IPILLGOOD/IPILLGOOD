import assert from "node:assert/strict";
import test from "node:test";

import {
  getCareSnapshot,
  getObservationHistory,
  saveDailyCheckIn,
  saveWellbeingCheckIn,
  updateRecipientProfile,
} from "./care-repository.ts";
import {
  applyObservationCheckIn,
  projectDoseObservations,
  projectSymptomObservations,
} from "./observations.ts";
import { MemoryFirestore } from "../test-support/memory-firestore.ts";
import type { CareSnapshot, DoseEvent } from "./types.ts";

const existingDose: DoseEvent = {
  id: "2026-09-01-med-1-0800",
  medicationPlanId: "med-1",
  scheduledAt: "2026-09-01T08:00:00+09:00",
  response: "completed",
  answeredBy: "recipient",
  answeredAt: "2026-09-01T00:05:00.000Z",
};

function snapshot(): CareSnapshot {
  return {
    recipient: {
      id: "google-observation-user",
      displayName: "관찰 검증",
      ageBand: "75",
      allergies: [],
      conditions: [],
      mobilityNote: "",
      accessibilityPreferences: [],
      caregiverNote: "",
      consentConfirmed: true,
      lastConfirmedAt: "2026-09-01T00:00:00.000Z",
    },
    medications: [],
    doseEvents: [existingDose],
    symptomEvents: [],
    documents: [],
    clinicianQuestions: [],
    todayCheckIn: {
      id: "2026-09-01",
      completedAt: "2026-09-01T00:05:00.000Z",
      completedBy: "recipient",
      medicationResponses: [{ medicationPlanId: "med-1", scheduledAt: existingDose.scheduledAt, response: "completed" }],
      symptoms: [],
      note: "",
      medicationRecordedAt: "2026-09-01T00:05:00.000Z",
      medicationRecordedBy: "recipient",
      medicationEvidenceLevel: "self_reported",
    },
    dataSource: "firestore",
    revision: 0,
  };
}

const wellbeingInput = {
  doseResponses: [],
  symptoms: ["두통", "어지러움"],
  severity: 4,
  note: "오후에 잠시 쉬었어요.",
  actorId: "connected:caregiver-1",
  actorRole: "caregiver" as const,
  evidenceLevel: "relayed_confirmation" as const,
  inputSource: "quick_wellbeing" as const,
  idempotencyKey: "wellbeing-request-0001",
  scope: "wellbeing" as const,
};

test("빠른 안부는 복약 응답자·시각을 보존하고 같은 날 복수 증상을 개별 관찰로 만든다", () => {
  const before = snapshot();
  const update = applyObservationCheckIn(before, wellbeingInput, new Date("2026-09-01T06:30:00.000Z"));

  assert.deepEqual(update.nextSnapshot.doseEvents, before.doseEvents);
  assert.deepEqual(update.checkIn.medicationResponses, before.todayCheckIn?.medicationResponses);
  assert.equal(update.checkIn.medicationRecordedAt, before.todayCheckIn?.medicationRecordedAt);
  assert.equal(update.checkIn.medicationRecordedBy, "recipient");
  assert.equal(update.symptomObservations.length, 2);
  assert.deepEqual(new Set(update.symptomObservations.map((item) => item.symptomType)), new Set(["두통", "어지러움"]));
  assert.equal(update.symptomObservations.every((item) => item.occurredAt === "2026-09-01T06:30:00.000Z"), true);
  assert.equal(update.nextSnapshot.symptomEvents.every((item) => item.evidenceLevel === "relayed_confirmation"), true);
});

test("정정은 이전 관찰과 행위자·시각·사유를 남기고 projection에는 최신 값만 반영한다", () => {
  const first = applyObservationCheckIn(snapshot(), {
    ...wellbeingInput,
    symptoms: ["두통"],
  }, new Date("2026-09-01T06:30:00.000Z"));
  const second = applyObservationCheckIn(first.nextSnapshot, {
    ...wellbeingInput,
    symptoms: ["두통"],
    severity: 7,
    note: "다시 확인하니 일상에 영향이 있었어요.",
    evidenceLevel: "caregiver_observed",
    idempotencyKey: "wellbeing-request-0002",
    correctionReason: "보호자가 직접 다시 확인함",
  }, new Date("2026-09-01T07:00:00.000Z"));
  const history = [...first.symptomObservations, ...second.symptomObservations];
  const correction = second.symptomObservations[0]!;

  assert.equal(correction.supersedesObservationId, first.symptomObservations[0]?.id);
  assert.equal(correction.correctionReason, "보호자가 직접 다시 확인함");
  assert.equal(correction.actorId, "connected:caregiver-1");
  assert.equal(correction.recordedAt, "2026-09-01T07:00:00.000Z");
  assert.equal(projectSymptomObservations(history).length, 1);
  assert.equal(projectSymptomObservations(history)[0]?.severity, 7);
  assert.equal(history.length, 2);
});

test("동일 요청 ID는 동일 관찰 ID를 만들고 원장만으로 현재 projection을 재구축한다", () => {
  const stale = snapshot();
  const first = applyObservationCheckIn(stale, {
    ...wellbeingInput,
    scope: "full",
    inputSource: "daily_check_in",
    doseResponses: [{ medicationPlanId: "med-1", scheduledAt: existingDose.scheduledAt, response: "skipped" }],
    correctionReason: "실제 복용하지 않았다고 다시 확인함",
  }, new Date("2026-09-01T07:10:00.000Z"));
  const retry = applyObservationCheckIn(stale, {
    ...wellbeingInput,
    scope: "full",
    inputSource: "daily_check_in",
    doseResponses: [{ medicationPlanId: "med-1", scheduledAt: existingDose.scheduledAt, response: "skipped" }],
    correctionReason: "실제 복용하지 않았다고 다시 확인함",
  }, new Date("2026-09-01T07:10:00.000Z"));

  assert.deepEqual(retry.doseObservations, first.doseObservations);
  assert.equal(new Set(first.doseObservations.map((item) => item.id)).size, first.doseObservations.length);
  const rebuilt = projectDoseObservations(first.doseObservations);
  assert.equal(rebuilt.length, 1);
  assert.equal(rebuilt[0]?.response, "skipped");
  assert.equal(rebuilt[0]?.answeredBy, "caregiver");
});

test("저장소는 동일 빠른 안부 재시도를 중복 저장하지 않고 전체 정정 이력을 조회한다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-persisted-observations", firestore };
  const initial = await getCareSnapshot(scope);
  await updateRecipientProfile(scope, {
    ...initial.recipient,
    displayName: "관찰 저장 검증",
    ageBand: "75",
    consentConfirmed: true,
    profileCompletedAt: "2026-09-01T00:00:00.000Z",
    lastConfirmedAt: "2026-09-01T00:00:00.000Z",
  }, initial);
  const ready = await getCareSnapshot(scope);
  const input = {
    symptoms: ["두통", "어지러움"],
    severity: 4,
    note: "전달받아 기록",
    actorId: "connected:caregiver-2",
    actorRole: "caregiver" as const,
    evidenceLevel: "relayed_confirmation" as const,
    idempotencyKey: "persisted-wellbeing-request",
  };
  await saveWellbeingCheckIn(scope, input, ready, ready.revision);
  const after = await getCareSnapshot(scope);
  await saveWellbeingCheckIn(scope, input, after, after.revision);
  const history = await getObservationHistory(scope);

  assert.equal(history.doseObservations.length, 0);
  assert.equal(history.symptomObservations.length, 2);
  assert.equal((await getCareSnapshot(scope)).symptomEvents.length, 2);
  firestore.store.delete(`careReadModels/${scope.recipientId}`);
  const rebuilt = await getCareSnapshot(scope);
  assert.deepEqual(rebuilt.symptomEvents.map((item) => item.observationId).sort(), history.symptomObservations.map((item) => item.id).sort());
});

test("전체 체크인은 legacy event를 수정하지 않고 복약 정정을 append-only 원장에 누적한다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-full-observations", firestore };
  const initial = await getCareSnapshot(scope);
  await updateRecipientProfile(scope, {
    ...initial.recipient,
    displayName: "전체 관찰 검증",
    ageBand: "75",
    consentConfirmed: true,
    profileCompletedAt: "2026-09-01T00:00:00.000Z",
    lastConfirmedAt: "2026-09-01T00:00:00.000Z",
  }, initial);
  const questionSetId = "question-set-full-observations-20260901";
  await firestore.collection(`careRecipients/${scope.recipientId}/questionSets`).doc(questionSetId).set({ question_set_id: questionSetId });
  const response = {
    schema_version: "patient-question-response.v1" as const,
    response_id: "response-full-observations",
    question_set_id: questionSetId,
    subject_ref: scope.recipientId,
    answered_by: "recipient" as const,
    answered_at: "2026-09-01T00:10:00.000Z",
    timezone: "Asia/Seoul" as const,
    responses: [],
    triggered_by_response: [],
    source_refs: [{ source_type: "patient_question_set" as const, source_id: questionSetId }],
  };
  const base = {
    doseResponses: [{ medicationPlanId: "med-1", scheduledAt: existingDose.scheduledAt, response: "completed" as const }],
    symptoms: ["두통"],
    severity: 3,
    note: "직접 답함",
    actorId: "google:recipient-3",
    actorRole: "recipient" as const,
    evidenceLevel: "self_reported" as const,
    inputSource: "daily_check_in" as const,
    scope: "full" as const,
    questionResponse: response,
  };
  const ready = await getCareSnapshot(scope);
  await saveDailyCheckIn(scope, { ...base, idempotencyKey: "full-observation-first" }, ready, ready.revision);
  const afterFirst = await getCareSnapshot(scope);
  await saveDailyCheckIn(scope, {
    ...base,
    doseResponses: [{ ...base.doseResponses[0]!, response: "skipped" }],
    idempotencyKey: "full-observation-correction",
    correctionReason: "복용하지 않았다고 다시 확인함",
  }, afterFirst, afterFirst.revision);

  const history = await getObservationHistory(scope);
  assert.equal(history.doseObservations.length, 2);
  assert.equal(history.symptomObservations.length, 1);
  const corrected = history.doseObservations.find((item) => item.response === "skipped")!;
  const original = history.doseObservations.find((item) => item.response === "completed")!;
  assert.equal(corrected.supersedesObservationId, original.id);
  assert.equal(corrected.correctionReason, "복용하지 않았다고 다시 확인함");
  assert.equal(firestore.store.has(`careRecipients/${scope.recipientId}/doseEvents/${existingDose.id}`), false);
  assert.equal(firestore.store.has(`careRecipients/${scope.recipientId}/symptomEvents/legacy`), false);
  assert.equal((await getCareSnapshot(scope)).doseEvents[0]?.response, "skipped");
});
