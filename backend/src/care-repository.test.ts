import assert from "node:assert/strict";
import test from "node:test";

import demoSeed from "./data/demo-seed.json" with { type: "json" };
import {
  applyDailyCheckInToSnapshot,
  currentDailyCheckIn,
} from "./care-read-model.ts";
import {
  CareConflictError,
  confirmDocumentDiagnoses,
  createInitialCareSnapshot,
  cancelMedicationPlanDraft,
  confirmMedicationPlanDraft,
  getDocumentImportReview,
  getMedicationPlanDraft,
  MedicationDuplicateResolutionRequiredError,
  medicationPlansFromPrescription,
  getCareSnapshot,
  registerDocument,
  saveDocumentImportReview,
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
  revision: 0,
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

test("오래된 revision으로 프로필을 저장하면 최신 변경을 덮어쓰지 않는다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-conflict", firestore };
  const initial = await getCareSnapshot(scope);
  await updateRecipientProfile(scope, { ...initial.recipient, displayName: "먼저 저장" }, initial, 0);
  await assert.rejects(
    updateRecipientProfile(scope, { ...initial.recipient, displayName: "늦은 저장" }, initial, 0),
    CareConflictError,
  );
  assert.equal((await getCareSnapshot(scope)).recipient.displayName, "먼저 저장");
});

const upload = (id: string) => ({ fileName: `${id}.pdf`, contentHash: id, documentType: "진단서" as const, size: 100, isSample: true, analysis: null });

async function consentedSnapshot(scope: { recipientId: string; firestore: MemoryFirestore }) {
  const current = await getCareSnapshot(scope);
  await updateRecipientProfile(scope, {
    ...current.recipient,
    displayName: "합성 검증 대상자",
    ageBand: "75",
    consentConfirmed: true,
    lastConfirmedAt: "2026-08-23T00:00:00.000Z",
    profileCompletedAt: "2026-08-23T00:00:00.000Z",
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

test("복약 확정과 알림 복구 작업은 같은 commit에 저장되고 실패 시 둘 다 남지 않는다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-outbox", firestore };
  await consentedSnapshot(scope);
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
          reviewStatus: "verified",
        },
      ],
    },
  }, "2026-08-16");

  assert.equal(medications.length, 1);
  assert.equal(medications[0]?.id, "rx-doc-rx-1-1");
  assert.equal(medications[0]?.startDate, "2026-08-16");
  assert.equal(medications[0]?.endDate, "2026-08-20");
  assert.equal(medications[0]?.frequency, "하루 2회");
  assert.deepEqual(medications[0]?.recurrence, {
    kind: "daily",
    count: 2,
    source: "하루 2회",
  });
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
      medications: [{ productName: "과거처방정", ingredientName: "성분", doseAmount: "1정", frequency: "하루 1회", timing: "아침", startDate: "", purposePlain: "테스트", precautions: [], reviewStatus: "verified" }],
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
      medications: [{ productName: "기간정", ingredientName: "성분", doseAmount: "1정", frequency: "하루 1회", timing: "아침", startDate: "", purposePlain: "테스트", precautions: [], reviewStatus: "verified" }],
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
  await consentedSnapshot(scope);
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
      medications: [{ productName: "확인정", ingredientName: "성분", doseAmount: "1정", frequency: "하루 1회", timing: "아침", startDate: "날짜 확인 필요", purposePlain: "테스트", precautions: [], reviewStatus: "needs_review" }],
    },
  });

  assert.equal(document.status, "needs_review");
  assert.deepEqual((await getCareSnapshot(scope)).medications, []);
  assert.equal(firestore.store.has(`careRecipients/${scope.recipientId}/medicationPlans/rx-uncertain-rx-1`), false);
});

test("OCR 근거나 공식 코드 대조가 필요한 약은 복약 일정으로 활성화하지 않는다", () => {
  const medications = medicationPlansFromPrescription({
    id: "doc-rx-review",
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
      medications: [{
        productName: "테스트정 5mg",
        ingredientName: "테스트 성분",
        doseAmount: "1정",
        frequency: "하루 1회",
        timing: "아침 식사 후",
        startDate: "2026-08-16",
        purposePlain: "증상 관리",
        precautions: [],
        reviewStatus: "needs_review",
      }],
    },
  });

  assert.deepEqual(medications, []);
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

test("진단서 질환은 보호자 확정 뒤에만 저장되고 원본 문서 삭제 시 함께 제거된다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-diagnosis-confirmation", firestore };
  await consentedSnapshot(scope);
  await registerDocument(scope, {
    fileName: "진단서.pdf",
    contentHash: "diagnosis-confirmed",
    documentType: "진단서",
    size: 100,
    isSample: true,
    analysis: {
      documentType: "진단서",
      summary: "고혈압 확인",
      findings: [],
      carePoints: [],
      questionsForProfessional: [],
      disclaimer: "원본 확인",
      source: "demo",
      diagnoses: [{ name: "본태성 고혈압", code: "I10" }],
    },
  });
  assert.deepEqual((await getCareSnapshot(scope)).recipient.confirmedConditions, []);

  await confirmDocumentDiagnoses(scope, "diagnosis-confirmed");
  const confirmed = await getCareSnapshot(scope);
  assert.equal(confirmed.recipient.confirmedConditions?.[0]?.id, "condition-hypertension");
  assert.equal(confirmed.recipient.confirmedConditions?.[0]?.sourceDocumentId, "diagnosis-confirmed");
  const revision = confirmed.revision;

  await confirmDocumentDiagnoses(scope, "diagnosis-confirmed");
  assert.equal((await getCareSnapshot(scope)).revision, revision);

  await deleteDocument(scope, "diagnosis-confirmed");
  assert.deepEqual((await getCareSnapshot(scope)).recipient.confirmedConditions, []);
});

const prescriptionUpload = (id: string) => ({
  fileName: `${id}.png`,
  contentHash: id,
  documentType: "처방전" as const,
  size: 1234,
  isSample: false,
  analysis: {
    documentType: "처방전" as const,
    prescriptionDate: "2026-08-16",
    totalSupplyDays: 7,
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
        reviewStatus: "verified" as const,
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
        reviewStatus: "verified" as const,
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
  await consentedSnapshot(scope);
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

test("OCR 대조가 끝나지 않은 초안 후보는 확정 요청으로도 활성화할 수 없다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-draft-unverified", firestore };
  await consentedSnapshot(scope);
  const verifiedUpload = prescriptionUpload("unverified-confirm");
  const upload = {
    ...verifiedUpload,
    analysis: {
      ...verifiedUpload.analysis,
      medications: verifiedUpload.analysis.medications.map((medication, index) => ({
        ...medication,
        reviewStatus: index === 0 ? "needs_review" as const : medication.reviewStatus,
      })),
    },
  };
  const document = await registerDocument(scope, upload);
  const draft = (await getMedicationPlanDraft(scope, document.medicationDraftId!))!;
  const candidates = confirmationCandidates(draft);
  candidates[0] = { ...candidates[0]!, included: true };
  candidates[1] = { ...candidates[1]!, included: false };

  await assert.rejects(confirmMedicationPlanDraft(scope, {
    draftId: draft.id,
    revision: draft.revision,
    idempotencyKey: "unverified-confirm-request",
    confirmedBy: "google:user-1",
    candidates,
  }), /식약처 정보 대조가 완료된 약만/);
  assert.deepEqual((await getCareSnapshot(scope)).medications, []);
});

test("사용자가 수정·선택해 확정한 약만 활성화하고 확인자·시각·문서 revision을 보존한다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-draft-confirm", firestore };
  await consentedSnapshot(scope);
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
  await consentedSnapshot(scope);
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
  await consentedSnapshot(scope);
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

const duplicatePrescriptionUpload = (
  contentHash: string,
  productName = "중복검증정 5mg",
  requestIdempotencyKey = `request-${contentHash}`,
) => ({
  fileName: `${contentHash}.png`,
  contentHash,
  requestIdempotencyKey,
  documentType: "처방전" as const,
  size: 1000,
  isSample: false,
  analysis: {
    documentType: "처방전" as const,
    prescriptionDate: "2026-08-20",
    totalSupplyDays: 7,
    summary: "약 1개",
    findings: [],
    carePoints: [],
    questionsForProfessional: [],
    disclaimer: "원본 확인",
    source: "openai" as const,
    medications: [{
      productName,
      ingredientName: "중복검증성분",
      doseAmount: "1정",
      frequency: "하루 2회",
      timing: "아침·저녁 식사 후",
      startDate: "2026-08-20",
      endDate: "2026-08-26",
      purposePlain: "증상 관리",
      precautions: [],
      reviewStatus: "verified" as const,
    }],
  },
});

async function registerAndConfirmDuplicate(
  scope: { recipientId: string; firestore: MemoryFirestore },
  input: ReturnType<typeof duplicatePrescriptionUpload>,
) {
  const document = await registerDocument(scope, input);
  const draft = (await getMedicationPlanDraft(scope, document.medicationDraftId!))!;
  const confirmation = await confirmMedicationPlanDraft(scope, {
    draftId: draft.id,
    revision: draft.revision,
    idempotencyKey: `confirm-${input.contentHash}`,
    confirmedBy: "google:duplicate-test",
    candidates: confirmationCandidates(draft),
  });
  return { document, confirmation };
}

test("동일 파일과 네트워크 중복 요청은 문서·초안을 한 번만 생성한다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-exact-idempotency", firestore };
  await consentedSnapshot(scope);
  const input = duplicatePrescriptionUpload("same-file", "중복검증정 5mg", "network-request-001");

  const [first, concurrent] = await Promise.all([
    registerDocument(scope, input),
    registerDocument(scope, input),
  ]);
  const repeatedWithNewRequest = await registerDocument(scope, {
    ...input,
    requestIdempotencyKey: "network-request-002",
  });
  const result = await getCareSnapshot(scope);

  assert.equal(first.id, concurrent.id);
  assert.equal(first.id, repeatedWithNewRequest.id);
  assert.equal(result.documents.length, 1);
  assert.equal(result.medications.length, 0);
  assert.equal(first.medicationDraftId, concurrent.medicationDraftId);
  assert.equal(firestore.store.has(`careRecipients/${scope.recipientId}/medicationPlanDrafts/${first.medicationDraftId}`), true);
  assert.equal(firestore.store.has(`careRecipients/${scope.recipientId}/documentImportRequests/network-request-001`), true);
  assert.equal(firestore.store.has(`careRecipients/${scope.recipientId}/documentImportRequests/network-request-002`), true);
});

test("같은 요청 식별자를 다른 파일에 재사용할 수 없다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-request-key", firestore };
  await consentedSnapshot(scope);
  await registerDocument(scope, duplicatePrescriptionUpload("request-first", "첫째약", "same-request-key"));
  await assert.rejects(
    registerDocument(scope, duplicatePrescriptionUpload("request-second", "둘째약", "same-request-key")),
    /다른 문서/,
  );
  assert.equal((await getCareSnapshot(scope)).documents.length, 1);
});

test("같은 처방의 이미지·PDF 변형은 사용자 결정 전 차단하고 병합하면 새 초안을 만들지 않는다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-semantic-merge", firestore };
  await consentedSnapshot(scope);
  await registerAndConfirmDuplicate(
    scope,
    duplicatePrescriptionUpload("photo-variant", "중복검증정 5mg", "photo-request"),
  );
  const pdf = duplicatePrescriptionUpload("pdf-variant", "중복 검증정 5mg", "pdf-request");

  let duplicateError: MedicationDuplicateResolutionRequiredError | undefined;
  try {
    await registerDocument(scope, pdf);
  } catch (error) {
    if (error instanceof MedicationDuplicateResolutionRequiredError) duplicateError = error;
    else throw error;
  }
  assert.equal(duplicateError?.candidates.length, 1);
  assert.equal((await getCareSnapshot(scope)).documents.length, 1);

  const merged = await registerDocument(scope, { ...pdf, duplicateAction: "merge" });
  const result = await getCareSnapshot(scope);
  assert.equal(merged.duplicateResolution, "merge");
  assert.equal(merged.duplicateMedicationPlanIds?.length, 1);
  assert.equal(merged.medicationDraftId, undefined);
  assert.equal(result.documents.length, 2);
  assert.equal(result.medications.length, 1);
});

test("사용자가 별도 처방을 선택하고 초안을 확정한 경우에만 같은 복약을 별도 활성화한다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-semantic-separate", firestore };
  await consentedSnapshot(scope);
  await registerAndConfirmDuplicate(
    scope,
    duplicatePrescriptionUpload("first-rx", "중복검증정 5mg", "first-rx-request"),
  );
  const second = await registerDocument(scope, {
    ...duplicatePrescriptionUpload("second-rx", "중복 검증정 5mg", "second-rx-request"),
    duplicateAction: "separate" as const,
  });

  assert.equal(second.duplicateResolution, "separate");
  assert.equal((await getCareSnapshot(scope)).medications.length, 1);
  const draft = (await getMedicationPlanDraft(scope, second.medicationDraftId!))!;
  await confirmMedicationPlanDraft(scope, {
    draftId: draft.id,
    revision: draft.revision,
    idempotencyKey: "confirm-second-rx",
    confirmedBy: "google:duplicate-test",
    candidates: confirmationCandidates(draft),
  });
  assert.equal((await getCareSnapshot(scope)).medications.length, 2);
});

test("약명 또는 처방 기간이 다른 처방은 중복으로 오인하지 않는다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-distinct-rx", firestore };
  await consentedSnapshot(scope);
  await registerAndConfirmDuplicate(
    scope,
    duplicatePrescriptionUpload("distinct-first", "첫째약 5mg", "distinct-request-1"),
  );
  await registerAndConfirmDuplicate(
    scope,
    duplicatePrescriptionUpload("distinct-second", "둘째약 5mg", "distinct-request-2"),
  );
  const base = duplicatePrescriptionUpload("distinct-third", "첫째약 5mg", "distinct-request-3");
  const shifted = {
    ...base,
    analysis: {
      ...base.analysis,
      prescriptionDate: "2026-09-01",
      medications: base.analysis.medications.map((medication) => ({
        ...medication,
        startDate: "2026-09-01",
        endDate: "2026-09-07",
      })),
    },
  };
  await registerAndConfirmDuplicate(scope, shifted);

  const result = await getCareSnapshot(scope);
  assert.equal(result.documents.length, 3);
  assert.equal(result.medications.length, 3);
});

test("중복 선택 대기 분석을 같은 요청에서 재사용해 AI 재실행 없이 결정할 수 있다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-review-retry", firestore };
  await consentedSnapshot(scope);
  const reviewInput = duplicatePrescriptionUpload("pending-pdf", "중복검증정 5mg", "pending-review-key");
  const duplicateCandidates = [{
    incomingMedicationId: "incoming-1",
    existingMedicationPlanId: "existing-1",
    existingDocumentId: "source-1",
    productName: "중복검증정 5mg",
    fingerprint: "fingerprint",
  }];
  const input = {
    idempotencyKey: reviewInput.requestIdempotencyKey,
    contentHash: reviewInput.contentHash,
    fileName: reviewInput.fileName,
    documentType: reviewInput.documentType,
    size: reviewInput.size,
    isSample: reviewInput.isSample,
    analysis: reviewInput.analysis,
    duplicateCandidates,
  };
  const first = await saveDocumentImportReview(scope, input);
  const replay = await saveDocumentImportReview(scope, input);

  assert.equal(first.createdAt, replay.createdAt);
  assert.deepEqual(
    (await getDocumentImportReview(scope, reviewInput.requestIdempotencyKey, reviewInput.contentHash))?.duplicateCandidates,
    duplicateCandidates,
  );
});
