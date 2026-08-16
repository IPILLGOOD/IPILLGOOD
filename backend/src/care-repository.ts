import { createHash, randomUUID } from "node:crypto";

import demoSeed from "./data/demo-seed.json";
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

export const DEMO_RECIPIENT_ID = "demo-kim-yeonghui";

type DemoSeed = Omit<CareSnapshot, "dataSource">;

const seed = demoSeed as DemoSeed;

function dateKeyInSeoul(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function byDateDescending<T>(field: keyof T) {
  return (a: T, b: T) =>
    String(b[field]).localeCompare(String(a[field]));
}

async function ensureDemoData(firestore: Awaited<ReturnType<typeof getAdminFirestore>>) {
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
    const firestore = await getAdminFirestore();
    await ensureDemoData(firestore);
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
    if (globalThis.navigator?.userAgent !== "Cloudflare-Workers") {
      console.error("Firestore unavailable; using demo fallback", error);
    }
    return { ...seed, dataSource: "local-fallback" };
  }
}

export async function updateRecipientProfile(recipient: CareRecipient) {
  const firestore = await getAdminFirestore();
  await firestore
    .collection("careRecipients")
    .doc(DEMO_RECIPIENT_ID)
    .set(recipient, { merge: true });
}

export async function getTodayDailyCheckIn(): Promise<DailyCheckIn | null> {
  try {
    const firestore = await getAdminFirestore();
    await ensureDemoData(firestore);
    const dateKey = dateKeyInSeoul(new Date());
    const document = await firestore
      .collection("careRecipients")
      .doc(DEMO_RECIPIENT_ID)
      .collection("dailyCheckIns")
      .doc(dateKey)
      .get();
    return document.exists ? (document.data() as DailyCheckIn) : null;
  } catch (error) {
    if (globalThis.navigator?.userAgent !== "Cloudflare-Workers") {
      console.error("Daily check-in unavailable", error);
    }
    return null;
  }
}

export async function saveDailyCheckIn(input: {
  doseResponses: Array<Pick<DoseEvent, "medicationPlanId" | "response" | "scheduledAt">>;
  symptoms: string[];
  severity: number;
  note: string;
  answeredBy: "caregiver" | "recipient";
}) {
  const firestore = await getAdminFirestore();
  const recipientRef = firestore.collection("careRecipients").doc(DEMO_RECIPIENT_ID);
  const now = new Date().toISOString();
  const dateKey = dateKeyInSeoul(new Date());
  const currentSymptomEvents = await recipientRef.collection("symptomEvents").get();
  const batch = firestore.batch();

  for (const response of input.doseResponses) {
    const medicationKey = response.medicationPlanId.replace(/[^a-zA-Z0-9_-]/g, "-");
    const timeKey = response.scheduledAt.slice(11, 16).replace(":", "");
    const eventRef = recipientRef
      .collection("doseEvents")
      .doc(`${dateKey}-${medicationKey}-${timeKey}`);
    batch.set(eventRef, {
      id: eventRef.id,
      medicationPlanId: response.medicationPlanId,
      scheduledAt: response.scheduledAt,
      response: response.response,
      answeredBy: input.answeredBy,
      answeredAt: now,
    } satisfies DoseEvent, { merge: true });
  }

  for (const document of currentSymptomEvents.docs) {
    const event = document.data() as SymptomEvent;
    if (dateKeyInSeoul(new Date(event.occurredAt)) === dateKey) {
      batch.delete(document.ref);
    }
  }

  for (const symptom of input.symptoms) {
    const symptomKey = createHash("sha256").update(symptom).digest("hex").slice(0, 12);
    const symptomRef = recipientRef
      .collection("symptomEvents")
      .doc(`${dateKey}-${symptomKey}`);
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
    severity: input.severity,
    note: input.note,
  } satisfies DailyCheckIn);
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
  await documentRef.set(document);
  return document;
}
