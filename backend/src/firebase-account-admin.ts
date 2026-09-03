import { FirestoreRestClient } from "./firestore-rest.ts";

export type FirebaseAccount = { localId: string; disabled?: boolean; validSince?: string };
export interface FirebaseAccountAdmin {
  lookup(userId: string): Promise<FirebaseAccount | null>;
  revoke(userId: string): Promise<void>;
  disable(userId: string): Promise<void>;
  delete(userId: string): Promise<void>;
}

export function createFirebaseAccountAdmin(input: { projectId: string; accessToken: () => Promise<string>; fetcher?: typeof fetch; emulatorHost?: string; quotaProjectId?: string }): FirebaseAccountAdmin {
  if (input.emulatorHost && (!input.projectId.startsWith("demo-") || !/^(127\.0\.0\.1|localhost):\d+$/.test(input.emulatorHost))) {
    throw new Error("Auth emulator requires a demo- project and loopback host.");
  }
  const origin = input.emulatorHost ? `http://${input.emulatorHost}/identitytoolkit.googleapis.com` : "https://identitytoolkit.googleapis.com";
  async function request(method: string, data: object, allowMissing = false) {
    const response = await (input.fetcher ?? fetch)(`${origin}/v1/projects/${encodeURIComponent(input.projectId)}/accounts:${method}`, {
      method: "POST", headers: {
        Authorization: `Bearer ${await input.accessToken()}`,
        "Content-Type": "application/json",
        ...(input.quotaProjectId ? { "x-goog-user-project": input.quotaProjectId } : {}),
      },
      body: JSON.stringify(data), signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json() as { error?: { message?: string }; users?: FirebaseAccount[] };
    if (!response.ok && !(allowMissing && result.error?.message === "USER_NOT_FOUND")) {
      // Do not include upstream payloads or identifiers in operational logs.
      throw new Error(`FIREBASE_ACCOUNT_${method.toUpperCase()}_FAILED`);
    }
    return result;
  }
  return {
    async lookup(userId) { return (await request("lookup", { localId: [userId] })).users?.find((user) => user.localId === userId) ?? null; },
    async revoke(userId) { await request("update", { localId: userId, validSince: String(Math.floor(Date.now() / 1000)) }, true); },
    async disable(userId) { await request("update", { localId: userId, disableUser: true, validSince: String(Math.floor(Date.now() / 1000)) }, true); },
    async delete(userId) { await request("delete", { localId: userId }, true); },
  };
}

let admin: Promise<FirebaseAccountAdmin> | undefined;
export function getFirebaseAccountAdmin() {
  if (!admin) admin = (async () => {
    const projectId = process.env.FIREBASE_PROJECT_ID ?? "care-atlas-seoul-2026-v3";
    const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const credentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    let accessToken: () => Promise<string>;
    let quotaProjectId: string | undefined;
    if (emulatorHost) accessToken = async () => "owner";
    else if (credentials) {
      const oauth = new FirestoreRestClient(JSON.parse(credentials), projectId, fetch, undefined, "https://www.googleapis.com/auth/identitytoolkit");
      accessToken = () => oauth.getAccessToken();
    } else {
      const { GoogleAuth } = await import("google-auth-library");
      const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/identitytoolkit"] });
      quotaProjectId = (await auth.getClient()).quotaProjectId;
      accessToken = async () => { const token = await auth.getAccessToken(); if (!token) throw new Error("AUTH_CREDENTIALS_MISSING"); return token; };
    }
    return createFirebaseAccountAdmin({ projectId, accessToken, emulatorHost, quotaProjectId });
  })().catch((error) => { admin = undefined; throw error; });
  return admin;
}
