import assert from "node:assert/strict";
import test from "node:test";

import demoSeed from "./data/demo-seed.json" with { type: "json" };
import {
  applyDailyCheckInToSnapshot,
  currentDailyCheckIn,
} from "./care-read-model.ts";
import {
  createInitialCareSnapshot,
  cancelMedicationPlanDraft,
  confirmMedicationPlanDraft,
  getMedicationPlanDraft,
  medicationPlansFromPrescription,
  getCareSnapshot,
  registerDocument,
  updateRecipientProfile,
  rebuildCareReadModel,
  deleteDocument,
} from "./care-repository.ts";
import { MemoryFirestore } from "../test-support/memory-firestore.ts";
import type { CareSnapshot } from "./types.ts";

const snapshot = {
  ...demoSeed,
  todayCheckIn: null,
  dataSource: "firestore",
} as CareSnapshot;

test("신규 계정은 계정별 ID를 사용하고 데모 돌봄 기록을 복사하지 않는다", () => {
  const first = createInitialCareSnapshot({ recipientId: "google-account-a" });
  const second = createInitialCareSnapshot({ recipientId: "google-account-b" });

  assert.equal(first.recipient.id, "google-account-a");
  assert.equal(second.recipient.id, "google-account-b");
  assert.equal(first.recipient.consentConfirmed, false);
  assert.deepEqual(first.medications, []);
  assert.deepEqual(first.doseEvents, []);
  assert.deepEqual(first.symptomEvents, []);
  assert.deepEqual(first.documents, []);
  assert.notEqual(first.recipient.id, second.recipient.id);
});

const upload = (id: string) => ({ fileName: `${id}.pdf`, contentHash: id, documentType: "진단서" as const, size: 100, isSample: true, analysis: null });

test("서로 다른 문서의 동시 등록과 오래된 프로필 저장이 기존 데이터를 덮어쓰지 않는다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-concurrent", firestore };
  const original = await getCareSnapshot(scope);
  await Promise.all([registerDocument(scope, upload("a")), registerDocument(scope, upload("b"))]);
  await updateRecipientProfile(scope, { ...original.recipient, displayName: "수정된 이름" }, original);
  const result = await getCareSnapshot(scope);
  assert.deepEqual(result.documents.map((item) => item.id).sort(), ["a", "b"]);
  assert.equal(result.recipient.displayName, "수정된 이름");
});

test("읽기 오류를 빈 계정으로 반환하지 않고 fallback snapshot 쓰기를 거부한다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-read-error", firestore };
  const original = await getCareSnapshot(scope);
  await registerDocument(scope, upload("kept"));
  firestore.failReads = 1;
  await assert.rejects(getCareSnapshot(scope), /INJECTED_READ_FAILURE/);
  await assert.rejects(updateRecipientProfile(scope, original.recipient, { ...original, dataSource: "local-fallback" }), /서버 데이터/);
  assert.equal((await getCareSnapshot(scope)).documents[0]?.id, "kept");
});

test("부분 commit 실패는 문서와 read model을 모두 보존하며 canonical 데이터로 복구한다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-rebuild", firestore };
  await registerDocument(scope, upload("kept"));
  firestore.failCommits = 1;
  await assert.rejects(registerDocument(scope, upload("failed")), /INJECTED_COMMIT_FAILURE/);
  assert.equal(firestore.store.has("careRecipients/google-rebuild/clinicalDocuments/failed"), false);
  firestore.store.delete("careReadModels/google-rebuild");
  assert.equal((await getCareSnapshot(scope)).documents[0]?.id, "kept");
  const model = firestore.store.get("careReadModels/google-rebuild") as Record<string, unknown>;
  firestore.store.set("careReadModels/google-rebuild", { ...model, documents: [] });
  assert.equal((await rebuildCareReadModel(scope)).repaired, true);
  assert.equal((await getCareSnapshot(scope)).documents[0]?.id, "kept");
});

test("당일 체크인은 read model에서 같은 날짜 기록을 교체하고 과거 기록을 보존한다", () => {
  const update = applyDailyCheckInToSnapshot(
    snapshot,
    {
      doseResponses: [
        {
          medicationPlanId: "med-amlodipine",
          scheduledAt: "2026-08-16T08:00:00+09:00",
          response: "completed",
        },
      ],
      symptoms: ["두통"],
      severity: 3,
      note: "오후에는 괜찮아졌어요.",
      answeredBy: "caregiver",
    },
    new Date("2026-08-16T06:30:00.000Z"),
  );

  assert.equal(update.checkIn.id, "2026-08-16");
  assert.deepEqual(update.replacedSymptomEvents.map((event) => event.id), ["symptom-0816"]);
  assert.equal(update.nextSnapshot.symptomEvents.some((event) => event.id === "symptom-0816"), false);
  assert.equal(update.nextSnapshot.symptomEvents.some((event) => event.id === "symptom-0815"), true);
  assert.equal(update.nextSnapshot.symptomEvents[0]?.symptomType, "두통");
  assert.equal(update.nextSnapshot.todayCheckIn?.note, "오후에는 괜찮아졌어요.");
});

test("같은 복약 체크인을 다시 저장해도 read model에 중복 이벤트가 생기지 않는다", () => {
  const input = {
    doseResponses: [
      {
        medicationPlanId: "med-amlodipine",
        scheduledAt: "2026-08-16T08:00:00+09:00",
        response: "completed" as const,
      },
    ],
    symptoms: [],
    severity: 0,
    note: "",
    answeredBy: "recipient" as const,
  };
  const now = new Date("2026-08-16T07:00:00.000Z");
  const first = applyDailyCheckInToSnapshot(snapshot, input, now);
  const second = applyDailyCheckInToSnapshot(first.nextSnapshot, input, now);
  const id = "2026-08-16-med-amlodipine-0800";

  assert.equal(second.nextSnapshot.doseEvents.filter((event) => event.id === id).length, 1);
});

test("read model의 체크인은 서울 날짜가 오늘과 일치할 때만 반환한다", () => {
  const checkIn = {
    id: "2026-08-16",
    completedAt: "2026-08-16T07:00:00.000Z",
    completedBy: "caregiver" as const,
    medicationResponses: [],
    symptoms: [],
    note: "확인",
  };

  assert.equal(currentDailyCheckIn(checkIn, new Date("2026-08-16T14:59:00.000Z")), checkIn);
  assert.equal(currentDailyCheckIn(checkIn, new Date("2026-08-16T15:01:00.000Z")), null);
});

test("기존 문서 삭제와 새 문서 등록의 동시 요청에서 새 데이터가 유실되지 않는다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-delete-race", firestore };
  await registerDocument(scope, upload("old"));
  const stale = await getCareSnapshot(scope);
  await Promise.all([deleteDocument(scope, "old", stale), registerDocument(scope, upload("new"))]);
  assert.deepEqual((await getCareSnapshot(scope)).documents.map((item) => item.id), ["new"]);
});

test("복약 확정과 알림 복구 작업은 같은 commit에 저장되고 실패 시 둘 다 남지 않는다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-outbox", firestore };
  const document = await registerDocument(scope, prescriptionUpload("outbox-rx"));
  const draft = (await getMedicationPlanDraft(scope, document.medicationDraftId!))!;
  await firestore.collection("pushSubscriptions").doc("sub").set({ recipientId: scope.recipientId, active: true });
  firestore.beforeCommit = (operations) => {
    if (operations.some((item) => item.path.startsWith("medicationReminderSync/"))) throw new Error("OUTBOX_FAILURE");
  };
  const input = {
    draftId: draft.id,
    revision: draft.revision,
    idempotencyKey: "outbox-confirm-001",
    confirmedBy: "google:user-outbox",
    candidates: confirmationCandidates(draft),
  };
  await assert.rejects(confirmMedicationPlanDraft(scope, input), /OUTBOX_FAILURE/);
  assert.deepEqual((await getCareSnapshot(scope)).medications, []);
  assert.equal((await getMedicationPlanDraft(scope, draft.id))?.state, "needs_review");
  firestore.beforeCommit = undefined;
  await confirmMedicationPlanDraft(scope, input);
  assert.equal((firestore.store.get(`medicationReminderSync/${scope.recipientId}`) as { status: string }).status, "pending");
});

test("처방전에서 추출한 약을 복약 일정용 활성 계획으로 변환한다", () => {
  const medications = medicationPlansFromPrescription({
    id: "doc-rx-1",
    documentType: "처방전",
    uploadedAt: "2026-08-16T10:00:00+09:00",
    analysis: {
      documentType: "처방전",
      summary: "약 1개",
      findings: [],
      carePoints: [],
      questionsForProfessional: [],
      disclaimer: "원본 확인",
      source: "openai",
      medications: [
        {
          productName: "테스트정 5mg",
          ingredientName: "테스트 성분",
          doseAmount: "한 번에 1정",
          frequency: "하루 2회",
          timing: "아침·저녁 식사 후",
          startDate: "날짜 확인 필요",
          purposePlain: "증상 관리",
          precautions: ["어지러움 확인"],
        },
      ],
    },
  });

  assert.equal(medications.length, 1);
  assert.equal(medications[0]?.id, "rx-doc-rx-1-1");
  assert.equal(medications[0]?.startDate, "2026-08-16");
  assert.equal(medications[0]?.frequency, "하루 2회");
  assert.equal(medications[0]?.sourceDocumentId, "doc-rx-1");
  assert.equal(medications[0]?.status, "active");
});

test("진단서 분석 결과는 복약 계획으로 만들지 않는다", () => {
  assert.deepEqual(
    medicationPlansFromPrescription({
      id: "doc-diagnosis-1",
      documentType: "진단서",
      uploadedAt: "2026-08-16T10:00:00+09:00",
      analysis: undefined,
    }),
    [],
  );
});

const prescriptionUpload = (id: string) => ({
  fileName: `${id}.png`,
  contentHash: id,
  documentType: "처방전" as const,
  size: 1234,
  isSample: false,
  analysis: {
    documentType: "처방전" as const,
    summary: "약 2개",
    findings: [],
    carePoints: [],
    questionsForProfessional: [],
    disclaimer: "원본 확인",
    source: "openai" as const,
    medications: [
      {
        productName: "첫째약 5mg",
        ingredientName: "첫째성분",
        doseAmount: "1정",
        frequency: "하루 1회",
        timing: "아침 식사 후",
        startDate: "2026-08-16",
        endDate: "2026-08-22",
        purposePlain: "증상 관리",
        precautions: [],
      },
      {
        productName: "둘째약 10mg",
        ingredientName: "둘째성분",
        doseAmount: "2정",
        frequency: "하루 2회",
        timing: "아침·저녁 식사 후",
        startDate: "2026-08-16",
        purposePlain: "증상 관리",
        precautions: [],
      },
    ],
  },
});

function confirmationCandidates(draft: NonNullable<Awaited<ReturnType<typeof getMedicationPlanDraft>>>) {
  return draft.candidates.map((candidate) => ({
    id: candidate.id,
    included: candidate.included,
    productName: candidate.productName,
    ingredientName: candidate.ingredientName,
    doseAmount: candidate.doseAmount,
    frequency: candidate.frequency,
    timing: candidate.timing,
    startDate: candidate.startDate,
    endDate: candidate.endDate,
  }));
}

test("처방 분석은 복약 초안만 만들고 현재 약·복용 기록·알림 의도를 변경하지 않는다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-draft-only", firestore };
  await getCareSnapshot(scope);
  await firestore.collection("pushSubscriptions").doc("active-device").set({ recipientId: scope.recipientId, active: true });

  const document = await registerDocument(scope, prescriptionUpload("draft-only"));
  const result = await getCareSnapshot(scope);
  const draft = await getMedicationPlanDraft(scope, document.medicationDraftId!);

  assert.equal(document.status, "needs_review");
  assert.equal(draft?.state, "needs_review");
  assert.equal(draft?.candidates.length, 2);
  assert.deepEqual(result.medications, []);
  assert.deepEqual(result.doseEvents, []);
  assert.equal(firestore.store.has(`medicationReminderSync/${scope.recipientId}`), false);
});

test("사용자가 수정·선택해 확정한 약만 활성화하고 확인자·시각·문서 revision을 보존한다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-draft-confirm", firestore };
  const document = await registerDocument(scope, prescriptionUpload("confirm"));
  const draft = (await getMedicationPlanDraft(scope, document.medicationDraftId!))!;
  const candidates = confirmationCandidates(draft);
  candidates[0] = { ...candidates[0]!, productName: "수정한 첫째약 5mg" };
  candidates[1] = { ...candidates[1]!, included: false };

  const result = await confirmMedicationPlanDraft(scope, {
    draftId: draft.id,
    revision: draft.revision,
    idempotencyKey: "confirm-request-001",
    confirmedBy: "google:user-1",
    candidates,
  }, { now: new Date("2026-08-17T01:00:00Z") });

  assert.equal(result.medications.length, 1);
  assert.equal(result.medications[0]?.productName, "수정한 첫째약 5mg");
  assert.equal(result.medications[0]?.confirmedBy, "google:user-1");
  assert.equal(result.medications[0]?.confirmedAt, "2026-08-17T01:00:00.000Z");
  assert.equal(result.medications[0]?.sourceDocumentRevision, document.revision);
  assert.deepEqual(result.draft.transitionHistory.slice(-2).map((item) => item.state), ["confirmed", "active"]);
  assert.equal((await getCareSnapshot(scope)).medications.length, 1);
});

test("분석·확정 재시도와 동시 확정은 같은 초안·복약 계획을 중복 생성하지 않는다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-draft-idempotent", firestore };
  const firstDocument = await registerDocument(scope, prescriptionUpload("same-analysis"));
  const repeatedDocument = await registerDocument(scope, prescriptionUpload("same-analysis"));
  assert.equal(firstDocument.medicationDraftId, repeatedDocument.medicationDraftId);
  const draft = (await getMedicationPlanDraft(scope, firstDocument.medicationDraftId!))!;
  const input = {
    draftId: draft.id,
    revision: draft.revision,
    idempotencyKey: "confirm-request-retry",
    confirmedBy: "google:user-2",
    candidates: confirmationCandidates(draft),
  };

  const [first, concurrent] = await Promise.all([
    confirmMedicationPlanDraft(scope, input),
    confirmMedicationPlanDraft(scope, { ...input, idempotencyKey: "confirm-request-concurrent" }),
  ]);
  const replay = await confirmMedicationPlanDraft(scope, input);
  const snapshotAfter = await getCareSnapshot(scope);

  assert.equal(first.medications.length, 2);
  assert.equal(concurrent.medications.length, 2);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(snapshotAfter.documents.length, 1);
  assert.equal(snapshotAfter.medications.length, 2);
  assert.equal(new Set(snapshotAfter.medications.map((item) => item.id)).size, 2);
});

test("만료·문서 revision 변경·취소된 초안은 재검토 없이 확정할 수 없다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-draft-stale", firestore };
  const expiredDocument = await registerDocument(scope, prescriptionUpload("expired"));
  const expiredDraft = (await getMedicationPlanDraft(scope, expiredDocument.medicationDraftId!))!;
  firestore.store.set(`careRecipients/${scope.recipientId}/medicationPlanDrafts/${expiredDraft.id}`, {
    ...expiredDraft,
    expiresAt: "2026-08-01T00:00:00.000Z",
  });
  await assert.rejects(confirmMedicationPlanDraft(scope, {
    draftId: expiredDraft.id,
    revision: expiredDraft.revision,
    idempotencyKey: "expired-request-001",
    confirmedBy: "google:user-3",
    candidates: confirmationCandidates(expiredDraft),
  }, { now: new Date("2026-08-20T00:00:00Z") }), /만료/);
  assert.equal((await getMedicationPlanDraft(scope, expiredDraft.id))?.state, "expired");

  const changedDocument = await registerDocument(scope, prescriptionUpload("changed"));
  const changedDraft = (await getMedicationPlanDraft(scope, changedDocument.medicationDraftId!))!;
  firestore.store.set(`careRecipients/${scope.recipientId}/clinicalDocuments/${changedDocument.id}`, {
    ...changedDocument,
    revision: "sha256:changed-after-analysis",
  });
  await assert.rejects(confirmMedicationPlanDraft(scope, {
    draftId: changedDraft.id,
    revision: changedDraft.revision,
    idempotencyKey: "changed-request-001",
    confirmedBy: "google:user-3",
    candidates: confirmationCandidates(changedDraft),
  }), /근거 문서가 변경/);

  const cancelledDocument = await registerDocument(scope, prescriptionUpload("cancelled"));
  const cancelledDraft = (await getMedicationPlanDraft(scope, cancelledDocument.medicationDraftId!))!;
  await cancelMedicationPlanDraft(scope, cancelledDraft.id, "google:user-3");
  await assert.rejects(confirmMedicationPlanDraft(scope, {
    draftId: cancelledDraft.id,
    revision: cancelledDraft.revision + 1,
    idempotencyKey: "cancelled-request-001",
    confirmedBy: "google:user-3",
    candidates: confirmationCandidates(cancelledDraft),
  }), /취소/);
});
