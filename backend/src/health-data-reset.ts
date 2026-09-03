import { randomUUID } from "node:crypto";

import {
  accountRecipientId,
  assertCareAccountActive,
  HEALTH_DATA_RESETS_COLLECTION,
} from "./account-lifecycle.ts";
import { hasActiveAccountProcessing } from "./account-processing.ts";
import { assertRecentAccountAuthentication } from "./account-deletion-policy.ts";
import { createInitialCareSnapshot } from "./care-repository.ts";
import { getAdminFirestore } from "./firebase-admin.ts";
import { getFirebaseAccountAdmin, type FirebaseAccountAdmin } from "./firebase-account-admin.ts";
import type { FirestoreLike } from "./firestore-rest.ts";
import { deleteRecipientHealthData, verifyRecipientHealthDataDeleted } from "./health-data-deletion.ts";

const RESET_LEASE_MS = 60_000;

export type HealthDataResetStatus = "pending" | "processing" | "failed" | "completed";
export type HealthDataResetStage = "waiting" | "data" | "auth" | "verification" | "completed";

export interface HealthDataReset {
  requestId: string;
  userId: string;
  recipientId: string;
  status: HealthDataResetStatus;
  stage: HealthDataResetStage;
  deleteFirebaseAccount: boolean;
  requestedAt: string;
  updatedAt: string;
  completedAt?: string;
  leaseUntil?: string;
  attempts: number;
  deletedDocuments: number;
  verified: boolean;
  errorCode?: "RESET_DATA_FAILED" | "RESET_AUTH_FAILED" | "RESET_VERIFICATION_FAILED";
}

type Dependencies = {
  firestore?: FirestoreLike;
  auth?: FirebaseAccountAdmin;
  now?: () => Date;
};

const activeStatuses = new Set<HealthDataResetStatus>(["pending", "processing", "failed"]);

function publicReset(job: HealthDataReset) {
  return {
    requestId: job.requestId,
    status: job.status,
    stage: job.stage,
    deleteFirebaseAccount: job.deleteFirebaseAccount,
    requestedAt: job.requestedAt,
    completedAt: job.completedAt,
    attempts: job.attempts,
    deletedDocuments: job.deletedDocuments,
    verified: job.verified,
  };
}

export function publicHealthDataReset(job: HealthDataReset) { return publicReset(job); }

async function dependencies(input: Dependencies) {
  return {
    firestore: input.firestore ?? await getAdminFirestore(),
    auth: input.auth ?? await getFirebaseAccountAdmin(),
    now: input.now ?? (() => new Date()),
  };
}

export async function getHealthDataReset(userId: string, firestore?: FirestoreLike) {
  const recipientId = accountRecipientId(userId);
  firestore ??= await getAdminFirestore();
  const document = await firestore.collection(HEALTH_DATA_RESETS_COLLECTION).doc(recipientId).get();
  if (!document.exists) return null;
  const reset = document.data() as HealthDataReset;
  return reset.userId === userId && reset.recipientId === recipientId ? reset : null;
}

export async function requestHealthDataReset(input: {
  userId: string;
  tokenUserId: string;
  authTime: number;
  confirmation: string;
  deleteFirebaseAccount: boolean;
}, provided: Dependencies = {}) {
  if (input.confirmation !== "건강정보 삭제") throw new Error("RESET_CONFIRMATION_REQUIRED");
  const { firestore, now } = await dependencies(provided);
  assertRecentAccountAuthentication({
    userId: input.userId,
    tokenUserId: input.tokenUserId,
    authTime: input.authTime,
    now: now(),
  });
  const recipientId = accountRecipientId(input.userId);
  const ref = firestore.collection(HEALTH_DATA_RESETS_COLLECTION).doc(recipientId);
  return firestore.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    const existing = current.data() as HealthDataReset | undefined;
    if (existing && activeStatuses.has(existing.status)) {
      if (existing.userId !== input.userId || existing.deleteFirebaseAccount !== input.deleteFirebaseAccount) {
        throw new Error("RESET_ALREADY_IN_PROGRESS");
      }
      return existing;
    }
    await assertCareAccountActive(firestore, recipientId, tx);
    const timestamp = now().toISOString();
    const reset: HealthDataReset = {
      requestId: randomUUID(),
      userId: input.userId,
      recipientId,
      status: "pending",
      stage: "waiting",
      deleteFirebaseAccount: input.deleteFirebaseAccount,
      requestedAt: timestamp,
      updatedAt: timestamp,
      attempts: 0,
      deletedDocuments: 0,
      verified: false,
    };
    tx.set(ref, reset);
    return reset;
  });
}

export async function processHealthDataReset(userId: string, provided: Dependencies = {}) {
  const { firestore, auth, now } = await dependencies(provided);
  const recipientId = accountRecipientId(userId);
  const ref = firestore.collection(HEALTH_DATA_RESETS_COLLECTION).doc(recipientId);
  const claimed = await firestore.runTransaction(async (tx) => {
    const document = await tx.get(ref);
    if (!document.exists) return { job: null, shouldProcess: false };
    const current = document.data() as HealthDataReset;
    if (current.userId !== userId || current.recipientId !== recipientId) return { job: null, shouldProcess: false };
    if (current.status === "completed") return { job: current, shouldProcess: false };
    if (current.status === "processing" && Date.parse(current.leaseUntil ?? "") > now().getTime()) {
      return { job: current, shouldProcess: false };
    }
    const next: HealthDataReset = {
      ...current,
      status: "processing",
      stage: current.stage === "auth" ? "auth" : "data",
      attempts: current.attempts + 1,
      leaseUntil: new Date(now().getTime() + RESET_LEASE_MS).toISOString(),
      updatedAt: now().toISOString(),
      errorCode: undefined,
    };
    tx.set(ref, next);
    return { job: next, shouldProcess: true };
  });
  if (!claimed.job || !claimed.shouldProcess) return claimed.job;

  try {
    if (await hasActiveAccountProcessing(firestore, recipientId, now())) {
      const pending = { ...claimed.job, status: "pending" as const, stage: "waiting" as const, leaseUntil: undefined, updatedAt: now().toISOString() };
      await ref.set(pending);
      return pending;
    }

    let current = claimed.job;
    if (current.stage !== "auth") {
      const deleted = await deleteRecipientHealthData({
        firestore,
        recipientId,
        includeProfile: true,
        limit: 200,
      });
      current = {
        ...current,
        deletedDocuments: current.deletedDocuments + deleted.deletedDocuments,
        verified: deleted.verified,
        stage: deleted.verified ? (current.deleteFirebaseAccount ? "auth" : "verification") : "data",
        status: deleted.verified ? "processing" : "pending",
        leaseUntil: undefined,
        updatedAt: now().toISOString(),
      };
      await ref.set(current);
      if (!deleted.verified) return current;
    }

    if (current.deleteFirebaseAccount) {
      await auth.delete(userId);
    } else {
      const initial = createInitialCareSnapshot({ recipientId });
      await firestore.collection("careRecipients").doc(recipientId).set(initial.recipient);
    }

    const verified = await verifyRecipientHealthDataDeleted({
      firestore,
      recipientId,
      includeProfile: current.deleteFirebaseAccount,
    });
    if (!verified) throw new Error("RESET_VERIFICATION_FAILED");
    const completedAt = now().toISOString();
    const completed: HealthDataReset = {
      ...current,
      status: "completed",
      stage: "completed",
      completedAt,
      updatedAt: completedAt,
      leaseUntil: undefined,
      verified: true,
      errorCode: undefined,
    };
    await ref.set(completed);
    return completed;
  } catch (error) {
    const current = await getHealthDataReset(userId, firestore) ?? claimed.job;
    const code = error instanceof Error ? error.message : "";
    const errorCode: HealthDataReset["errorCode"] = current.stage === "auth"
      ? "RESET_AUTH_FAILED"
      : code === "RESET_VERIFICATION_FAILED"
        ? "RESET_VERIFICATION_FAILED"
        : "RESET_DATA_FAILED";
    const failed: HealthDataReset = {
      ...current,
      status: "failed",
      leaseUntil: undefined,
      updatedAt: now().toISOString(),
      errorCode,
    };
    await ref.set(failed);
    return failed;
  }
}
