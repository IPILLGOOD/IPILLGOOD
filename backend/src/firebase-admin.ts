import type { Firestore } from "firebase-admin/firestore";

import type { FirestoreLike } from "./firestore-rest";

const projectId =
  process.env.FIREBASE_PROJECT_ID ??
  process.env.GOOGLE_CLOUD_PROJECT ??
  "care-atlas-seoul-2026-v2";

let firestorePromise: Promise<FirestoreLike> | undefined;

export function getAdminFirestore() {
  if (!firestorePromise) {
    if (globalThis.navigator?.userAgent === "Cloudflare-Workers") {
      const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      if (!serviceAccountJson) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured.");
      }
      firestorePromise = import("./firestore-rest").then(({ createFirestoreRestClient }) =>
        createFirestoreRestClient(serviceAccountJson, projectId),
      );
    } else {
      firestorePromise = Promise.all([
        import("firebase-admin/app"),
        import("firebase-admin/firestore"),
      ]).then(([{ applicationDefault, getApps, initializeApp }, { getFirestore }]) => {
        const app =
          getApps()[0] ??
          initializeApp({
            credential: applicationDefault(),
            projectId,
          });
        return getFirestore(app) as Firestore as unknown as FirestoreLike;
      });
    }
  }

  return firestorePromise;
}
