import demoSeed from "./data/demo-seed.json" with { type: "json" };
import { assertCareAccountActive } from "./account-lifecycle.ts";
import { assertHealthDataConsentConfirmed } from "./health-data-consent.ts";
import type {
  CareRecipient,
  CareSnapshot,
  ClinicalDocument,
  ClinicalDocumentType,
  ClinicianQuestion,
  DailyCheckIn,
  DoseEvent,
  DoseObservation,
  DocumentAnalysis,
  MedicationPlan,
  MedicationPlanCandidate,
  MedicationPlanDraft,
  PatientQuestionResponse,
  PatientQuestionSet,
  SymptomEvent,
  SymptomObservation,
} from "./types.ts";

import { getAdminFirestore } from "./firebase-admin.ts";
import { isEphemeralDemoSessionActive } from "./demo-session.ts";
import type { FirestoreLike, TransactionLike, DocumentReferenceLike } from "./firestore-rest.ts";
import { stableJson } from "./stable-json.ts";
import { conditionFromDiagnosis } from "./nutrition.ts";
import { DocumentAnalysisCancelledError } from "./document-analysis-jobs.ts";
import { normalizeMedicationRecurrence } from "./medication-schedule.ts";
import { projectDoseObservations, projectSymptomObservations } from "./observations.ts";
import {
  addCalendarDays,
  dateKeyInSeoul,
} from "./dates.ts";
import {
  applyDailyCheckInToSnapshot,
  byDateDescending,
  currentDailyCheckIn,
  MAX_DOCUMENTS,
  MAX_DOSE_EVENTS,
  MAX_SYMPTOM_EVENTS,
  type DailyCheckInInput,
} from "./care-read-model.ts";

export type CareDataScope = {
  recipientId: string;
  initialDisplayName?: string;
  useDemoData?: boolean;
  /** Server-derived connected-session fence; never populated from client input. */
  connection?: { connectionId: string; sessionVersion: string };
  /** Internal dependency injection; never populated from client input. */
  firestore?: FirestoreLike;
};

const READ_MODEL_COLLECTION = "careReadModels";

type DemoSeed = Omit<CareSnapshot, "dataSource" | "revision">;
type StoredCareReadModel = Omit<CareSnapshot, "dataSource" | "revision"> & {
  updatedAt: string;
  revision?: number;
};

const seed = demoSeed as DemoSeed;

function patientAnswerLabel(
  question: PatientQuestionSet["questions"][number],
  answer: PatientQuestionResponse["responses"][number]["answer"],
) {
  if (answer === null) return undefined;
  const values = Array.isArray(answer) ? answer : [answer];
  return values.map((value) => {
    const text = String(value);
    return question.options.find((option) => option.value === text)?.label ?? text;
  }).join(", ");
}

export function projectClinicianQuestions(
  questionSet: PatientQuestionSet,
  response?: PatientQuestionResponse,
): ClinicianQuestion[] {
  const answers = new Map(
    (response?.responses ?? []).map((item) => [item.question_id, item]),
  );
  return questionSet.questions.map((question) => {
    const responseItem = answers.get(question.question_id);
    const answer = responseItem && !responseItem.skipped
      ? patientAnswerLabel(question, responseItem.answer)
      : undefined;
    const answered = answer !== undefined;
    return {
      id: `${questionSet.question_set_id}:${question.question_id}`,
      priority: ["urgent", "blocking", "high"].includes(question.priority)
        ? "today"
        : "next_visit",
      question: questionSet.answerer === "recipient"
        ? question.display.recipient_text
        : question.display.caregiver_text,
      reason: question.display.helper_text,
      status: answered ? "answered" : "open",
      ...(answer ? { answer } : {}),
      ...(answered && response ? { answeredAt: response.answered_at } : {}),
      sourceQuestionSetId: questionSet.question_set_id,
      sourceQuestionId: question.question_id,
      triggerRefs: [...question.trigger_refs],
      evidenceLevel: answered
        ? response?.answered_by === "recipient"
          ? "recipient_reported"
          : "caregiver_reported"
        : "unconfirmed",
    } satisfies ClinicianQuestion;
  });
}

async function clinicianQuestionsFromActualAccount(
  firestore: FirestoreLike,
  scope: CareDataScope,
  fallback: ClinicianQuestion[],
) {
  const recipient = firestore.collection("careRecipients").doc(scope.recipientId);
  const questionSets = await recipient.collection("questionSets")
    .orderBy("generated_at", "desc")
    .limit(1)
    .get();
  const questionSet = questionSets.docs[0]?.data() as PatientQuestionSet | undefined;
  if (!questionSet || questionSet.subject_ref !== scope.recipientId) return fallback;
  const responses = await recipient.collection("questionResponses")
    .where("question_set_id", "==", questionSet.question_set_id)
    .get();
  const response = responses.docs
    .map((document) => document.data() as PatientQuestionResponse)
    .filter((item) => item.subject_ref === scope.recipientId)
    .sort((left, right) => right.answered_at.localeCompare(left.answered_at))[0];
  return projectClinicianQuestions(questionSet, response);
}

async function assertActiveDemoScope(
  scope: CareDataScope,
  firestore: FirestoreLike,
) {
  await assertCareAccountActive(firestore, scope.recipientId);
  if (scope.connection) {
    const document = await firestore.collection("careConnections").doc(scope.recipientId).get();
    const connection = document.data() as { status?: string; connectionId?: string; sessionVersion?: string; expiresAt?: string } | undefined;
    if (!connection || connection.status !== "active" || connection.connectionId !== scope.connection.connectionId ||
        connection.sessionVersion !== scope.connection.sessionVersion || Date.parse(connection.expiresAt ?? "") <= Date.now()) {
      throw new Error("연결 사용자 세션이 만료되었어요.");
    }
  }
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
  return {
    recipient: {
      id: scope.recipientId,
      displayName: scope.initialDisplayName?.trim() || "",
      ageBand: "",
      allergies: [],
      conditions: [],
      confirmedConditions: [],
      supplementIntakes: [],
      mobilityNote: "",
      accessibilityPreferences: [],
      caregiverNote: "",
      consentConfirmed: false,
      lastConfirmedAt: "",
    },
    medications: [],
    doseEvents: [],
    symptomEvents: [],
    documents: [],
    clinicianQuestions: [],
    todayCheckIn: null,
    dataSource: "firestore",
    revision: 0,
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
    revision: model.revision ?? 0,
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
  const [recipient, medications, doses, symptoms, doseObservations, symptomObservations, documents, questions, checkIn] = await Promise.all([
    tx.get(recipientRef),
    tx.get(recipientRef.collection("medicationPlans")),
    tx.get(recipientRef.collection("doseEvents")),
    tx.get(recipientRef.collection("symptomEvents")),
    tx.get(recipientRef.collection("doseObservations")),
    tx.get(recipientRef.collection("symptomObservations")),
    tx.get(recipientRef.collection("clinicalDocuments")),
    tx.get(recipientRef.collection("clinicianQuestions")),
    tx.get(recipientRef.collection("dailyCheckIns").doc(dateKeyInSeoul(new Date()))),
  ]);
  if (!recipient.exists) {
    // Never replace an orphaned account with an apparently empty account.
    if ([medications, doses, symptoms, doseObservations, symptomObservations, documents, questions].some((rows) => rows.docs.length)) {
      throw new Error("돌봄 데이터 원본 복구가 필요합니다.");
    }
    if (scope.useDemoData) throw new Error("데모 세션 데이터가 만료되었습니다.");
    return toStoredReadModel(createInitialCareSnapshot(scope));
  }
  return toStoredReadModel({
    recipient: recipient.data() as CareRecipient,
    medications: medications.docs.map((doc) => doc.data() as MedicationPlan),
    doseEvents: projectDoseObservations(
      doseObservations.docs.map((doc) => doc.data() as DoseObservation),
      doses.docs.map((doc) => doc.data() as DoseEvent),
    ),
    symptomEvents: projectSymptomObservations(
      symptomObservations.docs.map((doc) => doc.data() as SymptomObservation),
      symptoms.docs.map((doc) => doc.data() as SymptomEvent),
    ),
    documents: documents.docs.map((doc) => doc.data() as ClinicalDocument),
    clinicianQuestions: questions.docs.map((doc) => doc.data() as ClinicianQuestion),
    todayCheckIn: checkIn.exists ? checkIn.data() as DailyCheckIn : null,
    dataSource: "firestore",
    revision: 0,
  });
}

async function assertTransactionScope(tx: TransactionLike, firestore: FirestoreLike, scope: CareDataScope) {
  await assertCareAccountActive(firestore, scope.recipientId, tx);
  if (scope.connection) {
    const document = await tx.get(firestore.collection("careConnections").doc(scope.recipientId));
    const connection = document.data() as { status?: string; connectionId?: string; sessionVersion?: string; expiresAt?: string } | undefined;
    if (!connection || connection.status !== "active" || connection.connectionId !== scope.connection.connectionId ||
        connection.sessionVersion !== scope.connection.sessionVersion || Date.parse(connection.expiresAt ?? "") <= Date.now()) {
      throw new Error("연결 사용자 세션이 만료되었어요.");
    }
  }
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
  const snapshot = fromStoredReadModel(await getOrCreateReadModel(firestore, scope), scope);
  return {
    ...snapshot,
    clinicianQuestions: await clinicianQuestionsFromActualAccount(
      firestore,
      scope,
      snapshot.clinicianQuestions,
    ),
  };
}

export async function getCareRevision(scope: CareDataScope): Promise<number> {
  assertValidScope(scope);
  const firestore = scope.firestore ?? await getAdminFirestore();
  return (await getOrCreateReadModel(firestore, scope)).revision ?? 0;
}

export class CareConflictError extends Error {
  constructor() {
    super("CARE_DATA_REVISION_CONFLICT");
    this.name = "CareConflictError";
  }
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
  options: { affectsMedications?: boolean; requiresConsent?: boolean; expectedRevision?: number } = {},
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
    if (options.expectedRevision !== undefined && (stored.revision ?? 0) !== options.expectedRevision) {
      throw new CareConflictError();
    }
    const subscriptions = options.affectsMedications
      ? await tx.get(firestore.collection("pushSubscriptions").where("recipientId", "==", scope.recipientId)) : null;
    if (options.requiresConsent) {
      await assertHealthDataConsentConfirmed(firestore, scope.recipientId, tx);
    }
    const update = await change(tx, fromStoredReadModel(stored, scope), firestore.collection("careRecipients").doc(scope.recipientId));
    if (update.unchanged) return update.result;
    const revision = (stored.revision ?? 0) + 1;
    tx.set(modelRef, { ...toStoredReadModel(update.snapshot), revision });
    if (options.affectsMedications && subscriptions?.docs.some((doc) => (doc.data() as { active?: boolean }).active)) {
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

export async function updateRecipientProfile(scope: CareDataScope, recipient: CareRecipient, currentSnapshot?: CareSnapshot, expectedRevision?: number) {
  if (recipient.id !== scope.recipientId) throw new Error("프로필 소유자가 일치하지 않습니다.");
  await mutateCare(scope, currentSnapshot, async (tx, snapshot, ref) => {
    tx.set(ref, recipient);
    return { snapshot: { ...snapshot, recipient }, result: undefined };
  }, { expectedRevision });
}

export async function confirmDocumentDiagnoses(
  scope: CareDataScope,
  documentId: string,
) {
  if (!/^[^/]{1,256}$/.test(documentId)) throw new Error("올바르지 않은 문서 식별자입니다.");
  return mutateCare(scope, undefined, async (tx, snapshot, ref) => {
    const document = snapshot.documents.find((item) => item.id === documentId);
    if (!document || document.documentType !== "진단서") {
      throw new Error("확인할 진단서를 찾지 못했어요.");
    }
    const diagnoses = document.analysis?.diagnoses ?? [];
    const confirmedAt = new Date().toISOString();
    const additions = diagnoses.flatMap((diagnosis) => {
      const condition = conditionFromDiagnosis(diagnosis, {
        documentId,
        sourceLabel: "진단서에서 확인 후 보호자가 확정",
        confirmedAt,
      });
      return condition ? [condition] : [];
    });
    if (additions.length === 0) throw new Error("MVP에서 지원하는 확정 질환을 찾지 못했어요.");
    const existingIds = new Set((snapshot.recipient.confirmedConditions ?? []).map((condition) => condition.id));
    if (additions.every((condition) => existingIds.has(condition.id))) {
      return { snapshot, result: additions, unchanged: true };
    }
    const merged = new Map(
      [...(snapshot.recipient.confirmedConditions ?? []), ...additions].map((condition) => [condition.id, condition]),
    );
    const recipient = { ...snapshot.recipient, confirmedConditions: [...merged.values()], lastConfirmedAt: confirmedAt };
    tx.set(ref, recipient);
    return { snapshot: { ...snapshot, recipient }, result: additions };
  }, { requiresConsent: true });
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

export async function getPatientQuestionResponse(
  scope: CareDataScope,
  responseId: string,
): Promise<PatientQuestionResponse | null> {
  assertValidScope(scope);
  const firestore = scope.firestore ?? await getAdminFirestore();
  const document = await firestore
    .collection("careRecipients")
    .doc(scope.recipientId)
    .collection("questionResponses")
    .doc(responseId)
    .get();
  if (!document.exists) return null;
  const response = document.data() as PatientQuestionResponse;
  return response.subject_ref === scope.recipientId ? response : null;
}

export async function saveDailyCheckIn(
  scope: CareDataScope,
  input: DailyCheckInInput & { questionResponse: PatientQuestionResponse },
  currentSnapshot?: CareSnapshot,
  expectedRevision?: number,
) {
  if (input.questionResponse.subject_ref !== scope.recipientId) throw new Error("체크인 소유자가 일치하지 않습니다.");
  await mutateCare(scope, currentSnapshot, async (tx, snapshot, ref) => {
    const questionRef = ref.collection("questionSets").doc(input.questionResponse.question_set_id);
    const question = await tx.get(questionRef);
    if (!question.exists) throw new Error("질문을 다시 불러온 후 저장해 주세요.");
    const update = applyDailyCheckInToSnapshot(snapshot, input);
    await persistObservations(tx, ref, update.doseObservations, update.symptomObservations);
    const checkIn: DailyCheckIn = { ...update.checkIn, questionSetId: input.questionResponse.question_set_id, questionResponseId: input.questionResponse.response_id };
    tx.set(ref.collection("dailyCheckIns").doc(checkIn.id), checkIn);
    tx.set(ref.collection("questionResponses").doc(input.questionResponse.response_id), input.questionResponse);
    tx.set(questionRef, { response_status: "answered", answered_at: input.questionResponse.answered_at }, { merge: true });
    return { snapshot: { ...update.nextSnapshot, todayCheckIn: checkIn }, result: undefined };
  }, { requiresConsent: true, expectedRevision });
}

export async function saveWellbeingCheckIn(
  scope: CareDataScope,
  input: Omit<DailyCheckInInput, "doseResponses" | "scope" | "inputSource">,
  currentSnapshot?: CareSnapshot,
  expectedRevision?: number,
) {
  await mutateCare(scope, currentSnapshot, async (tx, snapshot, ref) => {
    const update = applyDailyCheckInToSnapshot(snapshot, {
      ...input,
      doseResponses: [],
      scope: "wellbeing",
      inputSource: "quick_wellbeing",
    });
    await persistObservations(tx, ref, update.doseObservations, update.symptomObservations);
    tx.set(ref.collection("dailyCheckIns").doc(update.checkIn.id), update.checkIn);
    return { snapshot: update.nextSnapshot, result: undefined };
  }, { requiresConsent: true, expectedRevision });
}

async function persistObservations(
  tx: TransactionLike,
  recipientRef: DocumentReferenceLike,
  doses: DoseObservation[],
  symptoms: SymptomObservation[],
) {
  const rows = [
    ...doses.map((observation) => ({ collection: "doseObservations", observation })),
    ...symptoms.map((observation) => ({ collection: "symptomObservations", observation })),
  ];
  const writes: typeof rows = [];
  for (const row of rows) {
    const document = await tx.get(recipientRef.collection(row.collection).doc(row.observation.id));
    if (!document.exists) writes.push(row);
    else if (stableJson(document.data()) !== stableJson(row.observation)) {
      throw new Error("OBSERVATION_IDEMPOTENCY_CONFLICT");
    }
  }
  for (const row of writes) tx.create(recipientRef.collection(row.collection).doc(row.observation.id), row.observation);
}

export async function getObservationHistory(scope: CareDataScope) {
  assertValidScope(scope);
  const firestore = scope.firestore ?? await getAdminFirestore();
  await assertActiveDemoScope(scope, firestore);
  const ref = firestore.collection("careRecipients").doc(scope.recipientId);
  const [doses, symptoms] = await Promise.all([
    ref.collection("doseObservations").get(),
    ref.collection("symptomObservations").get(),
  ]);
  const byRecordedAt = <T extends { id: string; recordedAt: string }>(left: T, right: T) =>
    right.recordedAt.localeCompare(left.recordedAt) || right.id.localeCompare(left.id);
  return {
    doseObservations: doses.docs.map((document) => document.data() as DoseObservation).sort(byRecordedAt),
    symptomObservations: symptoms.docs.map((document) => document.data() as SymptomObservation).sort(byRecordedAt),
  };
}

export interface RegisterDocumentInput {
  fileName: string;
  contentHash: string;
  documentType: ClinicalDocumentType;
  size: number;
  isSample: boolean;
  analysis: ClinicalDocument["analysis"];
  requestIdempotencyKey?: string;
  duplicateAction?: "merge" | "separate";
  analysisJobId?: string;
}

export interface MedicationDuplicateCandidate {
  incomingMedicationId: string;
  existingMedicationPlanId: string;
  existingDocumentId?: string;
  productName: string;
  fingerprint: string;
}

export interface DocumentImportReview {
  id: string;
  contentHash: string;
  fileName: string;
  documentType: ClinicalDocumentType;
  size: number;
  isSample: boolean;
  analysis: DocumentAnalysis;
  duplicateCandidates: MedicationDuplicateCandidate[];
  status: "needs_resolution" | "resolved";
  createdAt: string;
  expiresAt: string;
}

export class MedicationDuplicateResolutionRequiredError extends Error {
  readonly code = "MEDICATION_DUPLICATE_RESOLUTION_REQUIRED";
  readonly candidates: MedicationDuplicateCandidate[];

  constructor(candidates: MedicationDuplicateCandidate[]) {
    super("기존 복약과 겹치는 후보가 있어 병합 또는 별도 등록을 선택해야 합니다.");
    this.name = "MedicationDuplicateResolutionRequiredError";
    this.candidates = candidates;
  }
}

function normalizedMedicationFingerprintPart(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function medicationPlanFingerprint(
  medication: Pick<MedicationPlan, "productName" | "ingredientName" | "doseAmount" | "frequency" | "timing" | "startDate" | "endDate">,
) {
  return [
    medication.productName,
    medication.ingredientName,
    medication.doseAmount,
    medication.frequency,
    medication.timing,
    medication.startDate,
    medication.endDate ?? "",
  ].map(normalizedMedicationFingerprintPart).join("|");
}

export function findMedicationDuplicateCandidates(
  incoming: MedicationPlan[],
  existing: MedicationPlan[],
): MedicationDuplicateCandidate[] {
  const existingByFingerprint = new Map<string, MedicationPlan[]>();
  for (const medication of existing) {
    const fingerprint = medicationPlanFingerprint(medication);
    existingByFingerprint.set(fingerprint, [...(existingByFingerprint.get(fingerprint) ?? []), medication]);
  }
  return incoming.flatMap((medication) => {
    const fingerprint = medicationPlanFingerprint(medication);
    return (existingByFingerprint.get(fingerprint) ?? []).map((matched) => ({
      incomingMedicationId: medication.id,
      existingMedicationPlanId: matched.id,
      ...(matched.sourceDocumentId ? { existingDocumentId: matched.sourceDocumentId } : {}),
      productName: medication.productName,
      fingerprint,
    }));
  });
}

export const MEDICATION_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function medicationDraftId(documentId: string) {
  return `draft-${documentId}`;
}

function documentRevision(input: Pick<RegisterDocumentInput, "contentHash">) {
  return `sha256:${input.contentHash}`;
}

function createMedicationPlanDraft(
  documentId: string,
  sourceDocumentRevision: string,
  analysis: ClinicalDocument["analysis"],
  now: Date,
): MedicationPlanDraft | null {
  const medications = analysis?.documentType === "처방전" ? analysis.medications ?? [] : [];
  if (medications.length === 0) return null;
  const timestamp = now.toISOString();
  const id = medicationDraftId(documentId);
  const prescriptionDate = validCalendarDate(analysis?.prescriptionDate);
  const totalSupplyDays = validSupplyDays(analysis?.totalSupplyDays);
  return {
    id,
    documentId,
    sourceDocumentRevision,
    revision: 1,
    state: "needs_review",
    candidates: medications.map((medication, index) => {
      const startDate = validCalendarDate(medication.startDate) ?? prescriptionDate ?? "";
      const explicitEndDate = validCalendarDate(medication.endDate);
      const endDate = explicitEndDate ?? (startDate && totalSupplyDays
        ? addCalendarDays(startDate, totalSupplyDays - 1)
        : undefined);
      return {
        ...medication,
        startDate,
        ...(endDate ? { endDate } : {}),
        id: `${id}-candidate-${index + 1}`,
        included: medication.reviewStatus === "verified",
        state: "needs_review",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    }),
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: new Date(now.getTime() + MEDICATION_DRAFT_TTL_MS).toISOString(),
    transitionHistory: [
      { state: "draft", at: timestamp, by: "document-analysis" },
      { state: "needs_review", at: timestamp, by: "document-analysis" },
    ],
  };
}

export async function registerDocument(scope: CareDataScope, input: RegisterDocumentInput) {
  if (!/^[^/]{1,256}$/.test(input.contentHash)) throw new Error("올바르지 않은 문서 식별자입니다.");
  const requestIdempotencyKey = input.requestIdempotencyKey ?? input.contentHash;
  if (!/^[^/]{1,256}$/.test(requestIdempotencyKey)) throw new Error("올바르지 않은 요청 식별자입니다.");
  return mutateCare(scope, undefined, async (tx, snapshot, ref) => {
    const documentRef = ref.collection("clinicalDocuments").doc(input.contentHash);
    const requestRef = ref.collection("documentImportRequests").doc(requestIdempotencyKey);
    const reviewRef = ref.collection("documentImportReviews").doc(requestIdempotencyKey);
    const analysisJobRef = input.analysisJobId
      ? ref.collection("documentAnalysisJobs").doc(input.analysisJobId)
      : null;
    const [requestRecord, review, analysisJob] = await Promise.all([
      tx.get(requestRef),
      tx.get(reviewRef),
      analysisJobRef ? tx.get(analysisJobRef) : null,
    ]);
    if (analysisJobRef && (!analysisJob?.exists || ["cancellation_requested", "cancelled"].includes(
      (analysisJob.data() as { state?: string } | undefined)?.state ?? "",
    ))) {
      throw new DocumentAnalysisCancelledError();
    }
    if (requestRecord.exists) {
      const recorded = requestRecord.data() as { contentHash?: string };
      if (recorded.contentHash !== input.contentHash) {
        throw new Error("같은 요청 식별자가 다른 문서에 사용됐습니다.");
      }
    }

    const existing = await tx.get(documentRef);
    if (existing.exists) {
      if (!requestRecord.exists) {
        tx.create(requestRef, {
          contentHash: input.contentHash,
          documentId: documentRef.id,
          status: "completed",
          completedAt: new Date().toISOString(),
        });
      }
      return { snapshot, result: existing.data() as ClinicalDocument & { size: number }, unchanged: true };
    }

    const now = new Date();
    const revision = documentRevision(input);
    const candidateMedications = medicationPlansFromPrescription({
      id: documentRef.id,
      documentType: input.documentType,
      uploadedAt: now.toISOString(),
      analysis: input.analysis,
    });
    const duplicateCandidates = findMedicationDuplicateCandidates(candidateMedications, snapshot.medications);
    if (duplicateCandidates.length > 0 && !input.duplicateAction) {
      throw new MedicationDuplicateResolutionRequiredError(duplicateCandidates);
    }
    if (duplicateCandidates.length === 0 && input.duplicateAction === "merge") {
      throw new Error("병합할 기존 복약 계획을 찾을 수 없습니다.");
    }

    const requiresMedicationReview = input.documentType === "처방전" &&
      (input.analysis?.medications ?? []).some((medication) => medication.reviewStatus !== "verified");
    const draft = input.duplicateAction === "merge"
      ? null
      : createMedicationPlanDraft(documentRef.id, revision, input.analysis, now);
    const document: ClinicalDocument & { size: number } = {
      id: documentRef.id,
      fileName: input.fileName,
      contentHash: input.contentHash,
      documentType: input.documentType,
      uploadedAt: now.toISOString(),
      status: draft ? "needs_review" : "confirmed",
      redacted: input.isSample,
      sourceLabel: input.duplicateAction === "merge"
        ? "기존 복약과 병합 · 중복 일정 미생성"
        : draft && requiresMedicationReview
          ? "OCR·공식 정보 대조 필요 · 복약 초안"
          : draft
            ? "분석 초안 · 복약 일정 반영 전 검토 필요"
            : input.analysis?.source === "api"
              ? "API 분석 완료"
              : input.analysis?.source === "openai"
                ? "OpenAI 분석 완료"
                : "비식별 데모 분석 · 원본과 확인 필요",
      revision,
      ...(draft ? { medicationDraftId: draft.id } : {}),
      size: input.size,
      analysis: input.analysis,
      requestIdempotencyKey,
      ...(duplicateCandidates.length > 0 && input.duplicateAction
        ? {
            duplicateResolution: input.duplicateAction,
            duplicateMedicationPlanIds: [...new Set(duplicateCandidates.map((candidate) => candidate.existingMedicationPlanId))],
          }
        : {}),
    };

    tx.create(documentRef, document);
    if (draft) tx.create(ref.collection("medicationPlanDrafts").doc(draft.id), draft);
    const completedRequest = {
      contentHash: input.contentHash,
      documentId: document.id,
      status: "completed",
      completedAt: now.toISOString(),
      duplicateResolution: input.duplicateAction ?? null,
    };
    if (requestRecord.exists) tx.set(requestRef, completedRequest);
    else tx.create(requestRef, completedRequest);
    if (review.exists) tx.set(reviewRef, { status: "resolved", resolvedAt: now.toISOString() }, { merge: true });

    return {
      snapshot: { ...snapshot, documents: [document, ...snapshot.documents] },
      result: document,
    };
  }, { requiresConsent: true });
}

export async function saveDocumentImportReview(
  scope: CareDataScope,
  input: Omit<DocumentImportReview, "id" | "status" | "createdAt" | "expiresAt"> & {
    idempotencyKey: string;
    analysisJobId?: string;
  },
) {
  assertValidScope(scope);
  if (!/^[^/]{1,256}$/.test(input.idempotencyKey)) throw new Error("올바르지 않은 요청 식별자입니다.");
  const firestore = scope.firestore ?? await getAdminFirestore();
  await assertActiveDemoScope(scope, firestore);
  await assertHealthDataConsentConfirmed(firestore, scope.recipientId);
  await getOrCreateReadModel(firestore, scope);
  return firestore.runTransaction(async (tx) => {
    await assertTransactionScope(tx, firestore, scope);
    const ref = firestore.collection("careRecipients").doc(scope.recipientId)
      .collection("documentImportReviews").doc(input.idempotencyKey);
    const analysisJobRef = input.analysisJobId
      ? firestore.collection("careRecipients").doc(scope.recipientId)
        .collection("documentAnalysisJobs").doc(input.analysisJobId)
      : null;
    const [existing, analysisJob] = await Promise.all([
      tx.get(ref),
      analysisJobRef ? tx.get(analysisJobRef) : null,
    ]);
    if (analysisJobRef && (!analysisJob?.exists || ["cancellation_requested", "cancelled"].includes(
      (analysisJob.data() as { state?: string } | undefined)?.state ?? "",
    ))) {
      throw new DocumentAnalysisCancelledError();
    }
    if (existing.exists) {
      const review = existing.data() as DocumentImportReview;
      if (review.contentHash !== input.contentHash) throw new Error("같은 요청 식별자가 다른 문서에 사용됐습니다.");
      return review;
    }
    const now = new Date();
    const review: DocumentImportReview = {
      id: input.idempotencyKey,
      contentHash: input.contentHash,
      fileName: input.fileName,
      documentType: input.documentType,
      size: input.size,
      isSample: input.isSample,
      analysis: input.analysis,
      duplicateCandidates: input.duplicateCandidates,
      status: "needs_resolution",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    };
    tx.create(ref, review);
    return review;
  });
}

export async function getDocumentImportReview(
  scope: CareDataScope,
  idempotencyKey: string,
  contentHash: string,
): Promise<DocumentImportReview | null> {
  assertValidScope(scope);
  if (!/^[^/]{1,256}$/.test(idempotencyKey)) throw new Error("올바르지 않은 요청 식별자입니다.");
  const firestore = scope.firestore ?? await getAdminFirestore();
  await assertActiveDemoScope(scope, firestore);
  await assertHealthDataConsentConfirmed(firestore, scope.recipientId);
  const document = await firestore.collection("careRecipients").doc(scope.recipientId)
    .collection("documentImportReviews").doc(idempotencyKey).get();
  if (!document.exists) return null;
  const review = document.data() as DocumentImportReview;
  if (review.contentHash !== contentHash) throw new Error("같은 요청 식별자가 다른 문서에 사용됐습니다.");
  if (review.status !== "needs_resolution" || Date.parse(review.expiresAt) <= Date.now()) return null;
  return review;
}

export async function getMedicationPlanDraft(
  scope: CareDataScope,
  draftId: string,
): Promise<MedicationPlanDraft | null> {
  assertValidScope(scope);
  if (!/^[^/]{1,256}$/.test(draftId)) throw new Error("올바르지 않은 복약 초안 ID입니다.");
  const firestore = scope.firestore ?? await getAdminFirestore();
  await assertActiveDemoScope(scope, firestore);
  await assertHealthDataConsentConfirmed(firestore, scope.recipientId);
  const draft = await firestore.collection("careRecipients").doc(scope.recipientId)
    .collection("medicationPlanDrafts").doc(draftId).get();
  return draft.exists ? draft.data() as MedicationPlanDraft : null;
}

export interface MedicationCandidateConfirmation {
  id: string;
  included: boolean;
  productName: string;
  ingredientName: string;
  doseAmount: string;
  frequency: string;
  timing: string;
  startDate: string;
  endDate?: string;
}

export interface ConfirmMedicationPlanDraftInput {
  draftId: string;
  revision: number;
  idempotencyKey: string;
  confirmedBy: string;
  candidates: MedicationCandidateConfirmation[];
}

export interface MedicationPlanConfirmationResult {
  draft: MedicationPlanDraft;
  medications: MedicationPlan[];
  idempotentReplay: boolean;
}

function assertValidConfirmationInput(input: ConfirmMedicationPlanDraftInput) {
  if (!/^[^/]{1,256}$/.test(input.draftId)) throw new Error("올바르지 않은 복약 초안 ID입니다.");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.idempotencyKey)) throw new Error("올바르지 않은 확정 요청 식별자입니다.");
  if (!input.confirmedBy.trim()) throw new Error("확인 사용자를 확인할 수 없습니다.");
  if (!Number.isInteger(input.revision) || input.revision < 1) throw new Error("복약 초안 revision을 확인해주세요.");
  if (input.candidates.length === 0 || input.candidates.length > 50) throw new Error("확정할 복약 후보를 선택해주세요.");
  if (new Set(input.candidates.map((candidate) => candidate.id)).size !== input.candidates.length) {
    throw new Error("중복된 복약 후보가 있어요.");
  }
}

function confirmedMedicationPlan(
  draft: MedicationPlanDraft,
  candidate: MedicationPlanCandidate,
  input: MedicationCandidateConfirmation,
  confirmedBy: string,
  confirmedAt: string,
): MedicationPlan {
  const required = [input.productName, input.doseAmount, input.frequency, input.timing, input.startDate, input.endDate];
  if (required.some((value) => !value?.trim())) throw new Error("약 이름과 복용 기간을 포함한 일정 필수값을 확인해주세요.");
  const startDate = validCalendarDate(input.startDate);
  const endDate = validCalendarDate(input.endDate);
  if (!startDate || startDate !== input.startDate) throw new Error("복용 시작일을 YYYY-MM-DD로 입력해주세요.");
  if (!endDate || endDate !== input.endDate || endDate < startDate) {
    throw new Error("복용 종료일을 시작일 이후로 입력해주세요.");
  }
  return {
    id: `rx-${draft.documentId}-${candidate.id.slice(-12)}`,
    productName: input.productName.trim(),
    ingredientName: input.ingredientName.trim() || "성분 확인 필요",
    categoryPlain: "처방약",
    purposePlain: candidate.purposePlain.trim() || "처방 목적을 의료진에게 확인해주세요.",
    descriptionPlain: "처방전 분석 초안을 보호자가 검토하고 확정한 복용약이에요.",
    doseAmount: input.doseAmount.trim(),
    frequency: input.frequency.trim(),
    recurrence: normalizeMedicationRecurrence(input.frequency),
    timing: input.timing.trim(),
    startDate,
    endDate,
    status: endDate < dateKeyInSeoul(new Date(confirmedAt)) ? "ended" : "active",
    isNew: true,
    sourceLabel: "처방전 분석 초안 · 보호자 검토 완료",
    sourceDocumentId: draft.documentId,
    watchFor: candidate.precautions.filter(Boolean),
    confirmedBy,
    confirmedAt,
    sourceDocumentRevision: draft.sourceDocumentRevision,
    stateChangedAt: confirmedAt,
  };
}

export async function confirmMedicationPlanDraft(
  scope: CareDataScope,
  input: ConfirmMedicationPlanDraftInput,
  options: { now?: Date } = {},
): Promise<MedicationPlanConfirmationResult> {
  assertValidConfirmationInput(input);
  const now = options.now ?? new Date();
  const result = await mutateCare<MedicationPlanConfirmationResult | { expiredDraft: MedicationPlanDraft }>(scope, undefined, async (tx, snapshot, ref) => {
    const confirmationRef = ref.collection("medicationDraftConfirmations").doc(input.idempotencyKey);
    const replay = await tx.get(confirmationRef);
    if (replay.exists) {
      const recorded = replay.data() as { draftId: string; medicationPlanIds: string[] };
      if (recorded.draftId !== input.draftId) throw new Error("확정 요청 식별자가 다른 초안에 사용됐어요.");
      const draftDoc = await tx.get(ref.collection("medicationPlanDrafts").doc(input.draftId));
      if (!draftDoc.exists) throw new Error("복약 초안을 찾을 수 없어요.");
      const medications = snapshot.medications.filter((medication) => recorded.medicationPlanIds.includes(medication.id));
      return {
        snapshot,
        result: { draft: draftDoc.data() as MedicationPlanDraft, medications, idempotentReplay: true },
        unchanged: true,
      };
    }

    const draftRef = ref.collection("medicationPlanDrafts").doc(input.draftId);
    const draftDoc = await tx.get(draftRef);
    if (!draftDoc.exists) throw new Error("복약 초안을 찾을 수 없어요.");
    const draft = draftDoc.data() as MedicationPlanDraft;
    if (draft.state === "active") {
      const medications = snapshot.medications.filter((medication) => draft.activeMedicationPlanIds?.includes(medication.id));
      return { snapshot, result: { draft, medications, idempotentReplay: true }, unchanged: true };
    }
    if (draft.state === "cancelled") throw new Error("취소된 복약 초안은 확정할 수 없어요.");
    if (Date.parse(draft.expiresAt) <= now.getTime()) {
      const timestamp = now.toISOString();
      const expiredDraft: MedicationPlanDraft = {
        ...draft,
        revision: draft.revision + 1,
        state: "expired",
        updatedAt: timestamp,
        transitionHistory: [...draft.transitionHistory, { state: "expired", at: timestamp, by: "system" }],
      };
      tx.set(draftRef, expiredDraft);
      return { snapshot, result: { expiredDraft } };
    }
    if (draft.revision !== input.revision) throw new Error("복약 초안이 변경됐어요. 최신 내용을 다시 확인해주세요.");
    const documentRef = ref.collection("clinicalDocuments").doc(draft.documentId);
    const documentDoc = await tx.get(documentRef);
    if (!documentDoc.exists) throw new Error("근거 처방전을 찾을 수 없어요.");
    const document = documentDoc.data() as ClinicalDocument;
    if (document.revision !== draft.sourceDocumentRevision) {
      throw new Error("근거 문서가 변경됐어요. 다시 분석하고 검토해주세요.");
    }

    const originalById = new Map(draft.candidates.map((candidate) => [candidate.id, candidate]));
    for (const candidate of input.candidates) {
      if (!originalById.has(candidate.id)) throw new Error("초안에 없는 복약 후보가 포함됐어요.");
    }
    const selected = input.candidates.filter((candidate) => candidate.included);
    if (selected.length === 0) throw new Error("활성화할 약을 하나 이상 선택해주세요.");
    if (selected.some((candidate) => originalById.get(candidate.id)?.reviewStatus !== "verified")) {
      throw new Error("OCR 근거와 식약처 정보 대조가 완료된 약만 활성화할 수 있어요.");
    }
    const timestamp = now.toISOString();
    const medications = selected.map((candidate) =>
      confirmedMedicationPlan(draft, originalById.get(candidate.id)!, candidate, input.confirmedBy, timestamp));
    const medicationIds = new Set(medications.map((medication) => medication.id));
    const nextCandidates = draft.candidates.map((candidate) => {
      const reviewed = input.candidates.find((item) => item.id === candidate.id);
      if (!reviewed) return candidate;
      return {
        ...candidate,
        ...reviewed,
        state: reviewed.included ? "active" as const : "cancelled" as const,
        updatedAt: timestamp,
      };
    });
    const activeDraft: MedicationPlanDraft = {
      ...draft,
      revision: draft.revision + 1,
      state: "active",
      candidates: nextCandidates,
      updatedAt: timestamp,
      confirmedBy: input.confirmedBy,
      confirmedAt: timestamp,
      activatedAt: timestamp,
      confirmationIdempotencyKey: input.idempotencyKey,
      activeMedicationPlanIds: [...medicationIds],
      transitionHistory: [
        ...draft.transitionHistory,
        { state: "confirmed", at: timestamp, by: input.confirmedBy },
        { state: "active", at: timestamp, by: input.confirmedBy },
      ],
    };
    const confirmedDocument = { ...document, status: "confirmed" as const, sourceLabel: "처방전 분석 · 보호자 검토 완료" };
    for (const medication of medications) tx.set(ref.collection("medicationPlans").doc(medication.id), medication);
    tx.set(draftRef, activeDraft);
    tx.set(documentRef, confirmedDocument);
    tx.create(confirmationRef, {
      draftId: draft.id,
      revision: input.revision,
      medicationPlanIds: [...medicationIds],
      confirmedBy: input.confirmedBy,
      confirmedAt: timestamp,
    });
    const retainedMedications = snapshot.medications.filter((medication) => !medicationIds.has(medication.id));
    return {
      snapshot: {
        ...snapshot,
        medications: [...retainedMedications, ...medications],
        documents: snapshot.documents.map((item) => item.id === document.id ? confirmedDocument : item),
      },
      result: { draft: activeDraft, medications, idempotentReplay: false },
    };
  }, { affectsMedications: true, requiresConsent: true });
  if ("expiredDraft" in result) {
    throw new Error("복약 초안이 만료됐어요. 문서를 다시 분석해주세요.");
  }
  return result;
}

export async function cancelMedicationPlanDraft(
  scope: CareDataScope,
  draftId: string,
  cancelledBy: string,
) {
  if (!cancelledBy.trim()) throw new Error("취소 사용자를 확인할 수 없습니다.");
  return mutateCare(scope, undefined, async (tx, snapshot, ref) => {
    const draftRef = ref.collection("medicationPlanDrafts").doc(draftId);
    const draftDoc = await tx.get(draftRef);
    if (!draftDoc.exists) throw new Error("복약 초안을 찾을 수 없어요.");
    const draft = draftDoc.data() as MedicationPlanDraft;
    if (draft.state === "active" || draft.state === "confirmed") {
      throw new Error("활성화된 복약 계획은 초안 취소로 되돌릴 수 없어요.");
    }
    if (draft.state === "cancelled") return { snapshot, result: draft, unchanged: true };
    const timestamp = new Date().toISOString();
    const cancelled: MedicationPlanDraft = {
      ...draft,
      revision: draft.revision + 1,
      state: "cancelled",
      updatedAt: timestamp,
      candidates: draft.candidates.map((candidate) => ({ ...candidate, state: "cancelled", updatedAt: timestamp })),
      transitionHistory: [...draft.transitionHistory, { state: "cancelled", at: timestamp, by: cancelledBy }],
    };
    tx.set(draftRef, cancelled);
    return { snapshot, result: cancelled };
  }, { requiresConsent: true });
}

function validCalendarDate(value: string | undefined) {
  if (!value) return undefined;
  try {
    return dateKeyInSeoul(value);
  } catch {
    return undefined;
  }
}

function validSupplyDays(value: number | undefined) {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 3_650
    ? Number(value)
    : undefined;
}

export function medicationPlansFromPrescription(
  document: Pick<ClinicalDocument, "id" | "documentType" | "uploadedAt" | "analysis">,
  today = dateKeyInSeoul(),
): MedicationPlan[] {
  if (document.documentType !== "처방전") return [];
  const sourceMedications = document.analysis?.medications ?? [];
  const prescriptionDate = validCalendarDate(document.analysis?.prescriptionDate);
  const totalSupplyDays = validSupplyDays(document.analysis?.totalSupplyDays);

  return sourceMedications
    .filter((medication) =>
      medication.reviewStatus === "verified" &&
      medication.productName.trim() &&
      medication.frequency.trim(),
    )
    .flatMap((medication, index) => {
      const startDate = validCalendarDate(medication.startDate) ?? prescriptionDate;
      if (!startDate) return [];
      const explicitEndDate = validCalendarDate(medication.endDate);
      const endDate = explicitEndDate ?? (totalSupplyDays
        ? addCalendarDays(startDate, totalSupplyDays - 1)
        : undefined);
      if (!endDate || endDate < startDate) return [];
      return {
        id: `rx-${document.id}-${index + 1}`,
        productName: medication.productName.trim(),
        ingredientName: medication.ingredientName.trim() || "성분 확인 필요",
        categoryPlain: "처방약",
        purposePlain: medication.purposePlain.trim() || "처방 목적을 의료진에게 확인해주세요.",
        descriptionPlain: "처방전에서 확인한 복용약이에요. 약 봉투와 원본 처방전을 함께 확인해주세요.",
        doseAmount: medication.doseAmount.trim() || "1회 복용량 확인 필요",
        frequency: medication.frequency.trim(),
        recurrence: normalizeMedicationRecurrence(medication.frequency),
        timing: medication.timing.trim() || "복용 시간 확인 필요",
        startDate,
        endDate,
        status: endDate < today ? "ended" as const : "active" as const,
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
    const confirmedConditions = (snapshot.recipient.confirmedConditions ?? []).filter(
      (condition) => condition.sourceDocumentId !== documentId,
    );
    const recipient = confirmedConditions.length === (snapshot.recipient.confirmedConditions ?? []).length
      ? snapshot.recipient
      : { ...snapshot.recipient, confirmedConditions };
    const nextSnapshot: CareSnapshot = {
      ...snapshot,
      recipient,
      medications: snapshot.medications.filter((item) => item.sourceDocumentId !== documentId),
      documents: snapshot.documents.filter((item) => item.id !== documentId),
    };
    tx.delete(document.ref);
    if (recipient !== snapshot.recipient) tx.set(ref, recipient);
    const storedDocument = document.data() as ClinicalDocument;
    if (storedDocument.medicationDraftId) {
      tx.delete(ref.collection("medicationPlanDrafts").doc(storedDocument.medicationDraftId));
    }
    for (const medication of snapshot.medications) {
      if (medication.sourceDocumentId === documentId) tx.delete(ref.collection("medicationPlans").doc(medication.id));
    }
    return { snapshot: nextSnapshot, result: nextSnapshot };
  }, { affectsMedications: true });
}
