import { getAdminFirestore } from "./firebase-admin.ts";
import type { FirestoreLike, TransactionLike } from "./firestore-rest.ts";

export const ACCOUNT_DELETIONS_COLLECTION = "accountDeletions";
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
  const ref = firestore.collection(ACCOUNT_DELETIONS_COLLECTION).doc(recipientId);
  const doc = await (tx ? tx.get(ref) : ref.get());
  return !doc.exists || (doc.data() as { status?: string }).status === "restored";
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
  const doc = await firestore.collection(ACCOUNT_DELETIONS_COLLECTION).doc(accountRecipientId(userId)).get();
  const job = doc.data() as { status?: string; requestId?: string; requestedAt?: string } | undefined;
  return {
    active: !doc.exists || job?.status === "restored",
    version: job?.status === "restored" ? job.requestId : undefined,
    authValidAfter: job?.requestedAt ? Math.floor(Date.parse(job.requestedAt) / 1000) + 1 : 0,
  };
}
