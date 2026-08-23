import { createHash } from "node:crypto";

import { getAdminFirestore } from "./firebase-admin.ts";
import type { FirestoreLike } from "./firestore-rest.ts";
import {
  advanceMedicationReminderSchedule,
  buildMedicationReminderSchedules,
  type MedicationReminderSchedule,
} from "./medication-schedule.ts";
import type { MedicationPlan } from "./types.ts";
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

function isAlreadyExistsError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: number | string; status?: number; message?: string };
  return (
    value.code === 6 ||
    value.code === "already-exists" ||
    value.status === 409 ||
    value.message?.includes("HTTP 409") === true ||
    value.message?.includes("ALREADY_EXISTS") === true
  );
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

export async function syncMedicationReminderSchedules(input: {
  recipientId: string;
  medications: MedicationPlan[];
  now?: Date;
  firestore?: FirestoreLike;
}) {
  const firestore = input.firestore ?? (await getAdminFirestore());
  const now = input.now ?? new Date();
  const nextSchedules = buildMedicationReminderSchedules(
    input.recipientId,
    input.medications,
    now,
  );
  const existing = await schedulesForRecipient(firestore, input.recipientId);
  const existingById = new Map(existing.map((schedule) => [schedule.id, schedule]));
  const normalizedSchedules = nextSchedules.map((schedule) => {
    const current = existingById.get(schedule.id);
    const graceStart = now.getTime() - 30 * 60 * 1_000;
    if (
      current?.status === "active" &&
      new Date(current.nextDueAt).getTime() >= graceStart &&
      current.nextDueAt < schedule.nextDueAt
    ) {
      return { ...schedule, nextDueAt: current.nextDueAt };
    }
    return schedule;
  });
  const nextIds = new Set(normalizedSchedules.map((schedule) => schedule.id));
  const batch = firestore.batch();

  for (const schedule of normalizedSchedules) {
    batch.set(scheduleRef(firestore, schedule.id), schedule);
  }
  for (const schedule of existing) {
    if (nextIds.has(schedule.id) || schedule.status === "ended") continue;
    batch.set(
      scheduleRef(firestore, schedule.id),
      { status: "ended", updatedAt: now.toISOString() },
      { merge: true },
    );
  }
  await batch.commit();
  return normalizedSchedules;
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
  const existing = await ref.get();
  const existingRecord = existing.exists
    ? (existing.data() as PushSubscriptionRecord)
    : undefined;
  const sameDevice = await firestore
    .collection(SUBSCRIPTIONS_COLLECTION)
    .where("deviceId", "==", input.deviceId)
    .get();
  const batch = firestore.batch();

  for (const document of sameDevice.docs) {
    const record = document.data() as PushSubscriptionRecord;
    if (document.id === id || !record.active) continue;
    batch.set(
      document.ref,
      { active: false, updatedAt: nowIso },
      { merge: true },
    );
  }

  const record: PushSubscriptionRecord = {
    id,
    userId: input.userId,
    recipientId: input.recipientId,
    deviceId: input.deviceId,
    platform: input.platform,
    browser: input.browser,
    userAgent: input.userAgent.slice(0, 512),
    timeZone: input.timeZone,
    subscription: input.subscription,
    active: true,
    createdAt: existingRecord?.createdAt ?? nowIso,
    updatedAt: nowIso,
    lastSeenAt: nowIso,
    lastDeliveryAt: existingRecord?.lastDeliveryAt,
    lastFailureAt: existingRecord?.lastFailureAt,
    lastHttpStatus: existingRecord?.lastHttpStatus,
  };
  batch.set(ref, record);
  await batch.commit();

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
  if ((await activeSubscriptionsForRecipient(firestore, recipientId)).length) return;
  const schedules = await schedulesForRecipient(firestore, recipientId);
  const batch = firestore.batch();
  for (const schedule of schedules) {
    if (schedule.status === "ended") continue;
    batch.set(
      scheduleRef(firestore, schedule.id),
      { status: "ended", updatedAt: now.toISOString() },
      { merge: true },
    );
  }
  await batch.commit();
}

export async function deactivatePushSubscription(input: {
  userId: string;
  deviceId: string;
  now?: Date;
}) {
  const firestore = await getAdminFirestore();
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
  await subscriptionRef(firestore, subscription.id).set(
    result.ok
      ? {
          lastDeliveryAt: now.toISOString(),
          lastHttpStatus: result.status,
          updatedAt: now.toISOString(),
        }
      : {
          active: result.expired ? false : subscription.active,
          lastFailureAt: now.toISOString(),
          lastHttpStatus: result.status,
          updatedAt: now.toISOString(),
        },
    { merge: true },
  );
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

async function claimDelivery(
  firestore: FirestoreLike,
  schedule: MedicationReminderSchedule,
  now: Date,
) {
  const id = stableId(schedule.id, schedule.nextDueAt);
  const ref = firestore.collection(DELIVERIES_COLLECTION).doc(id);
  const batch = firestore.batch();
  batch.create(ref, {
    id,
    scheduleId: schedule.id,
    recipientId: schedule.recipientId,
    scheduledAt: schedule.nextDueAt,
    status: "sending",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  try {
    await batch.commit();
    return { id, ref, claimed: true as const };
  } catch (error) {
    if (isAlreadyExistsError(error)) return { id, ref, claimed: false as const };
    throw error;
  }
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
  vapid: VapidConfiguration;
  now?: Date;
  limit?: number;
  firestore?: FirestoreLike;
  sender?: typeof sendWebPush;
}) {
  const firestore = input.firestore ?? (await getAdminFirestore());
  const sender = input.sender ?? sendWebPush;
  const now = input.now ?? new Date();
  const due = await firestore
    .collection(SCHEDULES_COLLECTION)
    .where("nextDueAt", "<=", now.toISOString())
    .orderBy("nextDueAt", "asc")
    .limit(input.limit ?? 100)
    .get();
  const schedules = due.docs
    .map((document) => document.data() as MedicationReminderSchedule)
    .filter((schedule) => schedule.status === "active");
  const summary: DispatchSummary = {
    checked: schedules.length,
    claimed: 0,
    delivered: 0,
    failed: 0,
    expiredSubscriptions: 0,
    noSubscriptions: 0,
    stale: 0,
  };

  for (const schedule of schedules) {
    const claim = await claimDelivery(firestore, schedule, now);
    if (!claim.claimed) {
      await scheduleRef(firestore, schedule.id).set(
        advanceMedicationReminderSchedule(schedule, now),
      );
      continue;
    }
    summary.claimed += 1;
    if (now.getTime() - new Date(schedule.nextDueAt).getTime() > 30 * 60 * 1_000) {
      summary.stale += 1;
      await claim.ref.set(
        { status: "stale", updatedAt: now.toISOString() },
        { merge: true },
      );
      await scheduleRef(firestore, schedule.id).set(
        advanceMedicationReminderSchedule(schedule, now),
      );
      continue;
    }
    const subscriptions = await activeSubscriptionsForRecipient(
      firestore,
      schedule.recipientId,
    );
    if (!subscriptions.length) summary.noSubscriptions += 1;
    const results: Array<{
      subscriptionId: string;
      ok: boolean;
      status: number;
      expired: boolean;
    }> = [];

    for (const subscription of subscriptions) {
      try {
        const result = await sender(
          subscription.subscription,
          reminderPayload(schedule, claim.id, now),
          {
            vapid: input.vapid,
            ttlSeconds: 30 * 60,
            urgency: "high",
            topic: stableId(schedule.id).slice(0, 32),
          },
        );
        await updateSubscriptionAfterDelivery(firestore, subscription, result, now);
        results.push({
          subscriptionId: subscription.id,
          ok: result.ok,
          status: result.status,
          expired: result.expired,
        });
        if (result.ok) summary.delivered += 1;
        else summary.failed += 1;
        if (result.expired) summary.expiredSubscriptions += 1;
      } catch (error) {
        summary.failed += 1;
        results.push({
          subscriptionId: subscription.id,
          ok: false,
          status: 0,
          expired: false,
        });
        await subscriptionRef(firestore, subscription.id).set(
          {
            lastFailureAt: now.toISOString(),
            lastHttpStatus: 0,
            updatedAt: now.toISOString(),
          },
          { merge: true },
        );
        console.error("Web Push delivery failed", error);
      }
    }

    await claim.ref.set(
      {
        status:
          results.length === 0
            ? "no_subscriptions"
            : results.some((result) => result.ok)
              ? "accepted"
              : "failed",
        results,
        updatedAt: now.toISOString(),
      },
      { merge: true },
    );
    await scheduleRef(firestore, schedule.id).set(
      advanceMedicationReminderSchedule(schedule, now),
    );
  }

  return summary;
}
