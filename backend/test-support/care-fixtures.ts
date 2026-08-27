import { createInitialCareSnapshot, type RegisterDocumentInput } from "../src/care-repository.ts";
import type { FirestoreLike } from "../src/firestore-rest.ts";
import type { MedicationPlan } from "../src/types.ts";

export const syntheticMedication: MedicationPlan = {
  id: "test-medication", productName: "검증용 가상 약", ingredientName: "가상 성분", categoryPlain: "테스트",
  purposePlain: "테스트", descriptionPlain: "실제 환자 데이터 아님", doseAmount: "1정", frequency: "하루 1회",
  timing: "아침 식사 후", startDate: "2026-08-20", status: "active", isNew: false, sourceLabel: "synthetic", watchFor: [],
};
export function syntheticDocument(id: string): RegisterDocumentInput {
  return { fileName: `${id}.pdf`, contentHash: id, documentType: "진단서", size: 100, isSample: true, analysis: null };
}
export async function seedCareAccount(firestore: FirestoreLike, recipientId: string, options: { consent?: boolean; medications?: MedicationPlan[] } = {}) {
  const snapshot = createInitialCareSnapshot({ recipientId });
  snapshot.recipient.consentConfirmed = options.consent ?? false;
  snapshot.medications = options.medications ?? [];
  const recipient = firestore.collection("careRecipients").doc(recipientId);
  const batch = firestore.batch().set(recipient, snapshot.recipient).set(firestore.collection("careReadModels").doc(recipientId), { ...snapshot, revision: 0 });
  for (const medication of snapshot.medications) batch.set(recipient.collection("medicationPlans").doc(medication.id), medication);
  await batch.commit();
  return snapshot;
}

/** Deterministic fake external boundary; cannot accidentally fall through to the network. */
export function scriptedFetch(steps: Array<{ status: number; body?: string; headers?: Record<string, string> } | Error>) {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    const step = steps[calls++];
    if (!step) throw new Error("UNEXPECTED_EXTERNAL_CALL");
    if (step instanceof Error) throw step;
    return new Response(step.body ?? "", { status: step.status, headers: step.headers });
  };
  return { fetcher, calls: () => calls };
}
