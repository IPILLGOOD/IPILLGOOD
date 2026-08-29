import type { DocumentReferenceLike, FirestoreLike, TransactionLike } from "./firestore-rest.ts";

const RECIPIENT_SCOPED_COLLECTIONS = ["pushSubscriptions", "medicationReminderSchedules", "pushDeliveries", "medicationReminderSync"] as const;

async function* documentTree(ref: DocumentReferenceLike): AsyncGenerator<DocumentReferenceLike> {
  for (const collection of await ref.listCollections()) {
    for (const child of await collection.listDocuments()) yield* documentTree(child);
  }
  if ((await ref.get()).exists) yield ref;
}

async function* healthReferences(firestore: FirestoreLike, recipientId: string, includeProfile: boolean) {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(recipientId)) throw new Error("Invalid deletion scope.");
  // Descendants first, including unknown collections and children of missing documents.
  const recipient = firestore.collection("careRecipients").doc(recipientId);
  if (includeProfile) yield* documentTree(recipient);
  else for (const collection of await recipient.listCollections()) {
    for (const child of await collection.listDocuments()) yield* documentTree(child);
  }
  yield* documentTree(firestore.collection("careReadModels").doc(recipientId));
  if (includeProfile) {
    yield* documentTree(firestore.collection("careConnections").doc(recipientId));
    const codes = await firestore.collection("connectionCodes").where("recipientId", "==", recipientId).get();
    for (const code of codes.docs) yield* documentTree(code.ref);
  }
  yield* notificationReferences(firestore, recipientId);
}

async function* notificationReferences(firestore: FirestoreLike, recipientId: string) {
  for (const name of RECIPIENT_SCOPED_COLLECTIONS) {
    const rows = await firestore.collection(name).where("recipientId", "==", recipientId).get();
    for (const row of rows.docs) yield* documentTree(row.ref);
  }
  // Legacy sync rows may not have a recipientId field.
  yield* documentTree(firestore.collection("medicationReminderSync").doc(recipientId));
}

/** Discovery can be slow; validate ownership in the same transaction as the actual deletes. */
export async function deleteRecipientNotifications(
  firestore: FirestoreLike,
  recipientId: string,
  assertOwnership: (tx: TransactionLike) => Promise<void>,
) {
  const targets: DocumentReferenceLike[] = [];
  const seen = new Set<string>();
  for await (const ref of notificationReferences(firestore, recipientId)) {
    if (seen.has(ref.path)) continue;
    seen.add(ref.path);
    targets.push(ref);
    if (seen.size >= 200) break;
  }
  if (targets.length) await firestore.runTransaction(async (tx) => {
    await assertOwnership(tx);
    for (const ref of targets) tx.delete(ref);
  });
  for await (const _ref of notificationReferences(firestore, recipientId)) return false;
  return true;
}

/** Shared erasure primitive for #55/#99 and demo cleanup. Caller must fence writes first. */
export async function deleteRecipientHealthData(input: { firestore: FirestoreLike; recipientId: string; includeProfile: boolean; limit?: number }) {
  let deletedDocuments = 0;
  let batch = input.firestore.batch();
  let size = 0;
  const seen = new Set<string>();
  for await (const ref of healthReferences(input.firestore, input.recipientId, input.includeProfile)) {
    if (seen.has(ref.path)) continue;
    seen.add(ref.path);
    batch.delete(ref);
    size++;
    deletedDocuments++;
    if (size === 200 || deletedDocuments >= (input.limit ?? Infinity)) {
      await batch.commit();
      batch = input.firestore.batch();
      size = 0;
    }
    if (deletedDocuments >= (input.limit ?? Infinity)) break;
  }
  if (size) await batch.commit();
  return { deletedDocuments, verified: await verifyRecipientHealthDataDeleted(input) };
}

export async function verifyRecipientHealthDataDeleted(input: { firestore: FirestoreLike; recipientId: string; includeProfile: boolean }) {
  for await (const _ref of healthReferences(input.firestore, input.recipientId, input.includeProfile)) return false;
  return true;
}
