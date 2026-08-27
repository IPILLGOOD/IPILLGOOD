// Operator tool, never exposed as an unauthenticated HTTP route.
const [command, recipientId, ...flags] = process.argv.slice(2);
if (!["read-model", "reminders", "retry-reminders"].includes(command) || !recipientId || !/^[^/]{1,256}$/.test(recipientId)) {
  throw new Error("Usage: node --experimental-strip-types backend/scripts/repair-care.mjs <read-model|reminders|retry-reminders> <recipientId> [--apply] [--allow-production]");
}
const project = process.env.FIREBASE_PROJECT_ID;
if (!project || (!project.startsWith("demo-") && !flags.includes("--allow-production"))) {
  throw new Error("Set FIREBASE_PROJECT_ID explicitly; non-demo projects also require --allow-production.");
}
if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error("Invalid emulator host.");
const { getAdminFirestore } = await import("../src/firebase-admin.ts");
const { rebuildCareReadModel } = await import("../src/care-repository.ts");
const { syncMedicationReminderSchedules, retryMedicationReminderSync } = await import("../src/reminder-reconciliation.ts");
const firestore = await getAdminFirestore();
try {
  if (command === "read-model") {
    const result = await rebuildCareReadModel({ recipientId, firestore }, { apply: flags.includes("--apply") });
    console.log(JSON.stringify({ command, driftDetected: result.repaired, applied: flags.includes("--apply") && result.repaired }));
  } else if (flags.includes("--apply")) {
    if (command === "retry-reminders") await retryMedicationReminderSync(recipientId, firestore);
    else await syncMedicationReminderSchedules({ recipientId, firestore });
    console.log(JSON.stringify({ command, applied: true }));
  } else {
    const job = (await firestore.collection("medicationReminderSync").doc(recipientId).get()).data();
    console.log(JSON.stringify({ command, applied: false, status: job?.status ?? "missing", attempts: job?.attempts ?? 0,
      desiredRevision: job?.desiredRevision, appliedRevision: job?.appliedRevision,
      queuedAt: job?.queuedAt, lastSucceededAt: job?.lastSucceededAt, lastFailureAt: job?.lastFailureAt, lastQueueDelayMs: job?.lastQueueDelayMs,
    }));
  }
} finally {
  if (typeof firestore.terminate === "function") await firestore.terminate();
}
