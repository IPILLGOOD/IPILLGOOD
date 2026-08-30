import { getAdminFirestore } from "./firebase-admin.ts";
import type { FirestoreLike, TransactionLike } from "./firestore-rest.ts";

export class HealthDataConsentRequiredError extends Error {
  constructor() {
    super("건강정보 처리 동의가 필요합니다.");
    this.name = "HealthDataConsentRequiredError";
  }
}

export class CareProfileRequiredError extends Error {
  constructor() {
    super("돌봄 대상자 정보와 건강정보 처리 동의를 먼저 확인해야 합니다.");
    this.name = "CareProfileRequiredError";
  }
}

type CareProfileRecord = {
  displayName?: unknown;
  ageBand?: unknown;
  consentConfirmed?: unknown;
};

/**
 * Legacy profiles do not have profileCompletedAt, so completion is derived from
 * user-entered required fields and consent. New saves also persist the explicit
 * completion timestamp for future policy/version migrations.
 */
export function isCareProfileRecordComplete(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const profile = value as CareProfileRecord;
  const displayName = typeof profile.displayName === "string" ? profile.displayName.trim() : "";
  const ageBand = typeof profile.ageBand === "string" ? profile.ageBand.trim() : "";
  const age = /^\d+$/.test(ageBand) ? Number(ageBand) : Number.NaN;
  return profile.consentConfirmed === true &&
    displayName.length >= 2 &&
    displayName !== "돌봄 대상자" &&
    Number.isInteger(age) && age >= 1 && age <= 120;
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

export async function isCareProfileComplete(
  firestore: FirestoreLike,
  recipientId: string,
  tx?: TransactionLike,
) {
  const ref = firestore.collection("careRecipients").doc(recipientId);
  const document = await (tx ? tx.get(ref) : ref.get());
  return document.exists && isCareProfileRecordComplete(document.data());
}

export async function assertCareProfileComplete(
  firestore: FirestoreLike,
  recipientId: string,
  tx?: TransactionLike,
) {
  if (!await isCareProfileComplete(firestore, recipientId, tx)) {
    throw new CareProfileRequiredError();
  }
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

export async function isServiceCareProfileComplete(recipientId: string) {
  return isCareProfileComplete(await getAdminFirestore(), recipientId);
}
