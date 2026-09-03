import { readFile } from "node:fs/promises";

import { Firestore } from "@google-cloud/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID ?? "care-atlas-seoul-2026-v3";
const seedUrl = new URL("../src/data/demo-seed.json", import.meta.url);
const seed = JSON.parse(await readFile(seedUrl, "utf8"));

const db = new Firestore({ projectId });
const recipientRef = db.collection("careRecipients").doc(seed.recipient.id);
const readModelRef = db.collection("careReadModels").doc(seed.recipient.id);
const batch = db.batch();

batch.set(recipientRef, seed.recipient, { merge: true });
batch.set(readModelRef, {
  ...seed,
  todayCheckIn: null,
  updatedAt: new Date().toISOString(),
});

const collections = [
  ["medicationPlans", seed.medications],
  ["doseEvents", seed.doseEvents],
  ["symptomEvents", seed.symptomEvents],
  ["clinicalDocuments", seed.documents],
  ["clinicianQuestions", seed.clinicianQuestions],
];

for (const [collectionName, documents] of collections) {
  for (const document of documents) {
    batch.set(recipientRef.collection(collectionName).doc(document.id), document, { merge: true });
  }
}

await batch.commit();
console.log(`Seeded IPILLGOOD demo data to ${projectId}.`);
