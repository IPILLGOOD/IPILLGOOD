import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { assertCareAccountActive, accountRecipientId } from "./account-lifecycle.ts";
import { getAdminFirestore } from "./firebase-admin.ts";
import type { FirestoreLike } from "./firestore-rest.ts";

export const CONNECTION_CODE_DURATION_SECONDS = 10 * 60;
export const CONNECTED_SESSION_DURATION_SECONDS = 30 * 24 * 60 * 60;
const CONNECTIONS_COLLECTION = "careConnections";
const CODES_COLLECTION = "connectionCodes";
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export type CareConnectionStatus = "pending" | "active" | "revoked" | "expired";

export type CareConnection = {
  recipientId: string;
  ownerUserId: string;
  ownerDisplayName?: string;
  connectionId: string;
  connectedUserId: string;
  sessionVersion: string;
  status: CareConnectionStatus;
  pendingCodeHash: string | null;
  loginCodeHash?: string | null;
  codeExpiresAt: string | null;
  createdAt: string;
  connectedAt: string | null;
  lastSeenAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  revokeReason: "owner" | "logout" | "expired" | "account_deletion" | null;
  updatedAt: string;
};

type ConnectionCode = {
  codeHash: string;
  recipientId: string;
  ownerUserId: string;
  connectionId: string;
  status: "pending" | "active" | "revoked" | "expired";
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
};

export type PublicCareConnection = Pick<
  CareConnection,
  "status" | "connectedAt" | "lastSeenAt" | "expiresAt" | "codeExpiresAt"
>;

type Dependencies = {
  firestore?: FirestoreLike;
  now?: () => Date;
  codeSecret?: string;
  randomCode?: () => string;
  ownerDisplayName?: string;
};

function ownerDisplayName(value?: string) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 100) : undefined;
}

function connectionCodeSecret(override?: string) {
  const secret = override ?? process.env.CONNECTION_CODE_SECRET;
  if (!secret || new TextEncoder().encode(secret).byteLength < 32) {
    throw new Error("CONNECTION_CODE_SECRET must contain at least 32 bytes.");
  }
  return secret;
}

export function normalizeConnectionCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashConnectionCode(value: string, secret?: string) {
  return createHmac("sha256", connectionCodeSecret(secret))
    .update(normalizeConnectionCode(value))
    .digest("hex");
}

function generateRawCode() {
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function formatCode(raw: string) {
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

function inactiveAt(connection: CareConnection, now: Date) {
  return connection.status === "active" &&
    (!connection.lastSeenAt || Date.parse(connection.lastSeenAt) + CONNECTED_SESSION_DURATION_SECONDS * 1000 <= now.getTime());
}

function publicConnection(connection: CareConnection | undefined, now: Date): PublicCareConnection | null {
  if (!connection) return null;
  if (inactiveAt(connection, now)) return { ...connection, status: "expired" };
  if (connection.status === "pending" && Date.parse(connection.codeExpiresAt ?? "") <= now.getTime()) {
    return { ...connection, status: "expired" };
  }
  return {
    status: connection.status,
    connectedAt: connection.connectedAt,
    lastSeenAt: connection.lastSeenAt,
    expiresAt: connection.expiresAt,
    codeExpiresAt: connection.codeExpiresAt,
  };
}

export async function getCareConnection(ownerUserId: string, dependencies: Dependencies = {}) {
  const firestore = dependencies.firestore ?? await getAdminFirestore();
  const recipientId = accountRecipientId(ownerUserId);
  const reference = firestore.collection(CONNECTIONS_COLLECTION).doc(recipientId);
  const document = await reference.get();
  let connection = document.data() as CareConnection | undefined;
  const currentOwnerName = ownerDisplayName(dependencies.ownerDisplayName);
  if (connection && currentOwnerName && connection.ownerDisplayName !== currentOwnerName) {
    await reference.set({ ownerDisplayName: currentOwnerName }, { merge: true });
    connection = { ...connection, ownerDisplayName: currentOwnerName };
  }
  return publicConnection(connection, (dependencies.now ?? (() => new Date()))());
}

export async function createCareConnectionCode(ownerUserId: string, dependencies: Dependencies = {}) {
  const firestore = dependencies.firestore ?? await getAdminFirestore();
  const now = (dependencies.now ?? (() => new Date()))();
  const recipientId = accountRecipientId(ownerUserId);
  await assertCareAccountActive(firestore, recipientId);
  const rawCode = normalizeConnectionCode((dependencies.randomCode ?? generateRawCode)());
  if (rawCode.length !== 8 || [...rawCode].some((character) => !CODE_ALPHABET.includes(character))) {
    throw new Error("INVALID_GENERATED_CONNECTION_CODE");
  }
  const code = formatCode(rawCode);
  const codeHash = hashConnectionCode(rawCode, dependencies.codeSecret);
  const connectionId = randomUUID();
  const connectedUserId = `connected-${connectionId}`;
  const sessionVersion = randomUUID();
  const expiresAt = new Date(now.getTime() + CONNECTION_CODE_DURATION_SECONDS * 1000).toISOString();
  const connectionRef = firestore.collection(CONNECTIONS_COLLECTION).doc(recipientId);
  const codeRef = firestore.collection(CODES_COLLECTION).doc(codeHash);

  const replaced = await firestore.runTransaction(async (tx) => {
    const currentDocument = await tx.get(connectionRef);
    const current = currentDocument.data() as CareConnection | undefined;
    const active = current?.status === "active" && !inactiveAt(current, now);
    if (active) throw new Error("CARE_CONNECTION_ALREADY_ACTIVE");
    const oldCodeHash = current?.pendingCodeHash ?? current?.loginCodeHash;
    const oldCodeRef = oldCodeHash
      ? firestore.collection(CODES_COLLECTION).doc(oldCodeHash)
      : null;
    const oldCode = oldCodeRef ? await tx.get(oldCodeRef) : null;
    const existingCode = await tx.get(codeRef);
    await assertCareAccountActive(firestore, recipientId, tx);
    if (existingCode.exists) throw new Error("CONNECTION_CODE_COLLISION");
    if (oldCode?.exists && oldCodeRef) tx.set(oldCodeRef, { status: "revoked" }, { merge: true });
    const record: CareConnection = {
      recipientId, ownerUserId, ownerDisplayName: ownerDisplayName(dependencies.ownerDisplayName), connectionId, connectedUserId, sessionVersion,
      status: "pending", pendingCodeHash: codeHash, loginCodeHash: null, codeExpiresAt: expiresAt,
      createdAt: now.toISOString(), connectedAt: null, lastSeenAt: null, expiresAt: null,
      revokedAt: null, revokeReason: null, updatedAt: now.toISOString(),
    };
    tx.set(connectionRef, record);
    tx.create(codeRef, {
      codeHash, recipientId, ownerUserId, connectionId, status: "pending",
      createdAt: now.toISOString(), expiresAt, consumedAt: null,
    } satisfies ConnectionCode);
    return current && inactiveAt(current, now) ? current : null;
  });

  if (replaced) {
    const { deactivatePushSubscriptionsForUser } = await import("./push-repository.ts");
    await deactivatePushSubscriptionsForUser({
      userId: replaced.connectedUserId,
      recipientId: replaced.recipientId,
      now,
      firestore,
    });
  }

  return { code, expiresAt };
}

export async function redeemCareConnectionCode(code: string, dependencies: Dependencies = {}) {
  const firestore = dependencies.firestore ?? await getAdminFirestore();
  const now = (dependencies.now ?? (() => new Date()))();
  const normalized = normalizeConnectionCode(code);
  if (normalized.length !== 8) throw new Error("INVALID_CONNECTION_CODE");
  const codeHash = hashConnectionCode(normalized, dependencies.codeSecret);
  const codeRef = firestore.collection(CODES_COLLECTION).doc(codeHash);
  return firestore.runTransaction(async (tx) => {
    const codeDocument = await tx.get(codeRef);
    const record = codeDocument.data() as ConnectionCode | undefined;
    if (!record) throw new Error("INVALID_CONNECTION_CODE");
    const connectionRef = firestore.collection(CONNECTIONS_COLLECTION).doc(record.recipientId);
    const connectionDocument = await tx.get(connectionRef);
    const connection = connectionDocument.data() as CareConnection | undefined;
    const firstLogin = record.status === "pending" && Date.parse(record.expiresAt) > now.getTime() &&
      connection?.status === "pending" && connection.pendingCodeHash === codeHash &&
      connection.connectionId === record.connectionId;
    const returningLogin = record.status === "active" && connection?.status === "active" &&
      connection.loginCodeHash === codeHash && connection.connectionId === record.connectionId &&
      !inactiveAt(connection, now) && (!connection.expiresAt || Date.parse(connection.expiresAt) > now.getTime());
    if (!connection || (!firstLogin && !returningLogin)) throw new Error("INVALID_CONNECTION_CODE");
    await assertCareAccountActive(firestore, record.recipientId, tx);
    const readModelRef = firestore.collection("careReadModels").doc(record.recipientId);
    const readModel = await tx.get(readModelRef);
    const expiresAt = new Date(now.getTime() + CONNECTED_SESSION_DURATION_SECONDS * 1000).toISOString();
    const sessionVersion = firstLogin ? connection.sessionVersion : randomUUID();
    tx.set(codeRef, { status: "active", consumedAt: record.consumedAt ?? now.toISOString() }, { merge: true });
    tx.set(connectionRef, {
      status: "active", sessionVersion, pendingCodeHash: null, loginCodeHash: codeHash, codeExpiresAt: null,
      connectedAt: connection.connectedAt ?? now.toISOString(), lastSeenAt: now.toISOString(), expiresAt,
      updatedAt: now.toISOString(),
    }, { merge: true });
    if (readModel.exists) {
      tx.set(readModelRef, { revision: ((readModel.data() as { revision?: number }).revision ?? 0) + 1 }, { merge: true });
    }
    return {
      id: connection.connectedUserId,
      name: connection.ownerDisplayName?.trim() || "Google 계정 소유자",
      recipientId: connection.recipientId,
      ownerUserId: connection.ownerUserId,
      connectionId: connection.connectionId,
      sessionVersion,
    };
  });
}

export async function validateCareConnectionSession(input: {
  recipientId: string;
  connectionId: string;
  sessionVersion: string;
}, dependencies: Dependencies = {}) {
  const firestore = dependencies.firestore ?? await getAdminFirestore();
  const now = (dependencies.now ?? (() => new Date()))();
  const document = await firestore.collection(CONNECTIONS_COLLECTION).doc(input.recipientId).get();
  const connection = document.data() as CareConnection | undefined;
  if (!connection || connection.status !== "active" ||
    connection.connectionId !== input.connectionId || connection.sessionVersion !== input.sessionVersion
  ) return null;
  if (inactiveAt(connection, now) || (connection.expiresAt && Date.parse(connection.expiresAt) <= now.getTime())) {
    await expireCareConnection(connection, { ...dependencies, firestore, now: () => now });
    return null;
  }
  try { await assertCareAccountActive(firestore, input.recipientId); } catch { return null; }
  return connection;
}

export async function touchCareConnection(input: {
  recipientId: string;
  connectionId: string;
  sessionVersion: string;
}, dependencies: Dependencies = {}) {
  const firestore = dependencies.firestore ?? await getAdminFirestore();
  const now = (dependencies.now ?? (() => new Date()))();
  const ref = firestore.collection(CONNECTIONS_COLLECTION).doc(input.recipientId);
  return firestore.runTransaction(async (tx) => {
    const document = await tx.get(ref);
    const connection = document.data() as CareConnection | undefined;
    if (!connection || connection.status !== "active" || inactiveAt(connection, now) ||
        connection.connectionId !== input.connectionId || connection.sessionVersion !== input.sessionVersion) {
      throw new Error("CARE_CONNECTION_NOT_ACTIVE");
    }
    await assertCareAccountActive(firestore, input.recipientId, tx);
    const expiresAt = new Date(now.getTime() + CONNECTED_SESSION_DURATION_SECONDS * 1000).toISOString();
    tx.set(ref, { lastSeenAt: now.toISOString(), expiresAt, updatedAt: now.toISOString() }, { merge: true });
    return { ...connection, lastSeenAt: now.toISOString(), expiresAt };
  });
}

async function revokeConnection(
  recipientId: string,
  reason: CareConnection["revokeReason"],
  dependencies: Dependencies,
  expected?: { connectionId: string; sessionVersion: string },
) {
  const firestore = dependencies.firestore ?? await getAdminFirestore();
  const now = (dependencies.now ?? (() => new Date()))();
  const ref = firestore.collection(CONNECTIONS_COLLECTION).doc(recipientId);
  return firestore.runTransaction(async (tx) => {
    const document = await tx.get(ref);
    const connection = document.data() as CareConnection | undefined;
    if (!connection) return null;
    if (expected && (connection.connectionId !== expected.connectionId || connection.sessionVersion !== expected.sessionVersion)) return null;
    const codeHash = connection.pendingCodeHash ?? connection.loginCodeHash;
    const codeRef = codeHash ? firestore.collection(CODES_COLLECTION).doc(codeHash) : null;
    const code = codeRef ? await tx.get(codeRef) : null;
    const readModelRef = firestore.collection("careReadModels").doc(recipientId);
    const readModel = await tx.get(readModelRef);
    if (code?.exists && codeRef) tx.set(codeRef, { status: "revoked" }, { merge: true });
    tx.set(ref, {
      status: reason === "expired" ? "expired" : "revoked", sessionVersion: randomUUID(), pendingCodeHash: null, loginCodeHash: null, codeExpiresAt: null,
      revokedAt: now.toISOString(), revokeReason: reason, updatedAt: now.toISOString(), expiresAt: now.toISOString(),
    }, { merge: true });
    if (readModel.exists) {
      tx.set(readModelRef, { revision: ((readModel.data() as { revision?: number }).revision ?? 0) + 1 }, { merge: true });
    }
    return connection;
  });
}

export async function disconnectCareConnection(ownerUserId: string, dependencies: Dependencies = {}) {
  return revokeConnection(accountRecipientId(ownerUserId), "owner", dependencies);
}

export async function revokeCareConnectionForAccount(recipientId: string, dependencies: Dependencies = {}) {
  return revokeConnection(recipientId, "account_deletion", dependencies);
}

async function expireCareConnection(connection: CareConnection, dependencies: Dependencies) {
  const revoked = await revokeConnection(
    connection.recipientId,
    "expired",
    dependencies,
    { connectionId: connection.connectionId, sessionVersion: connection.sessionVersion },
  );
  if (revoked) {
    const { deactivatePushSubscriptionsForUser } = await import("./push-repository.ts");
    await deactivatePushSubscriptionsForUser({
      userId: revoked.connectedUserId,
      recipientId: revoked.recipientId,
      now: (dependencies.now ?? (() => new Date()))(),
      firestore: dependencies.firestore,
    });
  }
  return revoked;
}

export async function cleanupExpiredCareConnections(dependencies: Dependencies = {}) {
  const firestore = dependencies.firestore ?? await getAdminFirestore();
  const now = (dependencies.now ?? (() => new Date()))();
  const rows = await firestore.collection(CONNECTIONS_COLLECTION).where("status", "==", "active").limit(100).get();
  let expired = 0;
  for (const document of rows.docs) {
    const connection = document.data() as CareConnection;
    if (!inactiveAt(connection, now) && Date.parse(connection.expiresAt ?? "") > now.getTime()) continue;
    if (await expireCareConnection(connection, { ...dependencies, firestore, now: () => now })) expired++;
  }
  return { checked: rows.docs.length, expired };
}
