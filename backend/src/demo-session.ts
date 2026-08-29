import demoSeed from "./data/demo-seed.json" with { type: "json" };

import { getAdminFirestore } from "./firebase-admin.ts";
import { deleteRecipientHealthData } from "./health-data-deletion.ts";
import type {
  DocumentReferenceLike,
  FirestoreLike,
} from "./firestore-rest.ts";
import type { CareSnapshot } from "./types.ts";

const DEMO_SESSIONS_COLLECTION = "demoSessions";
const READ_MODELS_COLLECTION = "careReadModels";
const RECIPIENTS_COLLECTION = "careRecipients";
const DEMO_SESSION_ID_PATTERN =
  /^demo-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const DEMO_SESSION_DURATION_SECONDS = 2 * 60 * 60;
export const DEMO_SESSION_CLEANUP_GRACE_SECONDS = 5 * 60;

export interface EphemeralDemoSession {
  id: string;
  recipientId: string;
  status: "active" | "deleting";
  createdAt: string;
  expiresAt: string;
  cleanupAfter?: string;
}

type DemoSeed = Omit<CareSnapshot, "dataSource" | "revision">;
const seed = demoSeed as DemoSeed;

export function isEphemeralDemoSessionId(value: string) {
  return DEMO_SESSION_ID_PATTERN.test(value);
}

export function createEphemeralDemoSessionId(
  randomUuid: () => string = () => crypto.randomUUID(),
) {
  const id = `demo-${randomUuid().toLowerCase()}`;
  if (!isEphemeralDemoSessionId(id)) {
    throw new Error("안전한 데모 세션 ID를 만들지 못했습니다.");
  }
  return id;
}

export function ephemeralDemoSessionExpiresAt(now = new Date()) {
  return new Date(now.getTime() + DEMO_SESSION_DURATION_SECONDS * 1_000);
}

function assertDemoSessionId(id: string) {
  if (!isEphemeralDemoSessionId(id)) {
    throw new Error("올바르지 않은 데모 세션 ID입니다.");
  }
}

function demoSnapshot(recipientId: string): CareSnapshot {
  const cloned = structuredClone(seed);
  return {
    ...cloned,
    recipient: { ...cloned.recipient, id: recipientId },
    todayCheckIn: null,
    dataSource: "firestore",
    revision: 0,
  };
}

function storedDemoReadModel(snapshot: CareSnapshot, now: Date) {
  const { dataSource: _dataSource, revision: _revision, ...stored } = snapshot;
  return { ...stored, updatedAt: now.toISOString() };
}

export async function createEphemeralDemoSession(input: {
  id: string;
  now?: Date;
  expiresAt?: Date;
  firestore?: FirestoreLike;
}) {
  assertDemoSessionId(input.id);
  const now = input.now ?? new Date();
  const expiresAt = input.expiresAt ?? ephemeralDemoSessionExpiresAt(now);
  if (expiresAt.getTime() <= now.getTime()) {
    throw new Error("데모 세션 만료 시각은 생성 시각보다 이후여야 합니다.");
  }

  const firestore = input.firestore ?? (await getAdminFirestore());
  const session: EphemeralDemoSession = {
    id: input.id,
    recipientId: input.id,
    status: "active",
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  const snapshot = demoSnapshot(input.id);
  const recipientRef = firestore.collection(RECIPIENTS_COLLECTION).doc(input.id);
  const batch = firestore.batch();

  batch.create(firestore.collection(DEMO_SESSIONS_COLLECTION).doc(input.id), session);
  batch.set(recipientRef, snapshot.recipient);
  for (const medication of snapshot.medications) {
    batch.set(recipientRef.collection("medicationPlans").doc(medication.id), medication);
  }
  for (const event of snapshot.doseEvents) {
    batch.set(recipientRef.collection("doseEvents").doc(event.id), event);
  }
  for (const event of snapshot.symptomEvents) {
    batch.set(recipientRef.collection("symptomEvents").doc(event.id), event);
  }
  for (const document of snapshot.documents) {
    batch.set(recipientRef.collection("clinicalDocuments").doc(document.id), document);
  }
  for (const question of snapshot.clinicianQuestions) {
    batch.set(recipientRef.collection("clinicianQuestions").doc(question.id), question);
  }
  batch.set(
    firestore.collection(READ_MODELS_COLLECTION).doc(input.id),
    storedDemoReadModel(snapshot, now),
  );
  await batch.commit();
  return session;
}

export async function isEphemeralDemoSessionActive(
  id: string,
  options: { now?: Date; firestore?: FirestoreLike } = {},
) {
  if (!isEphemeralDemoSessionId(id)) return false;
  try {
    const firestore = options.firestore ?? (await getAdminFirestore());
    const document = await firestore.collection(DEMO_SESSIONS_COLLECTION).doc(id).get();
    if (!document.exists) return false;
    const session = document.data() as EphemeralDemoSession;
    const now = options.now ?? new Date();
    return (
      session.id === id &&
      session.recipientId === id &&
      session.status === "active" &&
      new Date(session.expiresAt).getTime() > now.getTime()
    );
  } catch (error) {
    if (globalThis.navigator?.userAgent !== "Cloudflare-Workers") {
      console.error("Ephemeral demo session validation failed", error);
    }
    return false;
  }
}

async function deleteReferencesInChunks(
  firestore: FirestoreLike,
  references: DocumentReferenceLike[],
) {
  const chunkSize = 400;
  for (let index = 0; index < references.length; index += chunkSize) {
    const batch = firestore.batch();
    for (const reference of references.slice(index, index + chunkSize)) {
      batch.delete(reference);
    }
    await batch.commit();
  }
}

export async function deleteEphemeralDemoSession(input: {
  id: string;
  now?: Date;
  firestore?: FirestoreLike;
  force?: boolean;
}) {
  assertDemoSessionId(input.id);
  const firestore = input.firestore ?? (await getAdminFirestore());
  const now = input.now ?? new Date();
  const sessionRef = firestore.collection(DEMO_SESSIONS_COLLECTION).doc(input.id);
  const sessionDocument = await sessionRef.get();
  const session = sessionDocument.exists
    ? (sessionDocument.data() as EphemeralDemoSession)
    : undefined;
  const existingCleanupAfter = session?.cleanupAfter
    ? new Date(session.cleanupAfter)
    : undefined;
  const cleanupAfter =
    existingCleanupAfter && Number.isFinite(existingCleanupAfter.getTime())
      ? existingCleanupAfter
      : new Date(now.getTime() + DEMO_SESSION_CLEANUP_GRACE_SECONDS * 1_000);
  const finalize =
    input.force === true ||
    !session ||
    (session.status === "deleting" && cleanupAfter.getTime() <= now.getTime());

  if (session && !finalize) {
    await sessionRef.set(
      {
        status: "deleting",
        expiresAt: cleanupAfter.toISOString(),
        cleanupAfter: cleanupAfter.toISOString(),
      },
      { merge: true },
    );
  }

  const deleted = await deleteRecipientHealthData({ firestore, recipientId: input.id, includeProfile: true });
  const rootReferences = finalize ? [sessionRef] : [];
  await deleteReferencesInChunks(firestore, rootReferences);
  return {
    id: input.id,
    deletedDocuments: deleted.deletedDocuments + rootReferences.length,
    finalized: finalize,
  };
}

export async function cleanupExpiredDemoSessions(input: {
  now?: Date;
  limit?: number;
  firestore?: FirestoreLike;
} = {}) {
  const firestore = input.firestore ?? (await getAdminFirestore());
  const now = input.now ?? new Date();
  const expired = await firestore
    .collection(DEMO_SESSIONS_COLLECTION)
    .where("expiresAt", "<=", now.toISOString())
    .limit(input.limit ?? 25)
    .get();
  const results = [];
  for (const document of expired.docs) {
    if (!isEphemeralDemoSessionId(document.id)) continue;
    results.push(
      await deleteEphemeralDemoSession({ id: document.id, now, firestore }),
    );
  }
  return {
    checked: expired.docs.length,
    cleanedSessions: results.length,
    finalizedSessions: results.filter((result) => result.finalized).length,
    deletedDocuments: results.reduce((sum, result) => sum + result.deletedDocuments, 0),
  };
}
