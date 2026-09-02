import { getAdminFirestore } from "./firebase-admin.ts";
import type { FirestoreLike, TransactionLike } from "./firestore-rest.ts";

export const ACCOUNT_DELETIONS_COLLECTION = "accountDeletions";
export const HEALTH_DATA_RESETS_COLLECTION = "healthDataResets";
export const MAX_SESSION_SECONDS = 7 * 24 * 60 * 60;

export class AccountDeletingError extends Error {
  constructor() { super("회원 탈퇴가 접수된 계정입니다."); this.name = "AccountDeletingError"; }
}

export function accountRecipientId(userId: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId)) throw new Error("Invalid account ID.");
  return `google-${userId}`;
}

export async function isCareAccountActive(firestore: FirestoreLike, recipientId: string, tx?: TransactionLike) {
  if (!recipientId.startsWith("google-")) return true;
  const accountDeletionRef = firestore.collection(ACCOUNT_DELETIONS_COLLECTION).doc(recipientId);
  const healthResetRef = firestore.collection(HEALTH_DATA_RESETS_COLLECTION).doc(recipientId);
  const [accountDeletion, healthReset] = await Promise.all([
    tx ? tx.get(accountDeletionRef) : accountDeletionRef.get(),
    tx ? tx.get(healthResetRef) : healthResetRef.get(),
  ]);
  const accountActive = !accountDeletion.exists || (accountDeletion.data() as { status?: string }).status === "restored";
  const resetStatus = (healthReset.data() as { status?: string } | undefined)?.status;
  return accountActive && (!healthReset.exists || resetStatus === "completed");
}

export async function assertCareAccountActive(firestore: FirestoreLike, recipientId: string, tx?: TransactionLike) {
  if (!await isCareAccountActive(firestore, recipientId, tx)) throw new AccountDeletingError();
}

export async function isServiceAccountActive(userId: string) {
  return isCareAccountActive(await getAdminFirestore(), accountRecipientId(userId));
}

/** A restored account requires a new session generation; old device cookies stay revoked. */
export async function getAccountSessionState(userId: string, firestore?: FirestoreLike) {
  firestore ??= await getAdminFirestore();
  const recipientId = accountRecipientId(userId);
  const [doc, resetDocument] = await Promise.all([
    firestore.collection(ACCOUNT_DELETIONS_COLLECTION).doc(recipientId).get(),
    firestore.collection(HEALTH_DATA_RESETS_COLLECTION).doc(recipientId).get(),
  ]);
  const job = doc.data() as { status?: string; requestId?: string; requestedAt?: string } | undefined;
  const reset = resetDocument.data() as {
    status?: string;
    requestId?: string;
    deleteFirebaseAccount?: boolean;
    completedAt?: string;
  } | undefined;
  const authDeleted = reset?.status === "completed" && reset.deleteFirebaseAccount === true;
  return {
    active: !doc.exists || job?.status === "restored",
    version: authDeleted ? reset.requestId : job?.status === "restored" ? job.requestId : undefined,
    authValidAfter: Math.max(
      job?.requestedAt ? Math.floor(Date.parse(job.requestedAt) / 1000) + 1 : 0,
      authDeleted && reset.completedAt ? Math.floor(Date.parse(reset.completedAt) / 1000) + 1 : 0,
    ),
  };
}
