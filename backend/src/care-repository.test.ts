import assert from "node:assert/strict";
import test from "node:test";

import demoSeed from "./data/demo-seed.json" with { type: "json" };
import {
  applyDailyCheckInToSnapshot,
  currentDailyCheckIn,
} from "./care-read-model.ts";
import {
  createInitialCareSnapshot,
  getDocumentImportReview,
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

test("원본 변경과 복구 작업은 같은 commit에 저장되고 실패 시 둘 다 남지 않는다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-outbox", firestore };
  await getCareSnapshot(scope);
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

const prescriptionUpload = (
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
    }],
  },
});

test("동일 파일과 네트워크 중복 요청은 문서·복약을 한 번만 생성한다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-exact-idempotency", firestore };
  const input = prescriptionUpload("same-file", "중복검증정 5mg", "network-request-001");

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
  assert.equal(result.medications.length, 1);
  assert.equal(firestore.store.has(`careRecipients/${scope.recipientId}/documentImportRequests/network-request-001`), true);
  assert.equal(firestore.store.has(`careRecipients/${scope.recipientId}/documentImportRequests/network-request-002`), true);
});

test("같은 요청 식별자를 다른 파일에 재사용할 수 없다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-request-key", firestore };
  await registerDocument(scope, prescriptionUpload("request-first", "첫째약", "same-request-key"));
  await assert.rejects(
    registerDocument(scope, prescriptionUpload("request-second", "둘째약", "same-request-key")),
    /다른 문서/,
  );
  assert.equal((await getCareSnapshot(scope)).documents.length, 1);
});

test("같은 처방의 이미지·PDF 변형은 사용자 결정 전 차단하고 병합하면 중복 일정을 만들지 않는다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-semantic-merge", firestore };
  await registerDocument(scope, prescriptionUpload("photo-variant", "중복검증정 5mg", "photo-request"));
  const pdf = prescriptionUpload("pdf-variant", "중복 검증정 5mg", "pdf-request");

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
  assert.equal(result.documents.length, 2);
  assert.equal(result.medications.length, 1);
});

test("사용자가 별도 처방을 선택한 경우에만 의미상 같은 복약을 별도 등록한다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-semantic-separate", firestore };
  await registerDocument(scope, prescriptionUpload("first-rx", "중복검증정 5mg", "first-rx-request"));
  const second = await registerDocument(scope, {
    ...prescriptionUpload("second-rx", "중복 검증정 5mg", "second-rx-request"),
    duplicateAction: "separate",
  });

  assert.equal(second.duplicateResolution, "separate");
  assert.equal((await getCareSnapshot(scope)).medications.length, 2);
});

test("약명 또는 처방 기간이 다른 처방은 중복으로 오인하지 않고 별도 등록한다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-distinct-rx", firestore };
  await registerDocument(scope, prescriptionUpload("distinct-first", "첫째약 5mg", "distinct-request-1"));
  await registerDocument(scope, prescriptionUpload("distinct-second", "둘째약 5mg", "distinct-request-2"));
  const shifted = prescriptionUpload("distinct-third", "첫째약 5mg", "distinct-request-3");
  shifted.analysis.medications[0]!.startDate = "2026-09-01";
  shifted.analysis.medications[0]!.endDate = "2026-09-07";
  await registerDocument(scope, shifted);

  const result = await getCareSnapshot(scope);
  assert.equal(result.documents.length, 3);
  assert.equal(result.medications.length, 3);
});

test("중복 선택 대기 분석을 같은 요청에서 재사용해 AI 재실행 없이 결정할 수 있다", async () => {
  const firestore = new MemoryFirestore();
  const scope = { recipientId: "google-review-retry", firestore };
  const reviewInput = prescriptionUpload("pending-pdf", "중복검증정 5mg", "pending-review-key");
  const duplicateCandidates = [{
    incomingMedicationId: "incoming-1",
    existingMedicationPlanId: "existing-1",
    existingDocumentId: "source-1",
    productName: "중복검증정 5mg",
    fingerprint: "fingerprint",
  }];
  const first = await saveDocumentImportReview(scope, {
    idempotencyKey: reviewInput.requestIdempotencyKey,
    contentHash: reviewInput.contentHash,
    fileName: reviewInput.fileName,
    documentType: reviewInput.documentType,
    size: reviewInput.size,
    isSample: reviewInput.isSample,
    analysis: reviewInput.analysis,
    duplicateCandidates,
  });
  const replay = await saveDocumentImportReview(scope, {
    idempotencyKey: reviewInput.requestIdempotencyKey,
    contentHash: reviewInput.contentHash,
    fileName: reviewInput.fileName,
    documentType: reviewInput.documentType,
    size: reviewInput.size,
    isSample: reviewInput.isSample,
    analysis: reviewInput.analysis,
    duplicateCandidates,
  });

  assert.equal(first.createdAt, replay.createdAt);
  assert.deepEqual((await getDocumentImportReview(scope, reviewInput.requestIdempotencyKey, reviewInput.contentHash))?.duplicateCandidates, duplicateCandidates);
});
