import { getAdminFirestore } from "./firebase-admin.ts";
import type { FirestoreLike, TransactionLike } from "./firestore-rest.ts";

export class HealthDataConsentRequiredError extends Error {
  constructor() {
    super("건강정보 처리 동의가 필요합니다.");
    this.name = "HealthDataConsentRequiredError";
  }
}

export async function isHealthDataConsentConfirmed(
  firestore: FirestoreLike,
  recipientId: string,
  tx?: TransactionLike,
) {
  const ref = firestore.collection("careRecipients").doc(recipientId);
  const document = await (tx ? tx.get(ref) : ref.get());
  return document.exists && (document.data() as { consentConfirmed?: boolean }).consentConfirmed === true;
}

export async function assertHealthDataConsentConfirmed(
  firestore: FirestoreLike,
  recipientId: string,
  tx?: TransactionLike,
) {
  if (!await isHealthDataConsentConfirmed(firestore, recipientId, tx)) {
    throw new HealthDataConsentRequiredError();
  }
}

export async function isServiceHealthDataConsentConfirmed(recipientId: string) {
  return isHealthDataConsentConfirmed(await getAdminFirestore(), recipientId);
}
