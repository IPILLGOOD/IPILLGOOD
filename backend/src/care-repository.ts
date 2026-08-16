import { randomUUID } from "node:crypto";

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
  AgentRunRecord,
  CareAgentOutput,
  PatientQuestionResponse,
  PatientQuestionSet,
  SymptomEvent,
} from "./types.ts";

import { getAdminFirestore } from "./firebase-admin.ts";
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

export const DEMO_RECIPIENT_ID = "demo-kim-yeonghui";

export type CareDataScope = {
  recipientId: string;
  initialDisplayName?: string;
  useDemoData?: boolean;
};

const READ_MODEL_COLLECTION = "careReadModels";

type DemoSeed = Omit<CareSnapshot, "dataSource">;
type StoredCareReadModel = Omit<CareSnapshot, "dataSource"> & {
  updatedAt: string;
};

const seed = demoSeed as DemoSeed;

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
      ageBand: "65–69세",
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

function fallbackSnapshot(scope: CareDataScope) {
  return scope.useDemoData
    ? { ...seed, todayCheckIn: null, dataSource: "local-fallback" as const }
    : { ...createInitialCareSnapshot(scope), dataSource: "local-fallback" as const };
}

function fromStoredReadModel(model: StoredCareReadModel, scope: CareDataScope): CareSnapshot {
  const fallback = scope.useDemoData ? seed : createInitialCareSnapshot(scope);
  return {
    recipient: model.recipient ?? fallback.recipient,
    medications: model.medications ?? fallback.medications,
    doseEvents: model.doseEvents ?? fallback.doseEvents,
    symptomEvents: model.symptomEvents ?? fallback.symptomEvents,
    documents: model.documents ?? fallback.documents,
    clinicianQuestions: model.clinicianQuestions ?? fallback.clinicianQuestions,
    todayCheckIn: currentDailyCheckIn(model.todayCheckIn),
    dataSource: "firestore",
  };
}

function seedSnapshot(): CareSnapshot {
  return {
    ...seed,
    todayCheckIn: null,
    dataSource: "firestore",
  };
}

function readModelRef(
  firestore: Awaited<ReturnType<typeof getAdminFirestore>>,
  recipientId: string,
) {
  return firestore.collection(READ_MODEL_COLLECTION).doc(recipientId);
}

async function seedDemoData(firestore: Awaited<ReturnType<typeof getAdminFirestore>>) {
  const recipientRef = firestore.collection("careRecipients").doc(DEMO_RECIPIENT_ID);
  const batch = firestore.batch();
  batch.set(recipientRef, seed.recipient);

  for (const medication of seed.medications) {
    batch.set(recipientRef.collection("medicationPlans").doc(medication.id), medication);
  }
  for (const event of seed.doseEvents) {
    batch.set(recipientRef.collection("doseEvents").doc(event.id), event);
  }
  for (const symptom of seed.symptomEvents) {
    batch.set(recipientRef.collection("symptomEvents").doc(symptom.id), symptom);
  }
  for (const document of seed.documents) {
    batch.set(recipientRef.collection("clinicalDocuments").doc(document.id), document);
  }
  for (const question of seed.clinicianQuestions) {
    batch.set(recipientRef.collection("clinicianQuestions").doc(question.id), question);
  }

  await batch.commit();
  return toStoredReadModel(seedSnapshot());
}

async function buildLegacyReadModel(
  firestore: Awaited<ReturnType<typeof getAdminFirestore>>,
) {
  const recipientRef = firestore.collection("careRecipients").doc(DEMO_RECIPIENT_ID);
  const recipientDoc = await recipientRef.get();
  if (!recipientDoc.exists) return seedDemoData(firestore);

  const dateKey = dateKeyInSeoul(new Date());
  const [medications, doseEvents, symptomEvents, documents, questions, todayCheckIn] =
    await Promise.all([
      recipientRef.collection("medicationPlans").get(),
      recipientRef.collection("doseEvents").get(),
      recipientRef.collection("symptomEvents").get(),
      recipientRef.collection("clinicalDocuments").get(),
      recipientRef.collection("clinicianQuestions").get(),
      recipientRef.collection("dailyCheckIns").doc(dateKey).get(),
    ]);

  return toStoredReadModel({
    recipient: recipientDoc.data() as CareRecipient,
    medications: medications.docs.map((doc) => {
      const stored = doc.data() as MedicationPlan;
      const demo = seed.medications.find((medication) => medication.id === stored.id);
      return { ...demo, ...stored } as MedicationPlan;
    }),
    doseEvents: doseEvents.docs.map((doc) => doc.data() as DoseEvent),
    symptomEvents: symptomEvents.docs.map((doc) => doc.data() as SymptomEvent),
    documents: documents.docs.map((doc) => doc.data() as ClinicalDocument),
    clinicianQuestions: questions.docs.map((doc) => doc.data() as ClinicianQuestion),
    todayCheckIn: todayCheckIn.exists ? (todayCheckIn.data() as DailyCheckIn) : null,
    dataSource: "firestore",
  });
}

async function getOrCreateReadModel(
  firestore: Awaited<ReturnType<typeof getAdminFirestore>>,
  scope: CareDataScope,
) {
  assertValidScope(scope);
  const ref = readModelRef(firestore, scope.recipientId);
  const existing = await ref.get();
  if (existing.exists) return existing.data() as StoredCareReadModel;

  if (scope.useDemoData && scope.recipientId === DEMO_RECIPIENT_ID) {
    const model = await buildLegacyReadModel(firestore);
    await ref.set(model);
    return model;
  }

  const snapshot = createInitialCareSnapshot(scope);
  const model = toStoredReadModel(snapshot);
  const batch = firestore.batch();
  batch.set(firestore.collection("careRecipients").doc(scope.recipientId), snapshot.recipient);
  batch.set(ref, model);
  await batch.commit();
  return model;
}

export async function getCareSnapshot(scope: CareDataScope): Promise<CareSnapshot> {
  assertValidScope(scope);
  try {
    const firestore = await getAdminFirestore();
    return fromStoredReadModel(await getOrCreateReadModel(firestore, scope), scope);
  } catch (error) {
    if (globalThis.navigator?.userAgent !== "Cloudflare-Workers") {
      console.error("Firestore unavailable; using demo fallback", error);
    }
    return fallbackSnapshot(scope);
  }
}

export async function updateRecipientProfile(
  scope: CareDataScope,
  recipient: CareRecipient,
  currentSnapshot?: CareSnapshot,
) {
  assertValidScope(scope);
  if (recipient.id !== scope.recipientId) throw new Error("프로필 소유자가 일치하지 않습니다.");
  const firestore = await getAdminFirestore();
  const snapshot = currentSnapshot ?? fromStoredReadModel(await getOrCreateReadModel(firestore, scope), scope);
  const recipientRef = firestore.collection("careRecipients").doc(scope.recipientId);
  const batch = firestore.batch();
  batch.set(recipientRef, recipient);
  batch.set(readModelRef(firestore, scope.recipientId), toStoredReadModel({ ...snapshot, recipient }));
  await batch.commit();
}

export async function getTodayDailyCheckIn(scope: CareDataScope): Promise<DailyCheckIn | null> {
  try {
    const firestore = await getAdminFirestore();
    const model = await getOrCreateReadModel(firestore, scope);
    return currentDailyCheckIn(model.todayCheckIn);
  } catch (error) {
    if (globalThis.navigator?.userAgent !== "Cloudflare-Workers") {
      console.error("Daily check-in unavailable", error);
    }
    return null;
  }
}

export async function getPatientQuestionSet(
  scope: CareDataScope,
  questionSetId: string,
): Promise<PatientQuestionSet | null> {
  assertValidScope(scope);
  const firestore = await getAdminFirestore();
  const document = await firestore
    .collection("careRecipients")
    .doc(scope.recipientId)
    .collection("questionSets")
    .doc(questionSetId)
    .get();
  return document.exists ? (document.data() as PatientQuestionSet) : null;
}

export async function saveQuestionSetGeneration(scope: CareDataScope, input: {
  questionSet: PatientQuestionSet;
  analysis: CareAgentOutput;
  run: AgentRunRecord;
}) {
  assertValidScope(scope);
  if (input.questionSet.subject_ref !== scope.recipientId) {
    throw new Error("질문 세트 소유자가 일치하지 않습니다.");
  }
  const firestore = await getAdminFirestore();
  const recipientRef = firestore.collection("careRecipients").doc(scope.recipientId);
  const batch = firestore.batch();
  batch.set(
    recipientRef.collection("questionSets").doc(input.questionSet.question_set_id),
    input.questionSet,
  );
  batch.set(
    recipientRef.collection("careAnalyses").doc(input.analysis.analysis_id),
    {
      ...input.analysis,
      promptVersion: input.questionSet.prompt_version,
      inputRevision: input.questionSet.input_revision,
    },
  );
  batch.set(recipientRef.collection("agentRuns").doc(input.run.runId), input.run);
  await batch.commit();
}

export async function saveDailyCheckIn(
  scope: CareDataScope,
  input: DailyCheckInInput & { questionResponse: PatientQuestionResponse },
  currentSnapshot?: CareSnapshot,
) {
  assertValidScope(scope);
  if (input.questionResponse.subject_ref !== scope.recipientId) {
    throw new Error("체크인 소유자가 일치하지 않습니다.");
  }
  const firestore = await getAdminFirestore();
  const snapshot = currentSnapshot ?? fromStoredReadModel(await getOrCreateReadModel(firestore, scope), scope);
  const recipientRef = firestore.collection("careRecipients").doc(scope.recipientId);
  const update = applyDailyCheckInToSnapshot(snapshot, input);
  const batch = firestore.batch();

  for (const event of update.doseEvents) {
    batch.set(recipientRef.collection("doseEvents").doc(event.id), event);
  }
  for (const event of update.replacedSymptomEvents) {
    batch.delete(recipientRef.collection("symptomEvents").doc(event.id));
  }
  for (const event of update.symptomEvents) {
    batch.set(recipientRef.collection("symptomEvents").doc(event.id), event);
  }
  const checkIn: DailyCheckIn = {
    ...update.checkIn,
    questionSetId: input.questionResponse.question_set_id,
    questionResponseId: input.questionResponse.response_id,
  };
  const nextSnapshot: CareSnapshot = {
    ...update.nextSnapshot,
    todayCheckIn: checkIn,
  };
  batch.set(recipientRef.collection("dailyCheckIns").doc(checkIn.id), checkIn);
  batch.set(
    recipientRef
      .collection("questionResponses")
      .doc(input.questionResponse.response_id),
    input.questionResponse,
  );
  batch.set(
    recipientRef
      .collection("questionSets")
      .doc(input.questionResponse.question_set_id),
    {
      response_status: "answered",
      answered_at: input.questionResponse.answered_at,
    } satisfies Pick<PatientQuestionSet, "response_status" | "answered_at">,
    { merge: true },
  );
  batch.set(readModelRef(firestore, scope.recipientId), toStoredReadModel(nextSnapshot));
  await batch.commit();
}

export async function registerDocument(scope: CareDataScope, input: {
  fileName: string;
  documentType: ClinicalDocumentType;
  size: number;
  isSample: boolean;
  analysis: ClinicalDocument["analysis"];
}) {
  assertValidScope(scope);
  const firestore = await getAdminFirestore();
  const snapshot = fromStoredReadModel(await getOrCreateReadModel(firestore, scope), scope);
  const recipientRef = firestore.collection("careRecipients").doc(scope.recipientId);
  const documentRef = recipientRef.collection("clinicalDocuments").doc(randomUUID());
  const document: ClinicalDocument & { size: number } = {
    id: documentRef.id,
    fileName: input.fileName,
    documentType: input.documentType,
    uploadedAt: new Date().toISOString(),
    status: "confirmed",
    redacted: input.isSample,
    sourceLabel:
      input.analysis?.source === "api"
        ? "API 분석 완료 · 보호자 확인 필요"
        : input.analysis?.source === "openai"
          ? "OpenAI 분석 완료 · 보호자 확인 필요"
          : "비식별 데모 분석 · 원본과 확인 필요",
    size: input.size,
    analysis: input.analysis,
  };
  const nextSnapshot: CareSnapshot = {
    ...snapshot,
    documents: [document, ...snapshot.documents]
      .sort(byDateDescending<ClinicalDocument>("uploadedAt"))
      .slice(0, MAX_DOCUMENTS),
  };
  const batch = firestore.batch();
  batch.set(documentRef, document);
  batch.set(readModelRef(firestore, scope.recipientId), toStoredReadModel(nextSnapshot));
  await batch.commit();
  return document;
}

export async function deleteDocument(
  scope: CareDataScope,
  documentId: string,
  currentSnapshot?: CareSnapshot,
) {
  assertValidScope(scope);
  const firestore = await getAdminFirestore();
  const snapshot =
    currentSnapshot ??
    fromStoredReadModel(await getOrCreateReadModel(firestore, scope), scope);
  const document = snapshot.documents.find((item) => item.id === documentId);
  if (!document) throw new Error("삭제할 문서를 찾지 못했어요.");

  const recipientRef = firestore.collection("careRecipients").doc(scope.recipientId);
  const nextSnapshot: CareSnapshot = {
    ...snapshot,
    documents: snapshot.documents.filter((item) => item.id !== documentId),
  };
  const batch = firestore.batch();
  batch.delete(recipientRef.collection("clinicalDocuments").doc(document.id));
  batch.set(
    readModelRef(firestore, scope.recipientId),
    toStoredReadModel(nextSnapshot),
  );
  await batch.commit();
}
