import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";

import { buildMedicationReminderSchedules } from "./medication-schedule.ts";
import {
  dispatchDueMedicationReminders,
  getPushDeliveryReceipt,
  recordPushDeliveryReceipt,
  registerPushSubscription,
  syncMedicationReminderSchedules,
} from "./push-repository.ts";
import { MemoryFirestore } from "../test-support/memory-firestore.ts";
import { medicationPlanRevision, reconcileMedicationReminders, retryMedicationReminderSync } from "./reminder-reconciliation.ts";
import { createInitialCareSnapshot } from "./care-repository.ts";
import type { MedicationPlan } from "./types.ts";

const medication: MedicationPlan = {
  id: "med-reminder",
  productName: "테스트정",
  ingredientName: "테스트",
  categoryPlain: "테스트",
  purposePlain: "테스트",
  descriptionPlain: "테스트",
  doseAmount: "1정",
  frequency: "하루 1회",
  timing: "아침 식사 후",
  startDate: "2026-08-20",
  status: "active",
  isNew: false,
  sourceLabel: "테스트",
  watchFor: [],
};

async function seedPlans(firestore: MemoryFirestore, recipientId: string, medications: MedicationPlan[]) {
  const model = createInitialCareSnapshot({ recipientId });
  await firestore.collection("careRecipients").doc(recipientId).set(model.recipient);
  await firestore.collection("careReadModels").doc(recipientId).set({ ...model, medications, revision: 0 });
  for (const medication of medications) await firestore.collection(`careRecipients/${recipientId}/medicationPlans`).doc(medication.id).set(medication);
}

test("도래한 복약 일정을 한 번 발송하고 다음 복약일로 전진한다", async () => {
  const firestore = new MemoryFirestore();
  await seedPlans(firestore, "recipient-1", [medication]);
  const now = new Date("2026-08-23T23:00:30.000Z");
  const [schedule] = buildMedicationReminderSchedules(
    "recipient-1",
    [medication],
    new Date("2026-08-23T22:00:00.000Z"),
  );
  await firestore.collection("medicationReminderSchedules").doc(schedule!.id).set(schedule);
  await firestore.collection("pushSubscriptions").doc("subscription-1").set({
    id: "subscription-1",
    recipientId: "recipient-1",
    active: true,
    subscription: {
      endpoint: "https://fcm.googleapis.com/fcm/send/test",
      keys: { p256dh: "test", auth: "test" },
    },
  });
  let sends = 0;
  const sender = async () => {
    sends += 1;
    return { ok: true, status: 201, expired: false, responseBody: "" };
  };

  const first = await dispatchDueMedicationReminders({
    firestore,
    sender,
    now,
    vapid: { publicKey: "test", privateKey: "test", subject: "mailto:test@example.com" },
  });
  const second = await dispatchDueMedicationReminders({
    firestore,
    sender,
    now,
    vapid: { publicKey: "test", privateKey: "test", subject: "mailto:test@example.com" },
  });
  const stored = await firestore.collection("medicationReminderSchedules").doc(schedule!.id).get();

  assert.equal(first.delivered, 1);
  assert.equal(first.claimed, 1);
  assert.equal(second.checked, 0);
  assert.equal(sends, 1);
  assert.equal((stored.data() as { nextDueAt: string }).nextDueAt, "2026-08-24T23:00:00.000Z");
});

test("30분보다 오래 지난 복약 알림은 뒤늦게 보내지 않고 다음 일정으로 넘긴다", async () => {
  const firestore = new MemoryFirestore();
  await seedPlans(firestore, "recipient-1", [medication]);
  const now = new Date("2026-08-24T01:00:01.000Z");
  const [schedule] = buildMedicationReminderSchedules(
    "recipient-1",
    [medication],
    new Date("2026-08-23T22:00:00.000Z"),
  );
  await firestore.collection("medicationReminderSchedules").doc(schedule!.id).set(schedule);
  await firestore.collection("pushSubscriptions").doc("subscription-1").set({
    id: "subscription-1",
    recipientId: "recipient-1",
    active: true,
    subscription: {
      endpoint: "https://fcm.googleapis.com/fcm/send/test",
      keys: { p256dh: "test", auth: "test" },
    },
  });
  let sends = 0;

  const result = await dispatchDueMedicationReminders({
    firestore,
    sender: async () => {
      sends += 1;
      return { ok: true, status: 201, expired: false, responseBody: "" };
    },
    now,
    vapid: { publicKey: "test", privateKey: "test", subject: "mailto:test@example.com" },
  });
  const stored = await firestore.collection("medicationReminderSchedules").doc(schedule!.id).get();

  assert.equal(result.stale, 1);
  assert.equal(result.delivered, 0);
  assert.equal(sends, 0);
  assert.equal((stored.data() as { nextDueAt: string }).nextDueAt, "2026-08-24T23:00:00.000Z");
});

test("신규 사용자가 알림을 먼저 허용한 뒤 복약 계획을 등록하면 자동 예약되고 한 번만 발송된다", async () => {
  const firestore = new MemoryFirestore();
  const registeredAt = new Date("2026-08-23T22:00:00.000Z");
  await seedPlans(firestore, "new-recipient-1", []);
  const registration = await registerPushSubscription({
    firestore,
    userId: "new-user-1",
    recipientId: "new-recipient-1",
    deviceId: "new-device-00000001",
    platform: "android",
    browser: "chrome",
    userAgent: "Chrome test",
    timeZone: "Asia/Seoul",
    subscription: {
      endpoint: "https://fcm.googleapis.com/fcm/send/new-user",
      keys: { p256dh: "test-p256dh", auth: "test-auth" },
    },
    medications: [],
    now: registeredAt,
  });
  assert.equal(registration.schedules.length, 0);

  await seedPlans(firestore, "new-recipient-1", [medication]);
  const schedules = await syncMedicationReminderSchedules({
    firestore,
    recipientId: "new-recipient-1",
    medications: [medication],
    now: registeredAt,
  });
  assert.equal(schedules.length, 1);
  assert.equal(schedules[0]?.nextDueAt, "2026-08-23T23:00:00.000Z");

  let sentPayload: Record<string, unknown> | undefined;
  let sentTtl = 0;
  const dispatchAt = new Date("2026-08-23T23:00:10.000Z");
  const first = await dispatchDueMedicationReminders({
    firestore,
    now: dispatchAt,
    vapid: { publicKey: "test", privateKey: "test", subject: "mailto:test@example.com" },
    sender: async (_subscription, payload, options) => {
      sentPayload = payload as unknown as Record<string, unknown>;
      sentTtl = options.ttlSeconds;
      return { ok: true, status: 201, expired: false, responseBody: "" };
    },
  });
  const second = await dispatchDueMedicationReminders({
    firestore,
    now: dispatchAt,
    vapid: { publicKey: "test", privateKey: "test", subject: "mailto:test@example.com" },
    sender: async () => {
      throw new Error("같은 복약 회차가 중복 발송됐습니다.");
    },
  });

  const payloadData = sentPayload?.data as { deliveryId?: string } | undefined;
  assert.equal(first.delivered, 1);
  assert.equal(second.delivered, 0);
  assert.equal(sentTtl, 30 * 60 - 10);
  assert.equal(sentPayload?.title, "복약 시간을 확인해 주세요");
  assert.equal(String(sentPayload?.body).includes(medication.productName), false);
  assert.match(payloadData?.deliveryId ?? "", /^[a-f0-9]{48}$/);

  const receiptRecorded = await recordPushDeliveryReceipt({
    firestore,
    recipientId: "new-recipient-1",
    deliveryId: payloadData!.deliveryId!,
    receipt: "displayed",
    now: new Date("2026-08-23T23:00:11.000Z"),
  });
  const receipt = await getPushDeliveryReceipt(
    "new-recipient-1",
    payloadData!.deliveryId!,
    firestore,
  );
  assert.equal(receiptRecorded, true);
  assert.equal(receipt?.status, "accepted");
  assert.equal(receipt?.displayedAt, "2026-08-23T23:00:11.000Z");
});

test("신규 사용자가 복약 계획을 먼저 등록하고 나중에 알림을 허용해도 예약이 중복되지 않는다", async () => {
  const firestore = new MemoryFirestore();
  const registeredAt = new Date("2026-08-23T22:00:00.000Z");
  await seedPlans(firestore, "new-recipient-2", [medication]);
  const initialSchedules = await syncMedicationReminderSchedules({
    firestore,
    recipientId: "new-recipient-2",
    medications: [medication],
    now: registeredAt,
  });
  assert.equal(initialSchedules.length, 0);

  await registerPushSubscription({
    firestore,
    userId: "new-user-2",
    recipientId: "new-recipient-2",
    deviceId: "new-device-00000002",
    platform: "ios",
    browser: "safari",
    userAgent: "Safari test",
    timeZone: "Asia/Seoul",
    subscription: {
      endpoint: "https://web.push.apple.com/QATEST",
      keys: { p256dh: "test-p256dh", auth: "test-auth" },
    },
    medications: [medication],
    now: registeredAt,
  });
  await registerPushSubscription({
    firestore,
    userId: "new-user-2",
    recipientId: "new-recipient-2",
    deviceId: "new-device-00000002",
    platform: "ios",
    browser: "safari",
    userAgent: "Safari test",
    timeZone: "Asia/Seoul",
    subscription: {
      endpoint: "https://web.push.apple.com/QATEST",
      keys: { p256dh: "test-p256dh", auth: "test-auth" },
    },
    medications: [medication],
    now: registeredAt,
  });

  const scheduleSnapshot = await firestore.collection("medicationReminderSchedules").get();
  const subscriptionSnapshot = await firestore.collection("pushSubscriptions").get();
  assert.equal(scheduleSnapshot.docs.length, 1);
  assert.equal(subscriptionSnapshot.docs.length, 1);
  assert.equal(
    (scheduleSnapshot.docs[0]?.data() as { nextDueAt: string }).nextDueAt,
    "2026-08-23T23:00:00.000Z",
  );
});

const vapid = { publicKey: "test", privateKey: "test", subject: "mailto:test@example.com" };
const accepted = { ok: true, status: 201, expired: false, responseBody: "" };
async function dueFixture() {
  const firestore = new MemoryFirestore();
  await seedPlans(firestore, "recipient-1", [medication]);
  const now = new Date("2026-08-23T23:00:10.000Z");
  const [schedule] = buildMedicationReminderSchedules("recipient-1", [medication], new Date("2026-08-23T22:00:00.000Z"));
  schedule!.planRevisionId = medicationPlanRevision(medication);
  await firestore.collection("medicationReminderSchedules").doc(schedule!.id).set(schedule);
  await firestore.collection("pushSubscriptions").doc("sub-a").set({ id: "sub-a", recipientId: "recipient-1", active: true, subscription: { endpoint: "https://push.invalid/a", keys: { auth: "a", p256dh: "a" } } });
  return { firestore, now, schedule: schedule! };
}

test("종료 일정 101건이 있어도 활성 일정은 limit 전에 선별되어 발송된다", async () => {
  const { firestore, now } = await dueFixture();
  for (let i = 0; i < 101; i++) await firestore.collection("medicationReminderSchedules").doc(`ended-${i}`).set({ status: "ended", nextDueAt: "2020-01-01T00:00:00.000Z" });
  const result = await dispatchDueMedicationReminders({ firestore, now, vapid, sender: async () => accepted, limit: 1 });
  assert.equal(result.checked, 1);
  assert.equal(result.delivered, 1);
});

test("처리 중인 lease가 첫 페이지를 채워도 다음 페이지의 알림을 보낸다", async () => {
  const { firestore, now, schedule } = await dueFixture();
  const batch = firestore.batch();
  for (let index = 0; index < 100; index++) {
    const waiting = { ...schedule, id: `waiting-${index}`, nextDueAt: "2026-08-23T22:59:59.000Z" };
    const deliveryId = createHash("sha256").update([waiting.id, waiting.planRevisionId, waiting.nextDueAt].join("\u0000")).digest("hex").slice(0, 48);
    batch.set(firestore.collection("medicationReminderSchedules").doc(waiting.id), waiting);
    batch.set(firestore.collection("pushDeliveries").doc(deliveryId), { status: "sending", owner: "other-worker", attempts: 1, leaseUntil: "2026-08-23T23:02:00.000Z" });
  }
  await batch.commit();
  const result = await dispatchDueMedicationReminders({ firestore, now, vapid, sender: async () => accepted, limit: 1 });
  assert.equal(result.checked, 101);
  assert.equal(result.delivered, 1);
});

test("동시 dispatch는 같은 회차를 한 번만 발송한다", async () => {
  const { firestore, now } = await dueFixture();
  let calls = 0;
  const sender = async () => { calls++; return accepted; };
  await Promise.all(Array.from({ length: 5 }, () => dispatchDueMedicationReminders({ firestore, now, vapid, sender })));
  assert.equal(calls, 1);
});

test("claim 직후 중단은 lease 만료 뒤 같은 회차에서 복구한다", async () => {
  const { firestore, now, schedule } = await dueFixture();
  firestore.beforeRead = async (path) => {
    if (path === "pushSubscriptions/sub-a") { firestore.beforeRead = undefined; throw new Error("CRASH_AFTER_CLAIM"); }
  };
  let calls = 0;
  const sender = async () => { calls++; return accepted; };
  const first = await dispatchDueMedicationReminders({ firestore, now, vapid, sender });
  assert.equal(first.failed, 1);
  assert.equal(calls, 0);
  assert.equal((firestore.store.get(`medicationReminderSchedules/${schedule.id}`) as { nextDueAt: string }).nextDueAt, schedule.nextDueAt);
  await dispatchDueMedicationReminders({ firestore, now: new Date(now.getTime() + 121_000), vapid, sender });
  assert.equal(calls, 1);
});

test("기기별 성공을 보존하고 429 Retry-After 뒤 실패 기기만 재시도한다", async () => {
  const { firestore, now } = await dueFixture();
  await firestore.collection("pushSubscriptions").doc("sub-b").set({ id: "sub-b", recipientId: "recipient-1", active: true, subscription: { endpoint: "https://push.invalid/b", keys: { auth: "b", p256dh: "b" } } });
  const counts = { a: 0, b: 0 };
  const sender = async (subscription: { endpoint: string }) => {
    const device = subscription.endpoint.endsWith("/a") ? "a" : "b";
    counts[device]++;
    return device === "b" && counts.b === 1 ? { ok: false, status: 429, expired: false, responseBody: "", retryAfterMs: 120_000 } : accepted;
  };
  await dispatchDueMedicationReminders({ firestore, now, vapid, sender });
  await dispatchDueMedicationReminders({ firestore, now: new Date(now.getTime() + 60_000), vapid, sender });
  assert.deepEqual(counts, { a: 1, b: 1 });
  await dispatchDueMedicationReminders({ firestore, now: new Date(now.getTime() + 121_000), vapid, sender });
  assert.deepEqual(counts, { a: 1, b: 2 });
});

test("일시 발송 실패의 메타데이터 갱신이 동시 opt-out을 되돌리지 않는다", async () => {
  const { firestore, now } = await dueFixture();
  await dispatchDueMedicationReminders({ firestore, now, vapid, sender: async () => {
    await firestore.collection("pushSubscriptions").doc("sub-a").set({ active: false }, { merge: true });
    return { ok: false, status: 503, expired: false, responseBody: "" };
  } });
  assert.equal((firestore.store.get("pushSubscriptions/sub-a") as { active: boolean }).active, false);
});

test("알림 미구독 사용자의 동기화와 빈 dispatch는 reminder write를 만들지 않는다", async () => {
  const firestore = new MemoryFirestore();
  await seedPlans(firestore, "no-push", [medication]);
  const writes = firestore.writes;
  await syncMedicationReminderSchedules({ firestore, recipientId: "no-push", medications: [medication] });
  await dispatchDueMedicationReminders({ firestore, vapid, sender: async () => { throw new Error("must not send"); } });
  assert.equal(firestore.writes, writes);
});

test("같은 계획 동기화는 쓰기를 반복하지 않고 오래된 입력으로 최신 계획을 복원하지 않는다", async () => {
  const { firestore, schedule } = await dueFixture();
  const beforeDue = new Date("2026-08-23T22:00:00.000Z");
  await syncMedicationReminderSchedules({ firestore, recipientId: "recipient-1", now: beforeDue });
  const writes = firestore.writes;
  await syncMedicationReminderSchedules({ firestore, recipientId: "recipient-1", now: beforeDue });
  assert.equal(firestore.writes, writes);
  await firestore.collection("careRecipients/recipient-1/medicationPlans").doc(medication.id).set({ ...medication, status: "stopped" });
  await syncMedicationReminderSchedules({ firestore, recipientId: "recipient-1", medications: [medication], now: beforeDue });
  assert.equal((firestore.store.get(`medicationReminderSchedules/${schedule.id}`) as { status: string }).status, "ended");
});

test("reconciliation은 누락된 일정을 canonical 계획으로 복구한다", async () => {
  const { firestore, schedule } = await dueFixture();
  firestore.store.delete(`medicationReminderSchedules/${schedule.id}`);
  const result = await reconcileMedicationReminders({ firestore, now: new Date("2026-08-23T22:00:00.000Z") });
  assert.equal(result.failed, 0);
  assert.equal(firestore.store.has(`medicationReminderSchedules/${schedule.id}`), true);
});

test("마지막 복약일의 도래한 회차를 reconciliation이 발송 전에 지우지 않는다", async () => {
  const { firestore, now, schedule } = await dueFixture();
  const finalPlan = { ...medication, endDate: "2026-08-24" };
  await firestore.collection("careRecipients/recipient-1/medicationPlans").doc(medication.id).set(finalPlan);
  await firestore.collection("medicationReminderSchedules").doc(schedule.id).set({ ...schedule, endDate: finalPlan.endDate, planRevisionId: medicationPlanRevision(finalPlan) });
  await reconcileMedicationReminders({ firestore, now });
  const result = await dispatchDueMedicationReminders({ firestore, now, vapid, sender: async () => accepted });
  assert.equal(result.delivered, 1);
  assert.equal((firestore.store.get(`medicationReminderSchedules/${schedule.id}`) as { status: string }).status, "ended");
});

test("Firestore 필드 순서가 달라도 같은 일정의 동기화는 쓰지 않는다", async () => {
  const { firestore, now, schedule } = await dueFixture();
  await syncMedicationReminderSchedules({ firestore, recipientId: "recipient-1", now });
  const path = `medicationReminderSchedules/${schedule.id}`;
  firestore.store.set(path, Object.fromEntries(Object.entries(firestore.store.get(path) as object).reverse()));
  const writes = firestore.writes;
  await syncMedicationReminderSchedules({ firestore, recipientId: "recipient-1", now });
  assert.equal(firestore.writes, writes);
});

test("동기화 장애는 backoff·격리 후 운영자 재시도로 복구한다", async () => {
  const { firestore, schedule } = await dueFixture();
  let now = new Date("2026-08-23T22:00:00.000Z");
  await syncMedicationReminderSchedules({ firestore, recipientId: "recipient-1", now });
  firestore.store.delete(`medicationReminderSchedules/${schedule.id}`);
  firestore.beforeRead = async (path) => { if (path.endsWith("/medicationPlans")) throw new Error("INJECTED_PLAN_READ_FAILURE"); };
  for (let attempt = 1; attempt <= 5; attempt++) {
    assert.equal((await reconcileMedicationReminders({ firestore, now })).failed, 1);
    now = new Date(now.getTime() + 60_000 * 2 ** (attempt - 1));
  }
  const ref = firestore.collection("medicationReminderSync").doc("recipient-1");
  assert.equal(((await ref.get()).data() as { status: string }).status, "quarantined");
  const quarantined = (await ref.get()).data() as { queuedAt: string; lastSucceededAt: string };
  assert.equal(quarantined.queuedAt, "2026-08-23T22:00:00.000Z");
  assert.equal(quarantined.lastSucceededAt, "2026-08-23T22:00:00.000Z");
  firestore.beforeRead = undefined;
  await retryMedicationReminderSync("recipient-1", firestore);
  await reconcileMedicationReminders({ firestore, now: new Date("2099-01-01T00:00:00Z") });
  assert.equal(((await ref.get()).data() as { status: string }).status, "completed");
});

test("5xx는 최대 5회 재시도하며 종료 결과를 다음 dispatch가 다시 보내지 않는다", async () => {
  const { firestore, now, schedule } = await dueFixture();
  let calls = 0;
  let at = now;
  const sender = async () => { calls++; return { ok: false, status: 503, expired: false, responseBody: "" }; };
  for (let attempt = 0; attempt < 5; attempt++) {
    await dispatchDueMedicationReminders({ firestore, now: at, vapid, sender });
    at = new Date(at.getTime() + 30_000 * 2 ** attempt + 1);
  }
  await dispatchDueMedicationReminders({ firestore, now: at, vapid, sender });
  assert.equal(calls, 5);
  assert.notEqual((firestore.store.get(`medicationReminderSchedules/${schedule.id}`) as { nextDueAt: string }).nextDueAt, schedule.nextDueAt);
});

test("발송 도중 삭제된 구독을 결과 저장이 재생성하지 않는다", async () => {
  const { firestore, now } = await dueFixture();
  await dispatchDueMedicationReminders({ firestore, now, vapid, sender: async () => {
    firestore.store.delete("pushSubscriptions/sub-a");
    return accepted;
  } });
  assert.equal(firestore.store.has("pushSubscriptions/sub-a"), false);
});

test("발송 도중 중단된 계획을 완료 처리가 다시 활성화하지 않는다", async () => {
  const { firestore, now, schedule } = await dueFixture();
  await dispatchDueMedicationReminders({ firestore, now, vapid, sender: async () => {
    await firestore.collection("careRecipients/recipient-1/medicationPlans").doc(medication.id).set({ ...medication, status: "stopped" });
    await syncMedicationReminderSchedules({ firestore, recipientId: "recipient-1", now });
    return accepted;
  } });
  assert.equal((firestore.store.get(`medicationReminderSchedules/${schedule.id}`) as { status: string }).status, "ended");
});
