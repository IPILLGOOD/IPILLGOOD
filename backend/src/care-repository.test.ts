import assert from "node:assert/strict";
import test from "node:test";

import demoSeed from "./data/demo-seed.json" with { type: "json" };
import {
  applyDailyCheckInToSnapshot,
  currentDailyCheckIn,
} from "./care-read-model.ts";
import {
  createInitialCareSnapshot,
  medicationPlansFromPrescription,
  getCareSnapshot,
  registerDocument,
  updateRecipientProfile,
  rebuildCareReadModel,
  deleteDocument,
} from "./care-repository.ts";
import { MemoryFirestore } from "../test-support/memory-firestore.ts";
import { createMedicationSchedule } from "./medication-schedule.ts";
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

async function consentedSnapshot(scope: { recipientId: string; firestore: MemoryFirestore }) {
  const current = await getCareSnapshot(scope);
  await updateRecipientProfile(scope, {
    ...current.recipient,
    consentConfirmed: true,
    lastConfirmedAt: "2026-08-23T00:00:00.000Z",
  }, current);
  return getCareSnapshot(scope);
}

test("미동의 계정의 문서 등록은 건강정보 원본과 read model을 변경하지 않는다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-without-consent", firestore };
  await getCareSnapshot(scope);

  await assert.rejects(registerDocument(scope, upload("blocked")), /동의/);

  assert.equal(firestore.store.has(`careRecipients/${scope.recipientId}/clinicalDocuments/blocked`), false);
  assert.equal(firestore.store.has(`careRecipients/${scope.recipientId}/medicationPlans/rx-blocked-1`), false);
  assert.deepEqual((await getCareSnapshot(scope)).documents, []);
});

test("서로 다른 문서의 동시 등록과 오래된 프로필 저장이 기존 데이터를 덮어쓰지 않는다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-concurrent", firestore };
  const original = await consentedSnapshot(scope);
  await Promise.all([registerDocument(scope, upload("a")), registerDocument(scope, upload("b"))]);
  await updateRecipientProfile(scope, { ...original.recipient, displayName: "수정된 이름" }, original);
  const result = await getCareSnapshot(scope);
  assert.deepEqual(result.documents.map((item) => item.id).sort(), ["a", "b"]);
  assert.equal(result.recipient.displayName, "수정된 이름");
});

test("읽기 오류를 빈 계정으로 반환하지 않고 fallback snapshot 쓰기를 거부한다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-read-error", firestore };
  const original = await consentedSnapshot(scope);
  await registerDocument(scope, upload("kept"));
  firestore.failReads = 1;
  await assert.rejects(getCareSnapshot(scope), /INJECTED_READ_FAILURE/);
  await assert.rejects(updateRecipientProfile(scope, original.recipient, { ...original, dataSource: "local-fallback" }), /서버 데이터/);
  assert.equal((await getCareSnapshot(scope)).documents[0]?.id, "kept");
});

test("부분 commit 실패는 문서와 read model을 모두 보존하며 canonical 데이터로 복구한다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-rebuild", firestore };
  await consentedSnapshot(scope);
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
  await consentedSnapshot(scope);
  await registerDocument(scope, upload("old"));
  const stale = await getCareSnapshot(scope);
  await Promise.all([deleteDocument(scope, "old", stale), registerDocument(scope, upload("new"))]);
  assert.deepEqual((await getCareSnapshot(scope)).documents.map((item) => item.id), ["new"]);
});

test("원본 변경과 복구 작업은 같은 commit에 저장되고 실패 시 둘 다 남지 않는다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-outbox", firestore };
  await consentedSnapshot(scope);
  await firestore.collection("pushSubscriptions").doc("sub").set({ recipientId: scope.recipientId, active: true });
  firestore.beforeCommit = (operations) => {
    if (operations.some((item) => item.path.startsWith("medicationReminderSync/"))) throw new Error("OUTBOX_FAILURE");
  };
  await assert.rejects(registerDocument(scope, upload("a")), /OUTBOX_FAILURE/);
  assert.equal(firestore.store.has(`careRecipients/${scope.recipientId}/clinicalDocuments/a`), false);
  assert.deepEqual((await getCareSnapshot(scope)).documents, []);
  firestore.beforeCommit = undefined;
  await registerDocument(scope, upload("a"));
  assert.equal((firestore.store.get(`medicationReminderSync/${scope.recipientId}`) as { status: string }).status, "pending");
});

test("처방일과 총 투약일수로 종료일을 계산해 경계 날짜에만 일정을 만든다", () => {
  const medications = medicationPlansFromPrescription({
    id: "doc-rx-1",
    documentType: "처방전",
    uploadedAt: "2026-08-16T10:00:00+09:00",
    analysis: {
      documentType: "처방전",
      prescriptionDate: "2026-08-16",
      totalSupplyDays: 5,
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
          startDate: "",
          purposePlain: "증상 관리",
          precautions: ["어지러움 확인"],
        },
      ],
    },
  }, "2026-08-16");

  assert.equal(medications.length, 1);
  assert.equal(medications[0]?.id, "rx-doc-rx-1-1");
  assert.equal(medications[0]?.startDate, "2026-08-16");
  assert.equal(medications[0]?.endDate, "2026-08-20");
  assert.equal(medications[0]?.frequency, "하루 2회");
  assert.equal(medications[0]?.sourceDocumentId, "doc-rx-1");
  assert.equal(medications[0]?.status, "active");
  assert.equal(createMedicationSchedule(medications, [], new Date("2026-08-15T23:00:00Z")).length, 2);
  assert.equal(createMedicationSchedule(medications, [], new Date("2026-08-20T03:00:00Z")).length, 2);
  assert.equal(createMedicationSchedule(medications, [], new Date("2026-08-20T15:01:00Z")).length, 0);
});

test("과거 처방은 종료 상태로 보존하고 오늘 복약 일정에는 포함하지 않는다", () => {
  const medications = medicationPlansFromPrescription({
    id: "doc-past-rx",
    documentType: "처방전",
    uploadedAt: "2026-08-23T00:00:00Z",
    analysis: {
      documentType: "처방전",
      prescriptionDate: "2022-02-26",
      totalSupplyDays: 5,
      summary: "과거 5일분 처방",
      findings: [], carePoints: [], questionsForProfessional: [], disclaimer: "원본 확인", source: "openai",
      medications: [{ productName: "과거처방정", ingredientName: "성분", doseAmount: "1정", frequency: "하루 1회", timing: "아침", startDate: "", purposePlain: "테스트", precautions: [] }],
    },
  }, "2026-08-23");

  assert.equal(medications[0]?.startDate, "2022-02-26");
  assert.equal(medications[0]?.endDate, "2022-03-02");
  assert.equal(medications[0]?.status, "ended");
  assert.deepEqual(createMedicationSchedule(medications, [], new Date("2026-08-23T03:00:00Z")), []);
});

test("월말·윤년 계산을 보존하고 불확실한 기간은 자동 활성화하지 않는다", () => {
  const prescription = (id: string, prescriptionDate: string, totalSupplyDays?: number) => medicationPlansFromPrescription({
    id,
    documentType: "처방전" as const,
    uploadedAt: "2026-08-23T00:00:00Z",
    analysis: {
      documentType: "처방전" as const,
      prescriptionDate,
      ...(totalSupplyDays ? { totalSupplyDays } : {}),
      summary: "기간 계산", findings: [], carePoints: [], questionsForProfessional: [], disclaimer: "원본 확인", source: "openai" as const,
      medications: [{ productName: "기간정", ingredientName: "성분", doseAmount: "1정", frequency: "하루 1회", timing: "아침", startDate: "", purposePlain: "테스트", precautions: [] }],
    },
  }, "2020-01-01");

  assert.equal(prescription("month-end", "2026-01-30", 3)[0]?.endDate, "2026-02-01");
  assert.equal(prescription("leap", "2024-02-28", 2)[0]?.endDate, "2024-02-29");
  assert.equal(prescription("future", "2027-01-01", 1)[0]?.status, "active");
  assert.deepEqual(prescription("unknown-days", "2026-01-30"), []);
  assert.deepEqual(prescription("unknown-date", "날짜 확인 필요", 3), []);
});

test("처방 기간이 불확실한 문서는 확인 필요로 저장하고 복약 계획을 만들지 않는다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-period-review", firestore };
  const document = await registerDocument(scope, {
    fileName: "uncertain-rx.pdf",
    contentHash: "uncertain-rx",
    documentType: "처방전",
    size: 100,
    isSample: false,
    analysis: {
      documentType: "처방전",
      summary: "기간 확인 필요",
      findings: [], carePoints: [], questionsForProfessional: [], disclaimer: "원본 확인", source: "openai",
      medications: [{ productName: "확인정", ingredientName: "성분", doseAmount: "1정", frequency: "하루 1회", timing: "아침", startDate: "날짜 확인 필요", purposePlain: "테스트", precautions: [] }],
    },
  });

  assert.equal(document.status, "needs_review");
  assert.deepEqual((await getCareSnapshot(scope)).medications, []);
  assert.equal(firestore.store.has(`careRecipients/${scope.recipientId}/medicationPlans/rx-uncertain-rx-1`), false);
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
