import { randomUUID } from "node:crypto";
import { hasActiveAccountProcessing } from "./account-processing.ts";
import { ACCOUNT_DELETIONS_COLLECTION, accountRecipientId } from "./account-lifecycle.ts";
import { accountDeletionDeadline, assertRecentAccountAuthentication, getAccountDeletionPolicy } from "./account-deletion-policy.ts";
import { getAdminFirestore } from "./firebase-admin.ts";
import { getFirebaseAccountAdmin, type FirebaseAccountAdmin } from "./firebase-account-admin.ts";
import type { FirestoreLike, TransactionLike } from "./firestore-rest.ts";
import { deleteRecipientHealthData, deleteRecipientNotifications, verifyRecipientHealthDataDeleted } from "./health-data-deletion.ts";

export type AccountDeletion = {
  requestId: string;
  userId: string;
  recipientId: string;
  status: "pending" | "processing" | "failed" | "soft_deleted" | "restored" | "completed";
  stage: "queued" | "suspension" | "waiting" | "data" | "auth" | "verification" | "restored" | "completed";
  policyVersion: string;
  requestedAt: string;
  deleteAfter: string;
  hardDeletionStartedAt?: string;
  restoredAt?: string;
  updatedAt: string;
  nextAttemptAt: string;
  attempts: number;
  owner?: string;
  leaseUntil?: string;
  errorCode?: string | null;
  completedAt?: string;
  purgeAfter?: string;
};
type Dependencies = { firestore?: FirestoreLike; auth?: FirebaseAccountAdmin; now?: () => Date };

export function publicAccountDeletion(job: AccountDeletion, now = new Date()) {
  return { status: job.status, stage: job.stage, requestId: job.requestId, requestedAt: job.requestedAt, deleteAfter: job.deleteAfter,
    recoveryExpired: job.status !== "restored" && (Boolean(job.hardDeletionStartedAt) || job.status === "completed" || Date.parse(job.deleteAfter) <= now.getTime()),
    canRestore: job.status === "soft_deleted" && !job.hardDeletionStartedAt && Date.parse(job.deleteAfter) > now.getTime() };
}

export async function getAccountDeletion(userId: string, firestore?: FirestoreLike) {
  firestore ??= await getAdminFirestore();
  const doc = await firestore.collection(ACCOUNT_DELETIONS_COLLECTION).doc(accountRecipientId(userId)).get();
  return doc.exists ? doc.data() as AccountDeletion : null;
}

export async function requestAccountDeletion(input: {
  userId: string; tokenUserId: string; authTime: number; confirmation: string; policyVersion: string;
}, dependencies: Dependencies = {}) {
  const now = (dependencies.now ?? (() => new Date()))();
  assertRecentAccountAuthentication({ ...input, now });
  if (input.confirmation !== "회원 탈퇴") throw new Error("CONFIRMATION_REQUIRED");
  const policy = getAccountDeletionPolicy();
  if (input.policyVersion !== policy.version) throw new Error("DELETION_POLICY_UNAVAILABLE");
  const recipientId = accountRecipientId(input.userId);
  const firestore = dependencies.firestore ?? await getAdminFirestore();
  const ref = firestore.collection(ACCOUNT_DELETIONS_COLLECTION).doc(recipientId);
  return firestore.runTransaction(async (tx) => {
    const connectionRef = firestore.collection("careConnections").doc(recipientId);
    const [existing, connectionDocument] = await Promise.all([tx.get(ref), tx.get(connectionRef)]);
    if (existing.exists && (existing.data() as AccountDeletion).status !== "restored") return existing.data() as AccountDeletion;
    const connection = connectionDocument.data() as { pendingCodeHash?: string | null; loginCodeHash?: string | null } | undefined;
    const connectionCodeHash = connection?.pendingCodeHash ?? connection?.loginCodeHash;
    const connectionCodeRef = connectionCodeHash ? firestore.collection("connectionCodes").doc(connectionCodeHash) : null;
    const connectionCode = connectionCodeRef ? await tx.get(connectionCodeRef) : null;
    const job: AccountDeletion = {
      requestId: randomUUID(), userId: input.userId, recipientId, status: "pending", stage: "queued",
      policyVersion: policy.version, deleteAfter: accountDeletionDeadline(now),
      requestedAt: now.toISOString(), updatedAt: now.toISOString(), nextAttemptAt: now.toISOString(), attempts: 0,
    };
    // Every user write/AI publication/push claim reads this same document in its transaction.
    if (existing.exists) tx.set(ref, job);
    else tx.create(ref, job);
    if (connectionDocument.exists) {
      if (connectionCode?.exists && connectionCodeRef) tx.set(connectionCodeRef, { status: "revoked" }, { merge: true });
      tx.set(connectionRef, {
        status: "revoked", sessionVersion: randomUUID(), pendingCodeHash: null, loginCodeHash: null,
        codeExpiresAt: null, revokedAt: now.toISOString(), revokeReason: "account_deletion",
        expiresAt: now.toISOString(), updatedAt: now.toISOString(),
      }, { merge: true });
    }
    return job;
  });
}

export async function processAccountDeletion(userId: string, dependencies: Dependencies = {}) {
  const firestore = dependencies.firestore ?? await getAdminFirestore();
  const clock = dependencies.now ?? (() => new Date());
  const recipientId = accountRecipientId(userId);
  const ref = firestore.collection(ACCOUNT_DELETIONS_COLLECTION).doc(recipientId);
  const owner = randomUUID();
  const claimed = await firestore.runTransaction(async (tx) => {
    const job = (await tx.get(ref)).data() as AccountDeletion | undefined;
    if (!job || job.status === "completed" || job.status === "restored" || (job.status === "processing" && Date.parse(job.leaseUntil ?? "") > clock().getTime())) return null;
    if (job.userId !== userId || job.recipientId !== recipientId) throw new Error("INVALID_DELETION_SCOPE");
    if (!Number.isFinite(Date.parse(job.deleteAfter))) throw new Error("INVALID_DELETION_DEADLINE");
    const hardDelete = Boolean(job.hardDeletionStartedAt) || Date.parse(job.deleteAfter) <= clock().getTime();
    if (job.status === "soft_deleted" && !hardDelete) return null;
    const update = { status: "processing" as const, owner, attempts: job.attempts + 1,
      ...(hardDelete ? { hardDeletionStartedAt: job.hardDeletionStartedAt ?? clock().toISOString() } : {}),
      leaseUntil: new Date(clock().getTime() + 300_000).toISOString(),
      nextAttemptAt: new Date(clock().getTime() + 300_000).toISOString(), updatedAt: clock().toISOString(), errorCode: null };
    tx.set(ref, update, { merge: true });
    return { ...job, ...update };
  });
  if (!claimed) return getAccountDeletion(userId, firestore);
  const requestId = claimed.requestId;
  async function assertOwnership(tx: TransactionLike) {
    const job = (await tx.get(ref)).data() as AccountDeletion | undefined;
    if (!job || job.requestId !== requestId || job.owner !== owner || job.status !== "processing" ||
        job.userId !== userId || job.recipientId !== recipientId ||
        !(Date.parse(job.leaseUntil ?? "") > clock().getTime())) {
      throw new Error("DELETION_LEASE_LOST");
    }
  }
  async function checkpoint(update: Partial<AccountDeletion>) {
    await firestore.runTransaction(async (tx) => {
      await assertOwnership(tx);
      tx.set(ref, { ...update, updatedAt: clock().toISOString() }, { merge: true });
    });
  }
  try {
    const auth = dependencies.auth ?? await getFirebaseAccountAdmin();
    // Keep Google/Firebase sign-in available during the recovery window, but revoke old tokens.
    // The lifecycle document already denies every normal application session and data operation.
    if (claimed.hardDeletionStartedAt) await auth.disable(userId);
    else { await checkpoint({ stage: "suspension" }); await auth.revoke(userId); }
    if (await hasActiveAccountProcessing(firestore, recipientId, clock())) {
      await checkpoint({ status: "pending", nextAttemptAt: new Date(clock().getTime() + 5000).toISOString(), leaseUntil: clock().toISOString() });
      return getAccountDeletion(userId, firestore);
    }
    if (!claimed.hardDeletionStartedAt) {
      const unlinked = await deleteRecipientNotifications(firestore, recipientId, assertOwnership);
      await checkpoint(unlinked
        ? { status: "soft_deleted", stage: "waiting", nextAttemptAt: claimed.deleteAfter, leaseUntil: clock().toISOString() }
        : { status: "pending", nextAttemptAt: clock().toISOString(), leaseUntil: clock().toISOString() });
      return getAccountDeletion(userId, firestore);
    }
    await checkpoint({ stage: "data" });
    const data = await deleteRecipientHealthData({ firestore, recipientId, includeProfile: true, limit: 200 });
    if (!data.verified) {
      await checkpoint({ status: "pending", leaseUntil: clock().toISOString(), nextAttemptAt: clock().toISOString() });
      return getAccountDeletion(userId, firestore);
    }
    await checkpoint({ stage: "auth" });
    await auth.delete(userId);
    await checkpoint({ stage: "verification" });
    if (await auth.lookup(userId) || !await verifyRecipientHealthDataDeleted({ firestore, recipientId, includeProfile: true })) {
      throw new Error("DELETION_VERIFICATION_FAILED");
    }
    const completedAt = clock().toISOString();
    await checkpoint({ status: "completed", stage: "completed", completedAt, leaseUntil: completedAt,
      purgeAfter: completedAt });
  } catch {
    await checkpoint({ status: "failed", errorCode: "ACCOUNT_DELETION_INCOMPLETE", leaseUntil: clock().toISOString(),
      nextAttemptAt: new Date(clock().getTime() + Math.min(60_000 * 2 ** Math.min(claimed.attempts - 1, 6), 3_600_000)).toISOString() }).catch(() => undefined);
  }
  return getAccountDeletion(userId, firestore);
}

export async function retryAccountDeletions(dependencies: Dependencies = {}) {
  const firestore = dependencies.firestore ?? await getAdminFirestore();
  const now = (dependencies.now ?? (() => new Date()))();
  let failed = 0;
  let processed = 0;
  // Single-field queries avoid introducing a composite index dependency at rollout.
  for (const status of ["pending", "failed", "processing", "soft_deleted"] as const) {
    const jobs = await firestore.collection(ACCOUNT_DELETIONS_COLLECTION).where("status", "==", status).get();
    for (const doc of jobs.docs) {
      const job = doc.data() as AccountDeletion;
      if (job.nextAttemptAt > now.toISOString() || processed >= 25) continue;
      try {
        const result = await processAccountDeletion(job.userId, { ...dependencies, firestore });
        processed++;
        if (result?.status === "failed") failed++;
      } catch { failed++; }
    }
  }
  const expired = await firestore.collection(ACCOUNT_DELETIONS_COLLECTION).where("purgeAfter", "<=", now.toISOString()).limit(100).get();
  for (const doc of expired.docs) {
    const job = doc.data() as AccountDeletion;
    if (job.status !== "completed") continue;
    // Three months exceed every pre-withdrawal session lifetime. Recovery never issues a normal session.
    // No extra post-erasure retention period is added to the confirmed product policy.
    await firestore.runTransaction(async (tx) => {
      const current = (await tx.get(doc.ref)).data() as AccountDeletion | undefined;
      if (current?.status === "completed" && current.requestId === job.requestId) tx.delete(doc.ref);
    });
  }
  return { processed, failed };
}

export async function restoreAccount(input: { userId: string; requestId: string; authTime: number; confirmation: boolean }, dependencies: Dependencies = {}) {
  const clock = dependencies.now ?? (() => new Date());
  assertRecentAccountAuthentication({ userId: input.userId, tokenUserId: input.userId, authTime: input.authTime, now: clock() });
  if (input.confirmation !== true) throw new Error("CONFIRMATION_REQUIRED");
  const firestore = dependencies.firestore ?? await getAdminFirestore();
  const ref = firestore.collection(ACCOUNT_DELETIONS_COLLECTION).doc(accountRecipientId(input.userId));
  return firestore.runTransaction(async (tx) => {
    const job = (await tx.get(ref)).data() as AccountDeletion | undefined;
    if (!job || job.requestId !== input.requestId || job.userId !== input.userId) throw new Error("RECOVERY_NOT_FOUND");
    if (input.authTime <= Math.floor(Date.parse(job.requestedAt) / 1000)) throw new Error("REAUTHENTICATION_REQUIRED");
    if (job.status === "restored") return job; // A lost response can safely retry this exact recovery.
    if (!Number.isFinite(Date.parse(job.deleteAfter))) throw new Error("INVALID_DELETION_DEADLINE");
    if (job.hardDeletionStartedAt || Date.parse(job.deleteAfter) <= clock().getTime()) throw new Error("RECOVERY_EXPIRED");
    if (job.status !== "soft_deleted") throw new Error("ACCOUNT_SUSPENSION_INCOMPLETE");
    // Same transaction document as the erasure worker: recovery and permanent deletion cannot both win.
    const restored = { ...job, status: "restored" as const, stage: "restored" as const, restoredAt: clock().toISOString(), updatedAt: clock().toISOString() };
    tx.set(ref, restored);
    return restored;
  });
}
