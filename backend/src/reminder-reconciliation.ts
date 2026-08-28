import { createHash } from "node:crypto";
import { isCareAccountActive } from "./account-lifecycle.ts";
import { getAdminFirestore } from "./firebase-admin.ts";
import type { FirestoreLike } from "./firestore-rest.ts";
import { buildMedicationReminderSchedules, type MedicationReminderSchedule } from "./medication-schedule.ts";
import { isEphemeralDemoSessionId } from "./demo-session.ts";
import type { MedicationPlan } from "./types.ts";
import { stableJson } from "./stable-json.ts";

export const REMINDER_SYNC_COLLECTION = "medicationReminderSync";

export function medicationPlanRevision(plan: MedicationPlan) {
  return createHash("sha256").update(JSON.stringify([
    plan.id, plan.frequency, plan.timing, plan.startDate, plan.endDate ?? null, plan.status,
  ])).digest("hex").slice(0, 32);
}

function comparable(schedule: MedicationReminderSchedule) {
  const { updatedAt: _updatedAt, ...fields } = schedule;
  return stableJson(fields);
}

export async function syncMedicationReminderSchedules(input: {
  recipientId: string;
  /** Compatibility only. Canonical medicationPlans are always the source of truth. */
  medications?: MedicationPlan[];
  now?: Date;
  firestore?: FirestoreLike;
}) {
  const firestore = input.firestore ?? await getAdminFirestore();
  const now = input.now ?? new Date();
  const recipient = firestore.collection("careRecipients").doc(input.recipientId);
  const jobRef = firestore.collection(REMINDER_SYNC_COLLECTION).doc(input.recipientId);
  return firestore.runTransaction(async (tx) => {
    if (!await isCareAccountActive(firestore, input.recipientId, tx)) return [];
    const [plans, model, subscriptions, schedules, job, demo] = await Promise.all([
      tx.get(recipient.collection("medicationPlans")), tx.get(firestore.collection("careReadModels").doc(input.recipientId)),
      tx.get(firestore.collection("pushSubscriptions").where("recipientId", "==", input.recipientId)),
      tx.get(firestore.collection("medicationReminderSchedules").where("recipientId", "==", input.recipientId)),
      tx.get(jobRef),
      isEphemeralDemoSessionId(input.recipientId) ? tx.get(firestore.collection("demoSessions").doc(input.recipientId)) : null,
    ]);
    const active = subscriptions.docs.some((doc) => (doc.data() as { active?: boolean }).active);
    const validDemo = !demo || (demo.exists && (demo.data() as { status: string }).status === "active" && Date.parse((demo.data() as { expiresAt: string }).expiresAt) > now.getTime());
    const medications = plans.docs.map((doc) => doc.data() as MedicationPlan);
    const desired = active && validDemo && model.exists ? buildMedicationReminderSchedules(input.recipientId, medications, now) : [];
    const old = new Map(schedules.docs.map((doc) => [doc.id, doc.data() as MedicationReminderSchedule]));
    const versions = new Map(medications.map((plan) => [plan.id, medicationPlanRevision(plan)]));
    // The final occurrence still needs delivery during its grace window even when no future date exists.
    if (active && validDemo && model.exists) {
      for (const current of old.values()) {
        const plan = medications.find((item) => item.id === current.medicationPlanId);
        if (!plan || current.status !== "active" || Date.parse(current.nextDueAt) + 30 * 60_000 < now.getTime()) continue;
        const canonical = buildMedicationReminderSchedules(input.recipientId, [plan], new Date(Date.parse(current.nextDueAt) - 1)).find((item) => item.id === current.id);
        const matching = canonical && canonical.nextDueAt === current.nextDueAt && canonical.timeLabel === current.timeLabel && canonical.intervalDays === current.intervalDays && canonical.startDate === current.startDate && canonical.endDate === current.endDate;
        if (!matching || (current.planRevisionId && current.planRevisionId !== versions.get(plan.id))) continue;
        const index = desired.findIndex((item) => item.id === current.id);
        if (index < 0) desired.push(canonical);
        else desired[index] = { ...desired[index]!, nextDueAt: current.nextDueAt };
      }
    }
    const normalized = desired.map((schedule) => {
      const current = old.get(schedule.id);
      const revision = versions.get(schedule.medicationPlanId)!;
      const samePlan = current?.planRevisionId === revision;
      return {
        ...schedule,
        ...(current?.status === "active" && samePlan ? { nextDueAt: current.nextDueAt } : {}),
        planRevisionId: revision,
      };
    });
    const ids = new Set(normalized.map((schedule) => schedule.id));
    for (const schedule of normalized) {
      const current = old.get(schedule.id);
      if (!current || comparable(current) !== comparable(schedule)) {
        tx.set(firestore.collection("medicationReminderSchedules").doc(schedule.id), schedule);
      }
    }
    for (const doc of schedules.docs) {
      if (!ids.has(doc.id) && (doc.data() as MedicationReminderSchedule).status !== "ended") {
        tx.set(doc.ref, { status: "ended", updatedAt: now.toISOString() }, { merge: true });
      }
    }
    const revision = (model.data() as { revision?: number } | undefined)?.revision ?? 0;
    const oldJob = job.data() as { status?: string; appliedRevision?: number; queuedAt?: string } | undefined;
    if ((active || job.exists) && (oldJob?.status !== "completed" || oldJob.appliedRevision !== revision)) {
      tx.set(jobRef, { recipientId: input.recipientId, status: "completed", desiredRevision: revision, appliedRevision: revision, attempts: 0,
        completedAt: now.toISOString(), lastSucceededAt: now.toISOString(), errorCode: null,
        lastQueueDelayMs: Math.max(0, now.getTime() - (Date.parse(oldJob?.queuedAt ?? "") || now.getTime())), updatedAt: now.toISOString(),
      }, { merge: true });
    }
    return normalized;
  });
}

export async function reconcileMedicationReminders(input: { firestore?: FirestoreLike; now?: Date; limit?: number } = {}) {
  const firestore = input.firestore ?? await getAdminFirestore();
  const now = input.now ?? new Date();
  const limit = input.limit ?? 25;
  const pending = await firestore.collection(REMINDER_SYNC_COLLECTION).where("status", "==", "pending").where("nextAttemptAt", "<=", now.toISOString()).orderBy("nextAttemptAt").limit(limit).get();
  // Round-robin audit also repairs pre-existing missing/corrupt schedules without a job.
  const cursorRef = firestore.collection("maintenanceCursors").doc("reminder-audit");
  const cursorDoc = await cursorRef.get();
  const cursor = (cursorDoc.data() as { subscriptionId?: string } | undefined)?.subscriptionId;
  let query = firestore.collection("pushSubscriptions").where("active", "==", true).orderBy("id");
  if (cursor) query = query.where("id", ">", cursor);
  const active = await query.limit(limit).get();
  const recipients = new Set([
    ...pending.docs.map((doc) => doc.id),
    ...active.docs.map((doc) => (doc.data() as { recipientId: string }).recipientId),
  ]);
  let processed = 0;
  let failed = 0;
  for (const recipientId of recipients) {
    const ref = firestore.collection(REMINDER_SYNC_COLLECTION).doc(recipientId);
    const before = await ref.get();
    const job = before.data() as { status?: string; attempts?: number; desiredRevision?: number; nextAttemptAt?: string; queuedAt?: string } | undefined;
    if (job?.status === "quarantined" || (job?.status === "pending" && (job.nextAttemptAt ?? "") > now.toISOString())) continue;
    try {
      await syncMedicationReminderSchedules({ recipientId, firestore, now });
      processed++;
    } catch {
      failed++;
      await firestore.runTransaction(async (tx) => {
        if (!await isCareAccountActive(firestore, recipientId, tx)) return;
        const latest = (await tx.get(ref)).data() as typeof job;
        if (latest?.desiredRevision !== job?.desiredRevision || latest?.status !== job?.status) return;
        const attempts = (latest?.attempts ?? 0) + 1;
        tx.set(ref, { recipientId, desiredRevision: latest?.desiredRevision ?? 0,
          status: attempts >= 5 ? "quarantined" : "pending", attempts,
          queuedAt: latest?.status === "pending" ? latest.queuedAt ?? now.toISOString() : now.toISOString(), lastFailureAt: now.toISOString(),
          nextAttemptAt: new Date(now.getTime() + Math.min(60_000 * 2 ** (attempts - 1), 3_600_000)).toISOString(),
          errorCode: "REMINDER_SYNC_FAILED", updatedAt: now.toISOString(),
        }, { merge: true });
      });
    }
  }
  const lastId = active.docs.at(-1)?.id ?? "";
  if (lastId || cursor) await cursorRef.set({ subscriptionId: active.docs.length === limit ? lastId : "", updatedAt: now.toISOString() });
  return { checked: recipients.size, processed, failed };
}

export async function retryMedicationReminderSync(recipientId: string, firestore?: FirestoreLike) {
  firestore ??= await getAdminFirestore();
  const now = new Date().toISOString();
  await firestore.runTransaction(async (tx) => {
    if (!await isCareAccountActive(firestore, recipientId, tx)) return;
    tx.set(firestore.collection(REMINDER_SYNC_COLLECTION).doc(recipientId), { recipientId, status: "pending", attempts: 0, queuedAt: now, nextAttemptAt: now, errorCode: null }, { merge: true });
  });
}
