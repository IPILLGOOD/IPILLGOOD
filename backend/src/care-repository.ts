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
  SymptomEvent,
} from "./types";

import { getAdminFirestore } from "./firebase-admin";
import {
  applyDailyCheckInToSnapshot,
  byDateDescending,
  currentDailyCheckIn,
  dateKeyInSeoul,
  MAX_DOCUMENTS,
  MAX_DOSE_EVENTS,
  MAX_SYMPTOM_EVENTS,
  type DailyCheckInInput,
} from "./care-read-model";

export const DEMO_RECIPIENT_ID = "demo-kim-yeonghui";

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

function fromStoredReadModel(model: StoredCareReadModel): CareSnapshot {
  return {
    recipient: model.recipient ?? seed.recipient,
    medications: model.medications ?? seed.medications,
    doseEvents: model.doseEvents ?? seed.doseEvents,
    symptomEvents: model.symptomEvents ?? seed.symptomEvents,
    documents: model.documents ?? seed.documents,
    clinicianQuestions: model.clinicianQuestions ?? seed.clinicianQuestions,
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

function readModelRef(firestore: Awaited<ReturnType<typeof getAdminFirestore>>) {
  return firestore.collection(READ_MODEL_COLLECTION).doc(DEMO_RECIPIENT_ID);
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
) {
  const ref = readModelRef(firestore);
  const existing = await ref.get();
  if (existing.exists) return existing.data() as StoredCareReadModel;

  const model = await buildLegacyReadModel(firestore);
  await ref.set(model);
  return model;
}

export async function getCareSnapshot(): Promise<CareSnapshot> {
  try {
    const firestore = await getAdminFirestore();
    return fromStoredReadModel(await getOrCreateReadModel(firestore));
  } catch (error) {
    if (globalThis.navigator?.userAgent !== "Cloudflare-Workers") {
      console.error("Firestore unavailable; using demo fallback", error);
    }
    return { ...seed, todayCheckIn: null, dataSource: "local-fallback" };
  }
}

export async function updateRecipientProfile(
  recipient: CareRecipient,
  currentSnapshot?: CareSnapshot,
) {
  const firestore = await getAdminFirestore();
  const snapshot = currentSnapshot ?? fromStoredReadModel(await getOrCreateReadModel(firestore));
  const recipientRef = firestore.collection("careRecipients").doc(DEMO_RECIPIENT_ID);
  const batch = firestore.batch();
  batch.set(recipientRef, recipient);
  batch.set(readModelRef(firestore), toStoredReadModel({ ...snapshot, recipient }));
  await batch.commit();
}

export async function getTodayDailyCheckIn(): Promise<DailyCheckIn | null> {
  try {
    const firestore = await getAdminFirestore();
    const model = await getOrCreateReadModel(firestore);
    return currentDailyCheckIn(model.todayCheckIn);
  } catch (error) {
    if (globalThis.navigator?.userAgent !== "Cloudflare-Workers") {
      console.error("Daily check-in unavailable", error);
    }
    return null;
  }
}

export async function saveDailyCheckIn(
  input: DailyCheckInInput,
  currentSnapshot?: CareSnapshot,
) {
  const firestore = await getAdminFirestore();
  const snapshot = currentSnapshot ?? fromStoredReadModel(await getOrCreateReadModel(firestore));
  const recipientRef = firestore.collection("careRecipients").doc(DEMO_RECIPIENT_ID);
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
  batch.set(recipientRef.collection("dailyCheckIns").doc(update.checkIn.id), update.checkIn);
  batch.set(readModelRef(firestore), toStoredReadModel(update.nextSnapshot));
  await batch.commit();
}

export async function registerDocument(input: {
  fileName: string;
  documentType: ClinicalDocumentType;
  size: number;
  isSample: boolean;
  analysis: ClinicalDocument["analysis"];
}) {
  const firestore = await getAdminFirestore();
  const snapshot = fromStoredReadModel(await getOrCreateReadModel(firestore));
  const recipientRef = firestore.collection("careRecipients").doc(DEMO_RECIPIENT_ID);
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
  batch.set(readModelRef(firestore), toStoredReadModel(nextSnapshot));
  await batch.commit();
  return document;
}
