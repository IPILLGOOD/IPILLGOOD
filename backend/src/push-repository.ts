import { createHash, randomUUID } from "node:crypto";

import { getAdminFirestore } from "./firebase-admin.ts";
import type { FirestoreLike } from "./firestore-rest.ts";
import {
  advanceMedicationReminderSchedule,
  type MedicationReminderSchedule,
} from "./medication-schedule.ts";
import { medicationPlanRevision, syncMedicationReminderSchedules } from "./reminder-reconciliation.ts";
export { syncMedicationReminderSchedules } from "./reminder-reconciliation.ts";
import type { MedicationPlan } from "./types.ts";
import { stableJson } from "./stable-json.ts";
import {
  sendWebPush,
  type BrowserPushSubscription,
  type VapidConfiguration,
  type WebPushDeliveryResult,
  type WebPushNotificationPayload,
} from "./web-push.ts";

const SUBSCRIPTIONS_COLLECTION = "pushSubscriptions";
const SCHEDULES_COLLECTION = "medicationReminderSchedules";
const DELIVERIES_COLLECTION = "pushDeliveries";

export interface PushSubscriptionRecord {
  id: string;
  userId: string;
  recipientId: string;
  deviceId: string;
  platform: "ios" | "android" | "macos" | "windows" | "other";
  browser: "chrome" | "safari" | "edge" | "firefox" | "other";
  userAgent: string;
  timeZone: string;
  subscription: BrowserPushSubscription;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  lastDeliveryAt?: string;
  lastFailureAt?: string;
  lastHttpStatus?: number;
}

export interface NotificationScheduleStatus {
  activeSubscriptionCount: number;
  activeScheduleCount: number;
  nextReminderAt: string | null;
}

export interface DispatchSummary {
  checked: number;
  claimed: number;
  delivered: number;
  failed: number;
  expiredSubscriptions: number;
  noSubscriptions: number;
  stale: number;
}

export interface PushDeliveryReceipt {
  status: string;
  displayedAt: string | null;
  clickedAt: string | null;
}

function stableId(...values: Array<string | number>) {
  return createHash("sha256")
    .update(values.join("\u0000"))
    .digest("hex")
    .slice(0, 48);
}

function subscriptionRef(
  firestore: FirestoreLike,
  subscriptionId: string,
) {
  return firestore.collection(SUBSCRIPTIONS_COLLECTION).doc(subscriptionId);
}

function scheduleRef(
  firestore: FirestoreLike,
  scheduleId: string,
) {
  return firestore.collection(SCHEDULES_COLLECTION).doc(scheduleId);
}

async function activeSubscriptionsForRecipient(
  firestore: FirestoreLike,
  recipientId: string,
) {
  const snapshot = await firestore
    .collection(SUBSCRIPTIONS_COLLECTION)
    .where("recipientId", "==", recipientId)
    .get();
  return snapshot.docs
    .map((document) => document.data() as PushSubscriptionRecord)
    .filter((subscription) => subscription.active);
}

async function schedulesForRecipient(
  firestore: FirestoreLike,
  recipientId: string,
) {
  const snapshot = await firestore
    .collection(SCHEDULES_COLLECTION)
    .where("recipientId", "==", recipientId)
    .get();
  return snapshot.docs.map((document) => document.data() as MedicationReminderSchedule);
}

export async function registerPushSubscription(input: {
  userId: string;
  recipientId: string;
  deviceId: string;
  platform: PushSubscriptionRecord["platform"];
  browser: PushSubscriptionRecord["browser"];
  userAgent: string;
  timeZone: string;
  subscription: BrowserPushSubscription;
  medications: MedicationPlan[];
  now?: Date;
  firestore?: FirestoreLike;
}) {
  const firestore = input.firestore ?? (await getAdminFirestore());
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const id = stableId(input.userId, input.deviceId);
  const ref = subscriptionRef(firestore, id);
  const record = await firestore.runTransaction(async (tx) => {
    const [existing, sameDevice] = await Promise.all([
      tx.get(ref), tx.get(firestore.collection(SUBSCRIPTIONS_COLLECTION).where("deviceId", "==", input.deviceId)),
    ]);
    const current = existing.data() as PushSubscriptionRecord | undefined;
    for (const doc of sameDevice.docs) {
      if (doc.id !== id && (doc.data() as PushSubscriptionRecord).active) tx.set(doc.ref, { active: false, updatedAt: nowIso }, { merge: true });
    }
    if (current?.active && current.recipientId === input.recipientId && stableJson(current.subscription) === stableJson(input.subscription)) {
      if (now.getTime() - Date.parse(current.lastSeenAt) >= 6 * 60 * 60 * 1000) tx.set(ref, { lastSeenAt: nowIso }, { merge: true });
      return current;
    }
    const next: PushSubscriptionRecord = {
      id, userId: input.userId, recipientId: input.recipientId, deviceId: input.deviceId,
      platform: input.platform, browser: input.browser, userAgent: input.userAgent.slice(0, 512),
      timeZone: input.timeZone, subscription: input.subscription, active: true,
      createdAt: current?.createdAt ?? nowIso, updatedAt: nowIso, lastSeenAt: nowIso,
    };
    tx.set(ref, next);
    return next;
  });

  const schedules = await syncMedicationReminderSchedules({
    recipientId: input.recipientId,
    medications: input.medications,
    now,
    firestore,
  });
  return { record, schedules };
}

async function deactivateSchedulesIfUnused(
  firestore: FirestoreLike,
  recipientId: string,
  now: Date,
) {
  await syncMedicationReminderSchedules({ recipientId, now, firestore });
}

export async function deactivatePushSubscription(input: {
  userId: string;
  deviceId: string;
  now?: Date;
  firestore?: FirestoreLike;
}) {
  const firestore = input.firestore ?? await getAdminFirestore();
  const now = input.now ?? new Date();
  const id = stableId(input.userId, input.deviceId);
  const ref = subscriptionRef(firestore, id);
  const existing = await ref.get();
  if (!existing.exists) return false;
  const record = existing.data() as PushSubscriptionRecord;
  await ref.set({ active: false, updatedAt: now.toISOString() }, { merge: true });
  await deactivateSchedulesIfUnused(firestore, record.recipientId, now);
  return true;
}

export async function getNotificationScheduleStatus(
  recipientId: string,
): Promise<NotificationScheduleStatus> {
  const firestore = await getAdminFirestore();
  const [subscriptions, schedules] = await Promise.all([
    activeSubscriptionsForRecipient(firestore, recipientId),
    schedulesForRecipient(firestore, recipientId),
  ]);
  const activeSchedules = schedules
    .filter((schedule) => schedule.status === "active")
    .sort((a, b) => a.nextDueAt.localeCompare(b.nextDueAt));
  return {
    activeSubscriptionCount: subscriptions.length,
    activeScheduleCount: activeSchedules.length,
    nextReminderAt: activeSchedules[0]?.nextDueAt ?? null,
  };
}

async function updateSubscriptionAfterDelivery(
  firestore: FirestoreLike,
  subscription: PushSubscriptionRecord,
  result: WebPushDeliveryResult,
  now: Date,
) {
  await firestore.runTransaction(async (tx) => {
    const ref = subscriptionRef(firestore, subscription.id);
    const current = (await tx.get(ref)).data() as PushSubscriptionRecord | undefined;
    // A deleted or replaced subscription must not be recreated or disabled by an old send result.
    if (!current || stableJson(current.subscription) !== stableJson(subscription.subscription)) return;
    tx.set(ref,
    result.ok
      ? {
          lastDeliveryAt: now.toISOString(),
          lastHttpStatus: result.status,
          updatedAt: now.toISOString(),
        }
      : {
          ...(result.expired ? { active: false } : {}),
          lastFailureAt: now.toISOString(),
          lastHttpStatus: result.status,
          updatedAt: now.toISOString(),
        },
    { merge: true },
    );
  });
}

export async function sendTestPushToDevice(input: {
  userId: string;
  recipientId: string;
  deviceId: string;
  vapid: VapidConfiguration;
  now?: Date;
}) {
  const firestore = await getAdminFirestore();
  const id = stableId(input.userId, input.deviceId);
  const snapshot = await subscriptionRef(firestore, id).get();
  if (!snapshot.exists) return null;
  const subscription = snapshot.data() as PushSubscriptionRecord;
  if (!subscription.active) return null;
  const now = input.now ?? new Date();
  const deliveryId = stableId("test", input.userId, input.deviceId, now.toISOString());
  const deliveryRef = firestore.collection(DELIVERIES_COLLECTION).doc(deliveryId);
  await deliveryRef.set({
    id: deliveryId,
    recipientId: input.recipientId,
    subscriptionId: subscription.id,
    type: "test",
    status: "sending",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  const result = await sendWebPush(
    subscription.subscription,
    {
      title: "IPILLGOOD 알림 확인",
      body: "이 기기에서 복약 알림을 받을 준비가 되었어요.",
      icon: "/icons/pwa-192.png",
      badge: "/icons/pwa-192.png",
      tag: "ipillgood-test",
      lang: "ko-KR",
      timestamp: now.getTime(),
      data: {
        url: `/today?notification=test&delivery=${encodeURIComponent(deliveryId)}`,
        type: "test",
        deliveryId,
      },
    },
    {
      vapid: input.vapid,
      ttlSeconds: 300,
      urgency: "normal",
      topic: "ipillgood-test",
    },
  );
  await updateSubscriptionAfterDelivery(firestore, subscription, result, now);
  await deliveryRef.set(
    {
      status: result.ok ? "accepted" : result.expired ? "expired" : "failed",
      pushServiceStatus: result.status,
      updatedAt: now.toISOString(),
    },
    { merge: true },
  );
  return { result, deliveryId };
}

export async function recordPushDeliveryReceipt(input: {
  recipientId: string;
  deliveryId: string;
  receipt: "displayed" | "clicked";
  now?: Date;
  firestore?: FirestoreLike;
}) {
  const firestore = input.firestore ?? (await getAdminFirestore());
  const ref = firestore.collection(DELIVERIES_COLLECTION).doc(input.deliveryId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return false;
  const delivery = snapshot.data() as { recipientId?: string };
  if (delivery.recipientId !== input.recipientId) return false;
  const nowIso = (input.now ?? new Date()).toISOString();
  await ref.set(
    input.receipt === "displayed"
      ? { displayedAt: nowIso, updatedAt: nowIso }
      : { clickedAt: nowIso, updatedAt: nowIso },
    { merge: true },
  );
  return true;
}

export async function getPushDeliveryReceipt(
  recipientId: string,
  deliveryId: string,
  firestore?: FirestoreLike,
): Promise<PushDeliveryReceipt | null> {
  firestore ??= await getAdminFirestore();
  const snapshot = await firestore.collection(DELIVERIES_COLLECTION).doc(deliveryId).get();
  if (!snapshot.exists) return null;
  const delivery = snapshot.data() as {
    recipientId?: string;
    status?: string;
    displayedAt?: string;
    clickedAt?: string;
  };
  if (delivery.recipientId !== recipientId) return null;
  return {
    status: delivery.status ?? "unknown",
    displayedAt: delivery.displayedAt ?? null,
    clickedAt: delivery.clickedAt ?? null,
  };
}

type DeviceResult = { status: "accepted" | "terminal" | "retryable"; httpStatus: number; retryAfterMs?: number };
type Delivery = {
  id: string; status: "sending" | "retryable" | "accepted" | "terminal";
  owner: string; leaseUntil: string; attempts: number; nextAttemptAt?: string;
  results?: Record<string, DeviceResult>;
};

async function claimDelivery(firestore: FirestoreLike, schedule: MedicationReminderSchedule, now: Date) {
  const id = stableId(schedule.id, schedule.planRevisionId ?? "legacy", schedule.nextDueAt);
  const ref = firestore.collection(DELIVERIES_COLLECTION).doc(id);
  const owner = randomUUID();
  return firestore.runTransaction(async (tx) => {
    const [stored, delivery, plan] = await Promise.all([
      tx.get(scheduleRef(firestore, schedule.id)), tx.get(ref),
      tx.get(firestore.collection("careRecipients").doc(schedule.recipientId).collection("medicationPlans").doc(schedule.medicationPlanId)),
    ]);
    const currentSchedule = stored.data() as MedicationReminderSchedule | undefined;
    const current = delivery.data() as Delivery | undefined;
    if (currentSchedule?.status !== "active" || currentSchedule.nextDueAt !== schedule.nextDueAt || currentSchedule.planRevisionId !== schedule.planRevisionId) return null;
    const medication = plan.data() as MedicationPlan | undefined;
    if (!medication || medication.status !== "active" || (schedule.planRevisionId && medicationPlanRevision(medication) !== schedule.planRevisionId)) {
      tx.set(stored.ref, { status: "ended", updatedAt: now.toISOString() }, { merge: true });
      return null;
    }
    if (current?.status === "accepted" || current?.status === "terminal") {
      tx.set(stored.ref, advanceMedicationReminderSchedule(currentSchedule, now));
      return null;
    }
    if (current?.status === "sending" && Date.parse(current.leaseUntil) > now.getTime()) return null;
    if (current?.status === "retryable" && Date.parse(current.nextAttemptAt ?? "") > now.getTime()) return null;
    const stale = now.getTime() - Date.parse(schedule.nextDueAt) > 30 * 60 * 1000;
    const next: Delivery = { id, status: stale ? "terminal" : "sending", owner,
      leaseUntil: new Date(now.getTime() + 120_000).toISOString(), attempts: (current?.attempts ?? 0) + 1,
      results: current?.results ?? {},
    };
    tx.set(ref, { ...next, scheduleId: schedule.id, recipientId: schedule.recipientId, scheduledAt: schedule.nextDueAt,
      planRevisionId: schedule.planRevisionId ?? "legacy", updatedAt: now.toISOString(),
      ...(stale ? { reason: "stale" } : {}),
    }, { merge: true });
    if (stale) tx.set(stored.ref, advanceMedicationReminderSchedule(currentSchedule, now));
    return { ...next, ref, stale };
  });
}

function reminderPayload(
  schedule: MedicationReminderSchedule,
  deliveryId: string,
  now: Date,
): WebPushNotificationPayload {
  return {
    title: "복약 시간을 확인해 주세요",
    body: `${schedule.slotLabel || "예정된 복약"} 일정을 확인하고 복용 여부를 기록해 주세요.`,
    icon: "/icons/pwa-192.png",
    badge: "/icons/pwa-192.png",
    tag: `medication-${schedule.id}`,
    lang: "ko-KR",
    timestamp: now.getTime(),
    data: {
      url: `/today?reminder=${encodeURIComponent(deliveryId)}`,
      type: "medication-reminder",
      deliveryId,
    },
  };
}

export async function dispatchDueMedicationReminders(input: {
  vapid: VapidConfiguration; now?: Date; limit?: number; firestore?: FirestoreLike; sender?: typeof sendWebPush;
}) {
  const firestore = input.firestore ?? await getAdminFirestore();
  const sender = input.sender ?? sendWebPush;
  const now = input.now ?? new Date();
  const started = Date.now();
  const claimLimit = Math.max(1, Math.min(input.limit ?? 100, 300));
  const summary: DispatchSummary = { checked: 0, claimed: 0, delivered: 0, failed: 0, expiredSubscriptions: 0, noSubscriptions: 0, stale: 0 };
  for await (const document of dueReminderPages(firestore, now)) {
    if (summary.claimed >= claimLimit) break;
    summary.checked++;
    const schedule = document.data() as MedicationReminderSchedule;
    try {
      const subscriptions = await activeSubscriptionsForRecipient(firestore, schedule.recipientId);
      if (!subscriptions.length) {
        summary.noSubscriptions++;
        await deactivateSchedulesIfUnused(firestore, schedule.recipientId, now);
        continue;
      }
      const claim = await claimDelivery(firestore, schedule, now);
      if (!claim) continue;
      summary.claimed++;
      if (claim.stale) { summary.stale++; continue; }
      for (const subscription of subscriptions) {
        const sendNow = new Date(now.getTime() + Date.now() - started);
        const prior = claim.results?.[subscription.id];
        if (prior?.status === "accepted" || prior?.status === "terminal") continue;
        // Recheck authorization and renew ownership immediately before each external send.
        const allowed = await firestore.runTransaction(async (tx) => {
          const [deliveryDoc, subscriptionDoc, scheduleDoc, planDoc] = await Promise.all([
            tx.get(claim.ref), tx.get(subscriptionRef(firestore, subscription.id)), tx.get(scheduleRef(firestore, schedule.id)),
            tx.get(firestore.collection("careRecipients").doc(schedule.recipientId).collection("medicationPlans").doc(schedule.medicationPlanId)),
          ]);
          const delivery = deliveryDoc.data() as Delivery | undefined;
          const fresh = scheduleDoc.data() as MedicationReminderSchedule | undefined;
          const plan = planDoc.data() as MedicationPlan | undefined;
          const sub = subscriptionDoc.data() as PushSubscriptionRecord | undefined;
          if (delivery?.owner !== claim.owner) throw new Error("DELIVERY_LEASE_LOST");
          if (!sub?.active || sub.recipientId !== schedule.recipientId || fresh?.status !== "active" || fresh.nextDueAt !== schedule.nextDueAt || fresh.planRevisionId !== schedule.planRevisionId || !plan || plan.status !== "active" || (schedule.planRevisionId && medicationPlanRevision(plan) !== schedule.planRevisionId)) return false;
          if (sendNow.getTime() >= Date.parse(schedule.nextDueAt) + 30 * 60_000) return false;
          tx.set(claim.ref, { leaseUntil: new Date(sendNow.getTime() + 120_000).toISOString() }, { merge: true });
          return sub;
        });
        let result: WebPushDeliveryResult;
        if (!allowed) {
          result = { ok: false, status: 0, expired: false, responseBody: "" };
        } else {
          try {
            result = await sender(allowed.subscription, reminderPayload(schedule, claim.id, now), {
              vapid: input.vapid, ttlSeconds: Math.max(1, Math.ceil((Date.parse(schedule.nextDueAt) + 30 * 60 * 1000 - sendNow.getTime()) / 1000)),
              urgency: "high", topic: stableId(schedule.id).slice(0, 32),
            });
          } catch {
            result = { ok: false, status: 0, expired: false, responseBody: "" };
          }
        }
        const state: DeviceResult = {
          status: !allowed ? "terminal" : result.ok ? "accepted" : result.status === 0 || result.status === 429 || result.status >= 500 ? "retryable" : "terminal",
          httpStatus: result.status,
          ...(result.retryAfterMs !== undefined ? { retryAfterMs: result.retryAfterMs } : {}),
        };
        await firestore.runTransaction(async (tx) => {
          const delivery = (await tx.get(claim.ref)).data() as Delivery | undefined;
          if (delivery?.owner !== claim.owner) throw new Error("DELIVERY_LEASE_LOST");
          tx.set(claim.ref, { results: { [subscription.id]: state }, updatedAt: now.toISOString() }, { merge: true });
        });
        if (allowed) {
          await updateSubscriptionAfterDelivery(firestore, allowed, result, now);
          if (result.ok) summary.delivered++; else summary.failed++;
          if (result.expired) summary.expiredSubscriptions++;
        }
      }
      await firestore.runTransaction(async (tx) => {
        const [deliveryDoc, scheduleDoc] = await Promise.all([tx.get(claim.ref), tx.get(scheduleRef(firestore, schedule.id))]);
        const delivery = deliveryDoc.data() as Delivery | undefined;
        if (delivery?.owner !== claim.owner) return;
        const current = scheduleDoc.data() as MedicationReminderSchedule | undefined;
        const results = Object.values(delivery.results ?? {});
        const retry = results.some((result) => result.status === "retryable") && delivery.attempts < 5;
        const delay = Math.max(30_000 * 2 ** (delivery.attempts - 1), ...results.map((result) => result.retryAfterMs ?? 0));
        const nextAttempt = now.getTime() + delay;
        const canRetry = retry && nextAttempt < Date.parse(schedule.nextDueAt) + 30 * 60 * 1000;
        tx.set(claim.ref, { status: canRetry ? "retryable" : results.some((result) => result.status === "accepted") ? "accepted" : "terminal",
          leaseUntil: now.toISOString(), ...(canRetry ? { nextAttemptAt: new Date(nextAttempt).toISOString() } : { reason: results.some((result) => result.status === "retryable") ? "retry_exhausted" : "finished" }), updatedAt: now.toISOString(),
        }, { merge: true });
        if (!canRetry && current?.status === "active" && current.nextDueAt === schedule.nextDueAt && current.planRevisionId === schedule.planRevisionId) {
          tx.set(scheduleDoc.ref, advanceMedicationReminderSchedule(current, now));
        }
      });
    } catch {
      summary.failed++;
      // Leave the lease reclaimable after expiry. Never advance an unrecorded outcome.
      console.error(JSON.stringify({ event: "push_dispatch_failed", code: "DELIVERY_PROCESSING_FAILED" }));
    }
  }
  return summary;
}

async function* dueReminderPages(firestore: FirestoreLike, now: Date) {
  let query = firestore.collection(SCHEDULES_COLLECTION)
    .where("status", "==", "active").where("nextDueAt", "<=", now.toISOString())
    .orderBy("nextDueAt", "asc").orderBy("id", "asc").limit(100);
  // Waiting leases/retries must not monopolize the first page. Bound each cron's read budget.
  for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
    const page = await query.get();
    for (const document of page.docs) yield document;
    if (page.docs.length < 100) return;
    const last = page.docs.at(-1)!.data() as MedicationReminderSchedule;
    query = query.startAfter(last.nextDueAt, last.id);
  }
}

export async function getPushDeviceStatus(input: { userId: string; recipientId: string; deviceId: string; firestore?: FirestoreLike }) {
  const firestore = input.firestore ?? await getAdminFirestore();
  const doc = await subscriptionRef(firestore, stableId(input.userId, input.deviceId)).get();
  const record = doc.data() as PushSubscriptionRecord | undefined;
  return Boolean(record?.active && record.recipientId === input.recipientId);
}
