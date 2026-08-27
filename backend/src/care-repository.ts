import demoSeed from "./data/demo-seed.json" with { type: "json" };
import type {
  CareRecipient,
  CareSnapshot,
  ClinicalDocument,
  ClinicalDocumentType,
  ClinicianQuestion,
  DailyCheckIn,
  DoseEvent,
  MedicationPlan,
  PatientQuestionResponse,
  PatientQuestionSet,
  SymptomEvent,
} from "./types.ts";

import { getAdminFirestore } from "./firebase-admin.ts";
import { isEphemeralDemoSessionActive } from "./demo-session.ts";
import type { FirestoreLike, TransactionLike, DocumentReferenceLike } from "./firestore-rest.ts";
import { stableJson } from "./stable-json.ts";
import {
  applyDailyCheckInToSnapshot,
  byDateDescending,
  currentDailyCheckIn,
  dateKeyInSeoul,
  MAX_DOCUMENTS,
  MAX_DOSE_EVENTS,
  MAX_SYMPTOM_EVENTS,
  type DailyCheckInInput,
} from "./care-read-model.ts";

export type CareDataScope = {
  recipientId: string;
  initialDisplayName?: string;
  useDemoData?: boolean;
  /** Internal dependency injection; never populated from client input. */
  firestore?: FirestoreLike;
};

const READ_MODEL_COLLECTION = "careReadModels";

type DemoSeed = Omit<CareSnapshot, "dataSource">;
type StoredCareReadModel = Omit<CareSnapshot, "dataSource"> & {
  updatedAt: string;
  revision?: number;
};

const seed = demoSeed as DemoSeed;

async function assertActiveDemoScope(
  scope: CareDataScope,
  firestore: FirestoreLike,
) {
  if (
    scope.useDemoData &&
    !(await isEphemeralDemoSessionActive(scope.recipientId, { firestore }))
  ) {
    throw new Error("데모 세션이 만료되었거나 종료되었습니다.");
  }
}

function toStoredReadModel(snapshot: CareSnapshot): StoredCareReadModel {
  return {
    recipient: snapshot.recipient,
    medications: snapshot.medications,
    doseEvents: [...snapshot.doseEvents]
      .sort(byDateDescending<DoseEvent>("scheduledAt"))
      .slice(0, MAX_DOSE_EVENTS),
    symptomEvents: [...snapshot.symptomEvents]
      .sort(byDateDescending<SymptomEvent>("occurredAt"))
      .slice(0, MAX_SYMPTOM_EVENTS),
    documents: [...snapshot.documents]
      .sort(byDateDescending<ClinicalDocument>("uploadedAt"))
      .slice(0, MAX_DOCUMENTS),
    clinicianQuestions: snapshot.clinicianQuestions,
    todayCheckIn: snapshot.todayCheckIn ?? null,
    updatedAt: new Date().toISOString(),
  };
}

function assertValidScope(scope: CareDataScope) {
  if (!/^[^/]{1,256}$/.test(scope.recipientId)) {
    throw new Error("올바르지 않은 돌봄 데이터 소유자 ID입니다.");
  }
}

export function createInitialCareSnapshot(scope: CareDataScope): CareSnapshot {
  assertValidScope(scope);
  const now = new Date().toISOString();
  return {
    recipient: {
      id: scope.recipientId,
      displayName: scope.initialDisplayName?.trim() || "돌봄 대상자",
      ageBand: "67",
      allergies: [],
      conditions: [],
      mobilityNote: "",
      accessibilityPreferences: [],
      caregiverNote: "",
      consentConfirmed: false,
      lastConfirmedAt: now,
    },
    medications: [],
    doseEvents: [],
    symptomEvents: [],
    documents: [],
    clinicianQuestions: [],
    todayCheckIn: null,
    dataSource: "firestore",
  };
}

function fromStoredReadModel(model: StoredCareReadModel, scope: CareDataScope): CareSnapshot {
  const fallback = scope.useDemoData ? seed : createInitialCareSnapshot(scope);
  const medications = model.medications ?? fallback.medications;
  return {
    recipient: model.recipient ?? fallback.recipient,
    medications: scope.useDemoData
      ? medications.map((medication) => ({
          ...medication,
          categoryPlain:
            medication.categoryPlain ??
            seed.medications.find((item) => item.id === medication.id)?.categoryPlain ??
            "분류 확인 필요",
        }))
      : medications,
    doseEvents: model.doseEvents ?? fallback.doseEvents,
    symptomEvents: model.symptomEvents ?? fallback.symptomEvents,
    documents: model.documents ?? fallback.documents,
    clinicianQuestions: model.clinicianQuestions ?? fallback.clinicianQuestions,
    todayCheckIn: currentDailyCheckIn(model.todayCheckIn),
    dataSource: "firestore",
  };
}

function readModelRef(
  firestore: Awaited<ReturnType<typeof getAdminFirestore>>,
  recipientId: string,
) {
  return firestore.collection(READ_MODEL_COLLECTION).doc(recipientId);
}

async function canonicalReadModel(
  tx: TransactionLike,
  firestore: FirestoreLike,
  scope: CareDataScope,
): Promise<StoredCareReadModel> {
  const recipientRef = firestore.collection("careRecipients").doc(scope.recipientId);
  const [recipient, medications, doses, symptoms, documents, questions, checkIn] = await Promise.all([
    tx.get(recipientRef),
    tx.get(recipientRef.collection("medicationPlans")),
    tx.get(recipientRef.collection("doseEvents")),
    tx.get(recipientRef.collection("symptomEvents")),
    tx.get(recipientRef.collection("clinicalDocuments")),
    tx.get(recipientRef.collection("clinicianQuestions")),
    tx.get(recipientRef.collection("dailyCheckIns").doc(dateKeyInSeoul(new Date()))),
  ]);
  if (!recipient.exists) {
    // Never replace an orphaned account with an apparently empty account.
    if ([medications, doses, symptoms, documents, questions].some((rows) => rows.docs.length)) {
      throw new Error("돌봄 데이터 원본 복구가 필요합니다.");
    }
    if (scope.useDemoData) throw new Error("데모 세션 데이터가 만료되었습니다.");
    return toStoredReadModel(createInitialCareSnapshot(scope));
  }
  return toStoredReadModel({
    recipient: recipient.data() as CareRecipient,
    medications: medications.docs.map((doc) => doc.data() as MedicationPlan),
    doseEvents: doses.docs.map((doc) => doc.data() as DoseEvent),
    symptomEvents: symptoms.docs.map((doc) => doc.data() as SymptomEvent),
    documents: documents.docs.map((doc) => doc.data() as ClinicalDocument),
    clinicianQuestions: questions.docs.map((doc) => doc.data() as ClinicianQuestion),
    todayCheckIn: checkIn.exists ? checkIn.data() as DailyCheckIn : null,
    dataSource: "firestore",
  });
}

async function assertTransactionScope(tx: TransactionLike, firestore: FirestoreLike, scope: CareDataScope) {
  if (!scope.useDemoData) return;
  const doc = await tx.get(firestore.collection("demoSessions").doc(scope.recipientId));
  const session = doc.data() as { status?: string; expiresAt?: string } | undefined;
  if (!session || session.status !== "active" || Date.parse(session.expiresAt ?? "") <= Date.now()) {
    throw new Error("데모 세션이 만료되었거나 종료되었습니다.");
  }
}

async function getOrCreateReadModel(firestore: FirestoreLike, scope: CareDataScope) {
  assertValidScope(scope);
  await assertActiveDemoScope(scope, firestore);
  const isComplete = (model: StoredCareReadModel) => model.recipient?.id === scope.recipientId &&
    [model.medications, model.doseEvents, model.symptomEvents, model.documents, model.clinicianQuestions].every(Array.isArray);
  const cached = await readModelRef(firestore, scope.recipientId).get();
  if (cached.exists && isComplete(cached.data() as StoredCareReadModel)) return cached.data() as StoredCareReadModel;
  return firestore.runTransaction(async (tx) => {
    await assertTransactionScope(tx, firestore, scope);
    const ref = readModelRef(firestore, scope.recipientId);
    const existing = await tx.get(ref);
    if (existing.exists && isComplete(existing.data() as StoredCareReadModel)) return existing.data() as StoredCareReadModel;
    const model = await canonicalReadModel(tx, firestore, scope);
    const recipientRef = firestore.collection("careRecipients").doc(scope.recipientId);
    const recipient = await tx.get(recipientRef);
    if (!recipient.exists) tx.create(recipientRef, model.recipient);
    if (existing.exists) tx.set(ref, { ...model, revision: ((existing.data() as StoredCareReadModel).revision ?? 0) + 1 });
    else tx.create(ref, { ...model, revision: 0 });
    return model;
  });
}

export async function getCareSnapshot(scope: CareDataScope): Promise<CareSnapshot> {
  assertValidScope(scope);
  const firestore = scope.firestore ?? await getAdminFirestore();
  // Storage failures are failures, never authoritative empty snapshots.
  return fromStoredReadModel(await getOrCreateReadModel(firestore, scope), scope);
}

export async function rebuildCareReadModel(scope: CareDataScope, options: { apply?: boolean } = {}) {
  assertValidScope(scope);
  const firestore = scope.firestore ?? await getAdminFirestore();
  return firestore.runTransaction(async (tx) => {
    await assertTransactionScope(tx, firestore, scope);
    const ref = readModelRef(firestore, scope.recipientId);
    const old = await tx.get(ref);
    const account = await tx.get(firestore.collection("careRecipients").doc(scope.recipientId));
    if (!account.exists) throw new Error("기존 계정의 원본 데이터가 있어야 복구할 수 있습니다.");
    const canonical = await canonicalReadModel(tx, firestore, scope);
    const previous = old.data() as StoredCareReadModel | undefined;
    const records = (items: Array<{ id: string }> | undefined) => Array.isArray(items) ? [...items].sort((a, b) => a.id.localeCompare(b.id)) : null;
    const comparable = (model: StoredCareReadModel | undefined) => model && stableJson({
      recipient: model.recipient, medications: records(model.medications),
      documents: records(model.documents), doseEvents: records(model.doseEvents), symptomEvents: records(model.symptomEvents),
      clinicianQuestions: records(model.clinicianQuestions), todayCheckIn: model.todayCheckIn,
    });
    const repaired = comparable(previous) !== comparable(canonical);
    if (repaired && options.apply !== false) tx.set(ref, { ...canonical, revision: (previous?.revision ?? 0) + 1 });
    return { repaired, snapshot: fromStoredReadModel(canonical, scope) };
  });
}

async function mutateCare<T>(
  scope: CareDataScope,
  currentSnapshot: CareSnapshot | undefined,
  change: (tx: TransactionLike, snapshot: CareSnapshot, recipientRef: DocumentReferenceLike) => Promise<{ snapshot: CareSnapshot; result: T; unchanged?: boolean }>,
  affectsMedications = false,
): Promise<T> {
  assertValidScope(scope);
  if (currentSnapshot && (currentSnapshot.dataSource !== "firestore" || currentSnapshot.recipient.id !== scope.recipientId)) {
    throw new Error("유효한 서버 데이터를 확인한 후 다시 시도해 주세요.");
  }
  const firestore = scope.firestore ?? await getAdminFirestore();
  await getOrCreateReadModel(firestore, scope);
  return firestore.runTransaction(async (tx) => {
    await assertTransactionScope(tx, firestore, scope);
    const modelRef = readModelRef(firestore, scope.recipientId);
    const document = await tx.get(modelRef);
    if (!document.exists) throw new Error("돌봄 데이터를 다시 불러와 주세요.");
    const stored = document.data() as StoredCareReadModel;
    const subscriptions = affectsMedications
      ? await tx.get(firestore.collection("pushSubscriptions").where("recipientId", "==", scope.recipientId)) : null;
    const update = await change(tx, fromStoredReadModel(stored, scope), firestore.collection("careRecipients").doc(scope.recipientId));
    if (update.unchanged) return update.result;
    const revision = (stored.revision ?? 0) + 1;
    tx.set(modelRef, { ...toStoredReadModel(update.snapshot), revision });
    if (affectsMedications && subscriptions?.docs.some((doc) => (doc.data() as { active?: boolean }).active)) {
      // Durable intent and canonical plan updates commit together. No subscription => no reminder writes.
      const now = new Date().toISOString();
      tx.set(firestore.collection("medicationReminderSync").doc(scope.recipientId), {
        recipientId: scope.recipientId, desiredRevision: revision, status: "pending",
        attempts: 0, nextAttemptAt: now, queuedAt: now, errorCode: null, updatedAt: now,
      }, { merge: true });
    }
    return update.result;
  });
}

export async function updateRecipientProfile(scope: CareDataScope, recipient: CareRecipient, currentSnapshot?: CareSnapshot) {
  if (recipient.id !== scope.recipientId) throw new Error("프로필 소유자가 일치하지 않습니다.");
  await mutateCare(scope, currentSnapshot, async (tx, snapshot, ref) => {
    tx.set(ref, recipient);
    return { snapshot: { ...snapshot, recipient }, result: undefined };
  });
}

export async function getTodayDailyCheckIn(scope: CareDataScope): Promise<DailyCheckIn | null> {
  return (await getCareSnapshot(scope)).todayCheckIn ?? null;
}

export async function getPatientQuestionSet(
  scope: CareDataScope,
  questionSetId: string,
): Promise<PatientQuestionSet | null> {
  assertValidScope(scope);
  const firestore = scope.firestore ?? await getAdminFirestore();
  const document = await firestore
    .collection("careRecipients")
    .doc(scope.recipientId)
    .collection("questionSets")
    .doc(questionSetId)
    .get();
  return document.exists ? (document.data() as PatientQuestionSet) : null;
}

export async function saveDailyCheckIn(
  scope: CareDataScope,
  input: DailyCheckInInput & { questionResponse: PatientQuestionResponse },
  currentSnapshot?: CareSnapshot,
) {
  if (input.questionResponse.subject_ref !== scope.recipientId) throw new Error("체크인 소유자가 일치하지 않습니다.");
  await mutateCare(scope, currentSnapshot, async (tx, snapshot, ref) => {
    const questionRef = ref.collection("questionSets").doc(input.questionResponse.question_set_id);
    const question = await tx.get(questionRef);
    if (!question.exists) throw new Error("질문을 다시 불러온 후 저장해 주세요.");
    const update = applyDailyCheckInToSnapshot(snapshot, input);
    for (const event of update.doseEvents) tx.set(ref.collection("doseEvents").doc(event.id), event);
    for (const event of update.replacedSymptomEvents) tx.delete(ref.collection("symptomEvents").doc(event.id));
    for (const event of update.symptomEvents) tx.set(ref.collection("symptomEvents").doc(event.id), event);
    const checkIn: DailyCheckIn = { ...update.checkIn, questionSetId: input.questionResponse.question_set_id, questionResponseId: input.questionResponse.response_id };
    tx.set(ref.collection("dailyCheckIns").doc(checkIn.id), checkIn);
    tx.set(ref.collection("questionResponses").doc(input.questionResponse.response_id), input.questionResponse);
    tx.set(questionRef, { response_status: "answered", answered_at: input.questionResponse.answered_at }, { merge: true });
    return { snapshot: { ...update.nextSnapshot, todayCheckIn: checkIn }, result: undefined };
  });
}

export interface RegisterDocumentInput {
  fileName: string;
  contentHash: string;
  documentType: ClinicalDocumentType;
  size: number;
  isSample: boolean;
  analysis: ClinicalDocument["analysis"];
}

export async function registerDocument(scope: CareDataScope, input: RegisterDocumentInput) {
  if (!/^[^/]{1,256}$/.test(input.contentHash)) throw new Error("올바르지 않은 문서 식별자입니다.");
  return mutateCare(scope, undefined, async (tx, snapshot, ref) => {
    const documentRef = ref.collection("clinicalDocuments").doc(input.contentHash);
    const existing = await tx.get(documentRef);
    if (existing.exists) return { snapshot, result: existing.data() as ClinicalDocument & { size: number }, unchanged: true };
    const document: ClinicalDocument & { size: number } = {
      id: documentRef.id, fileName: input.fileName, contentHash: input.contentHash,
      documentType: input.documentType, uploadedAt: new Date().toISOString(),
      status: "confirmed", redacted: input.isSample,
      sourceLabel: input.analysis?.source === "api" ? "API 분석 완료 · 보호자 확인 필요"
        : input.analysis?.source === "openai" ? "OpenAI 분석 완료 · 보호자 확인 필요" : "비식별 데모 분석 · 원본과 확인 필요",
      size: input.size, analysis: input.analysis,
    };
    const medications = medicationPlansFromPrescription(document);
    tx.create(documentRef, document);
    for (const medication of medications) tx.create(ref.collection("medicationPlans").doc(medication.id), medication);
    return {
      snapshot: { ...snapshot, medications: [...snapshot.medications, ...medications], documents: [document, ...snapshot.documents] },
      result: document,
    };
  }, true);
}

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function medicationPlansFromPrescription(
  document: Pick<ClinicalDocument, "id" | "documentType" | "uploadedAt" | "analysis">,
): MedicationPlan[] {
  if (document.documentType !== "처방전") return [];
  const sourceMedications = document.analysis?.medications ?? [];
  const uploadedDate = dateKeyInSeoul(new Date(document.uploadedAt));

  return sourceMedications
    .filter((medication) => medication.productName.trim() && medication.frequency.trim())
    .map((medication, index) => {
      const startDate = isoDatePattern.test(medication.startDate)
        ? medication.startDate
        : uploadedDate;
      const endDate = medication.endDate && isoDatePattern.test(medication.endDate)
        ? medication.endDate
        : undefined;
      return {
        id: `rx-${document.id}-${index + 1}`,
        productName: medication.productName.trim(),
        ingredientName: medication.ingredientName.trim() || "성분 확인 필요",
        categoryPlain: "처방약",
        purposePlain: medication.purposePlain.trim() || "처방 목적을 의료진에게 확인해주세요.",
        descriptionPlain: "처방전에서 확인한 복용약이에요. 약 봉투와 원본 처방전을 함께 확인해주세요.",
        doseAmount: medication.doseAmount.trim() || "1회 복용량 확인 필요",
        frequency: medication.frequency.trim(),
        timing: medication.timing.trim() || "복용 시간 확인 필요",
        startDate,
        ...(endDate ? { endDate } : {}),
        status: "active" as const,
        isNew: true,
        sourceLabel: "처방전 분석에서 자동 등록 · 보호자 확인 필요",
        sourceDocumentId: document.id,
        watchFor: medication.precautions.filter(Boolean),
      };
    });
}

export async function deleteDocument(scope: CareDataScope, documentId: string, currentSnapshot?: CareSnapshot) {
  if (!/^[^/]{1,256}$/.test(documentId)) throw new Error("올바르지 않은 문서 식별자입니다.");
  return mutateCare(scope, currentSnapshot, async (tx, snapshot, ref) => {
    const document = await tx.get(ref.collection("clinicalDocuments").doc(documentId));
    if (!document.exists) return { snapshot, result: snapshot, unchanged: true };
    const nextSnapshot: CareSnapshot = {
      ...snapshot,
      medications: snapshot.medications.filter((item) => item.sourceDocumentId !== documentId),
      documents: snapshot.documents.filter((item) => item.id !== documentId),
    };
    tx.delete(document.ref);
    for (const medication of snapshot.medications) {
      if (medication.sourceDocumentId === documentId) tx.delete(ref.collection("medicationPlans").doc(medication.id));
    }
    return { snapshot: nextSnapshot, result: nextSnapshot };
  }, true);
}
