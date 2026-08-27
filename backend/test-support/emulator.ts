import { randomUUID } from "node:crypto";
import { Firestore } from "@google-cloud/firestore";
import { createEmulatorFirestoreRestClient, type FirestoreLike } from "../src/firestore-rest.ts";

export function emulatorFixture(adapter: "admin" | "rest") {
  const projectId = process.env.FIREBASE_PROJECT_ID ?? "";
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? "";
  if (!projectId.startsWith("demo-") || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
    throw new Error("Integration tests require a demo- project and loopback Firestore emulator.");
  }
  const admin = new Firestore({ projectId, ignoreUndefinedProperties: true });
  const firestore: FirestoreLike = adapter === "rest" ? createEmulatorFirestoreRestClient(projectId, host) : admin as unknown as FirestoreLike;
  const namespace = `test-${randomUUID()}`;
  const scope = { recipientId: `google-${namespace}`, firestore };
  return {
    admin, firestore, namespace, scope,
    async cleanup() {
      await admin.recursiveDelete(admin.collection(namespace));
      await admin.recursiveDelete(admin.collection("careRecipients").doc(scope.recipientId));
      await admin.collection("careReadModels").doc(scope.recipientId).delete();
      for (const collection of ["pushSubscriptions", "medicationReminderSchedules", "medicationReminderSync", "pushDeliveries"]) {
        const documents = await admin.collection(collection).where("recipientId", "==", scope.recipientId).get();
        for (const document of documents.docs) await document.ref.delete();
      }
      await admin.terminate();
    },
  };
}
