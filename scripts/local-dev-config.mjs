import { randomBytes } from "node:crypto";

export const LOCAL_FIREBASE_PROJECT_ID = "demo-ipillgood-local";
export const LOCAL_FIRESTORE_HOST = "127.0.0.1:8181";
export const LOCAL_AUTH_HOST = "127.0.0.1:9199";

export function localFirebaseEnvironment(base = process.env) {
  return {
    ...base,
    FIREBASE_PROJECT_ID: LOCAL_FIREBASE_PROJECT_ID,
    GOOGLE_CLOUD_PROJECT: LOCAL_FIREBASE_PROJECT_ID,
    GCLOUD_PROJECT: LOCAL_FIREBASE_PROJECT_ID,
    FIRESTORE_EMULATOR_HOST: LOCAL_FIRESTORE_HOST,
    FIREBASE_AUTH_EMULATOR_HOST: LOCAL_AUTH_HOST,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: LOCAL_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: LOCAL_AUTH_HOST,
    IPILLGOOD_DEMO_MODE: "true",
    SESSION_SECRET: randomBytes(48).toString("base64url"),
    CONNECTION_CODE_SECRET: randomBytes(48).toString("base64url"),
    FIREBASE_SERVICE_ACCOUNT_JSON: "",
    GOOGLE_APPLICATION_CREDENTIALS: "",
  };
}

export function parseJavaMajorVersion(output) {
  const match = /version "(?:1\.)?(\d+)/.exec(output);
  return match ? Number(match[1]) : undefined;
}
