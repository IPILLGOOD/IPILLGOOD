import { randomUUID } from "node:crypto";
import { assertCareAccountActive } from "./account-lifecycle.ts";
import { getAdminFirestore } from "./firebase-admin.ts";
import type { FirestoreLike } from "./firestore-rest.ts";

/** Fence external work as well as DB writes. Erasure drains admitted work before completion. */
export async function withCareAccountProcessing<T>(recipientId: string, work: () => Promise<T>, firestore?: FirestoreLike): Promise<T> {
  if (!recipientId.startsWith("google-")) return work();
  firestore ??= await getAdminFirestore();
  const ref = firestore.collection("careRecipients").doc(recipientId).collection("processingLeases").doc(randomUUID());
  await firestore.runTransaction(async (tx) => {
    await assertCareAccountActive(firestore!, recipientId, tx);
    // Longer than the bounded external request/retry timeouts. Crashed workers cannot block forever.
    tx.create(ref, { expiresAt: new Date(Date.now() + 300_000).toISOString() });
  });
  try {
    await assertCareAccountActive(firestore, recipientId);
    return await work();
  } finally {
    await firestore.batch().delete(ref).commit();
  }
}

export async function hasActiveAccountProcessing(firestore: FirestoreLike, recipientId: string, now: Date) {
  const leases = await firestore.collection("careRecipients").doc(recipientId).collection("processingLeases").get();
  return leases.docs.some((doc) => {
    const expiresAt = Date.parse((doc.data() as { expiresAt?: string }).expiresAt ?? "");
    return !Number.isFinite(expiresAt) || expiresAt > now.getTime();
  });
}
