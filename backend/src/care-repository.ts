import { randomUUID } from "node:crypto";

import demoSeed from "./data/demo-seed.json";
import type {
  CareRecipient,
  CareSnapshot,
  ClinicalDocument,
  ClinicalDocumentType,
  ClinicianQuestion,
  DoseEvent,
  MedicationPlan,
  SymptomEvent,
} from "./types";

import { firestore } from "./firebase-admin";

export const DEMO_RECIPIENT_ID = "demo-kim-yeonghui";

type DemoSeed = Omit<CareSnapshot, "dataSource">;

const seed = demoSeed as DemoSeed;

function byDateDescending<T>(field: keyof T) {
  return (a: T, b: T) =>
    String(b[field]).localeCompare(String(a[field]));
}

async function ensureDemoData() {
  const recipientRef = firestore.collection("careRecipients").doc(DEMO_RECIPIENT_ID);
  const existing = await recipientRef.get();
  if (existing.exists) return;

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
}

export async function getCareSnapshot(): Promise<CareSnapshot> {
  try {
    await ensureDemoData();
    const recipientRef = firestore.collection("careRecipients").doc(DEMO_RECIPIENT_ID);
    const [recipientDoc, medications, doseEvents, symptomEvents, documents, questions] =
      await Promise.all([
        recipientRef.get(),
        recipientRef.collection("medicationPlans").get(),
        recipientRef.collection("doseEvents").get(),
        recipientRef.collection("symptomEvents").get(),
        recipientRef.collection("clinicalDocuments").get(),
        recipientRef.collection("clinicianQuestions").get(),
      ]);

    return {
      recipient: recipientDoc.data() as CareRecipient,
      medications: medications.docs.map((doc) => {
        const stored = doc.data() as MedicationPlan;
        const demo = seed.medications.find((medication) => medication.id === stored.id);
        return { ...demo, ...stored } as MedicationPlan;
      }),
      doseEvents: doseEvents.docs
        .map((doc) => doc.data() as DoseEvent)
        .sort(byDateDescending<DoseEvent>("scheduledAt")),
      symptomEvents: symptomEvents.docs
        .map((doc) => doc.data() as SymptomEvent)
        .sort(byDateDescending<SymptomEvent>("occurredAt")),
      documents: documents.docs
        .map((doc) => doc.data() as ClinicalDocument)
        .sort(byDateDescending<ClinicalDocument>("uploadedAt")),
      clinicianQuestions: questions.docs.map(
        (doc) => doc.data() as ClinicianQuestion,
      ),
      dataSource: "firestore",
    };
  } catch (error) {
    console.error("Firestore unavailable; using demo fallback", error);
    return { ...seed, dataSource: "local-fallback" };
  }
}

export async function updateRecipientProfile(recipient: CareRecipient) {
  await firestore
    .collection("careRecipients")
    .doc(DEMO_RECIPIENT_ID)
    .set(recipient, { merge: true });
}

export async function saveDailyCheckIn(input: {
  doseResponses: Array<Pick<DoseEvent, "medicationPlanId" | "response" | "scheduledAt">>;
  symptoms: string[];
  severity: number;
  note: string;
  answeredBy: "caregiver" | "recipient";
}) {
  const recipientRef = firestore.collection("careRecipients").doc(DEMO_RECIPIENT_ID);
  const now = new Date().toISOString();
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const batch = firestore.batch();

  for (const response of input.doseResponses) {
    const eventRef = recipientRef.collection("doseEvents").doc(randomUUID());
    batch.set(eventRef, {
      id: eventRef.id,
      medicationPlanId: response.medicationPlanId,
      scheduledAt: response.scheduledAt,
      response: response.response,
      answeredBy: input.answeredBy,
      answeredAt: now,
    } satisfies DoseEvent);
  }

  for (const symptom of input.symptoms) {
    const symptomRef = recipientRef.collection("symptomEvents").doc(randomUUID());
    batch.set(symptomRef, {
      id: symptomRef.id,
      symptomType: symptom,
      occurredAt: now,
      severity: input.severity,
      dailyLifeImpact: input.note || "일상 영향은 기록하지 않았어요.",
      reporterType:
        input.answeredBy === "caregiver"
          ? "caregiver_observed"
          : "recipient_reported",
      note: input.note,
    } satisfies SymptomEvent);
  }

  batch.set(recipientRef.collection("dailyCheckIns").doc(dateKey), {
    id: dateKey,
    completedAt: now,
    completedBy: input.answeredBy,
    medicationResponses: input.doseResponses,
    symptoms: input.symptoms,
    note: input.note,
  });
  await batch.commit();
}

export async function registerDocument(input: {
  fileName: string;
  documentType: ClinicalDocumentType;
  size: number;
  isSample: boolean;
  analysis: ClinicalDocument["analysis"];
}) {
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
        : "비식별 데모 분석 · 원본과 확인 필요",
    size: input.size,
    analysis: input.analysis,
  };
  await documentRef.set(document);
  return document;
}
