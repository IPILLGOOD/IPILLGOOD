import assert from "node:assert/strict";
import test from "node:test";

import {
  deleteDocumentAndSyncMedicationReminders,
  registerDocumentAndSyncMedicationReminders,
} from "./medication-reminder-service.ts";
import type { CareSnapshot, ClinicalDocument, MedicationPlan } from "./types.ts";

const medication: MedicationPlan = {
  id: "rx-new-1",
  productName: "신규 처방약",
  ingredientName: "테스트 성분",
  categoryPlain: "처방약",
  purposePlain: "테스트",
  descriptionPlain: "테스트",
  doseAmount: "1정",
  frequency: "하루 1회",
  timing: "아침 식사 후",
  startDate: "2026-08-24",
  status: "active",
  isNew: true,
  sourceLabel: "테스트",
  watchFor: [],
};

function snapshot(medications: MedicationPlan[]): CareSnapshot {
  return {
    recipient: {
      id: "recipient-new",
      displayName: "신규 사용자",
      ageBand: "67",
      allergies: [],
      conditions: [],
      mobilityNote: "",
      accessibilityPreferences: [],
      caregiverNote: "",
      consentConfirmed: true,
      lastConfirmedAt: "2026-08-24T00:00:00.000Z",
    },
    medications,
    doseEvents: [],
    symptomEvents: [],
    documents: [],
    clinicianQuestions: [],
    todayCheckIn: null,
    dataSource: "firestore",
  };
}

test("처방전 등록 직후 최신 복약 목록으로 알림 일정을 자동 동기화한다", async () => {
  const calls: string[] = [];
  let syncAttempts = 0;
  const document = {
    id: "document-new",
    fileName: "prescription.png",
    documentType: "처방전",
    uploadedAt: "2026-08-24T00:00:00.000Z",
    status: "confirmed",
    redacted: false,
    sourceLabel: "테스트",
    size: 100,
  } satisfies ClinicalDocument & { size: number };

  const result = await registerDocumentAndSyncMedicationReminders(
    { recipientId: "recipient-new" },
    {
      fileName: "prescription.png",
      contentHash: "content-hash-new",
      documentType: "처방전",
      size: 100,
      isSample: false,
      analysis: null,
    },
    {
      async registerDocument() {
        calls.push("register");
        return document;
      },
      async getCareSnapshot() {
        calls.push("snapshot");
        return snapshot([medication]);
      },
      async deleteDocument() {
        throw new Error("성공 경로에서는 rollback을 호출하면 안 됩니다.");
      },
      async syncMedicationReminderSchedules(input) {
        calls.push("sync");
        syncAttempts += 1;
        assert.equal(input.recipientId, "recipient-new");
        assert.deepEqual(input.medications, [medication]);
        if (syncAttempts === 1) throw new Error("일시적인 Firestore 오류");
      },
    },
  );

  assert.equal(result, document);
  assert.deepEqual(calls, ["snapshot", "register", "snapshot", "sync", "sync"]);
});

test("동일한 content hash 문서는 다시 등록하거나 일정을 동기화하지 않는다", async () => {
  const existingDocument = {
    id: "document-existing",
    fileName: "prescription.png",
    contentHash: "content-hash-existing",
    documentType: "처방전",
    uploadedAt: "2026-08-24T00:00:00.000Z",
    status: "confirmed",
    redacted: false,
    sourceLabel: "테스트",
  } satisfies ClinicalDocument;
  const existingSnapshot = snapshot([medication]);
  existingSnapshot.documents = [existingDocument];

  const result = await registerDocumentAndSyncMedicationReminders(
    { recipientId: "recipient-new" },
    {
      fileName: "prescription.png",
      contentHash: "content-hash-existing",
      documentType: "처방전",
      size: 321,
      isSample: false,
      analysis: null,
    },
    {
      async getCareSnapshot() {
        return existingSnapshot;
      },
      async registerDocument() {
        throw new Error("중복 문서를 다시 등록하면 안 됩니다.");
      },
      async deleteDocument() {
        throw new Error("중복 문서를 삭제하면 안 됩니다.");
      },
      async syncMedicationReminderSchedules() {
        throw new Error("중복 요청에서 일정을 다시 동기화하면 안 됩니다.");
      },
    },
  );

  assert.equal(result.id, existingDocument.id);
  assert.equal(result.size, 321);
});

test("알림 동기화가 실패해도 저장된 문서를 삭제하지 않고 복구 작업에 맡긴다", async () => {
  const document = { id: "kept", fileName: "kept.pdf", documentType: "처방전" as const, uploadedAt: "2026-08-24T00:00:00.000Z", status: "confirmed" as const, redacted: false, sourceLabel: "테스트", size: 100 };
  let attempts = 0;
  const result = await registerDocumentAndSyncMedicationReminders(
    { recipientId: "recipient-new" },
    { fileName: "kept.pdf", contentHash: "kept", documentType: "처방전", size: 100, isSample: true, analysis: null },
    {
      async getCareSnapshot() { return snapshot([medication]); },
      async registerDocument() { return document; },
      async deleteDocument() { throw new Error("다른 정상 요청의 문서를 rollback하면 안 됩니다."); },
      async syncMedicationReminderSchedules() { attempts++; throw new Error("INJECTED_SYNC_FAILURE"); },
    },
  );
  assert.equal(result.id, "kept");
  assert.equal(attempts, 2);
});

test("처방전 삭제 후 남은 복약 목록으로 알림 일정을 종료·재동기화한다", async () => {
  const syncInputs: MedicationPlan[][] = [];
  await deleteDocumentAndSyncMedicationReminders(
    { recipientId: "recipient-new" },
    "document-old",
    snapshot([medication]),
    {
      async deleteDocument(_scope, documentId) {
        assert.equal(documentId, "document-old");
        return snapshot([]);
      },
      async syncMedicationReminderSchedules(input) {
        syncInputs.push(input.medications);
      },
    },
  );

  assert.deepEqual(syncInputs, [[]]);
});
