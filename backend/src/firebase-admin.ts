import type { Firestore } from "@google-cloud/firestore";

import type { FirestoreLike } from "./firestore-rest.ts";

const projectId =
  process.env.FIREBASE_PROJECT_ID ??
  process.env.GOOGLE_CLOUD_PROJECT ??
  "care-atlas-seoul-2026-v3";

let firestorePromise: Promise<FirestoreLike> | undefined;

export function getAdminFirestore() {
  if (!firestorePromise) {
    if (globalThis.navigator?.userAgent === "Cloudflare-Workers") {
      const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      if (!serviceAccountJson) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured.");
      }
      firestorePromise = import("./firestore-rest.ts").then(({ createFirestoreRestClient }) =>
        createFirestoreRestClient(serviceAccountJson, projectId),
      );
    } else {
      firestorePromise = import("@google-cloud/firestore").then(({ Firestore }) => {
        return new Firestore({ projectId, ignoreUndefinedProperties: true }) as Firestore as unknown as FirestoreLike;
      });
    }
  }

  return firestorePromise.catch((error) => {
    firestorePromise = undefined;
    throw error;
  });
}
