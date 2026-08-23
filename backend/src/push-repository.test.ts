import assert from "node:assert/strict";
import test from "node:test";

import { buildMedicationReminderSchedules } from "./medication-schedule.ts";
import {
  dispatchDueMedicationReminders,
  getPushDeliveryReceipt,
  recordPushDeliveryReceipt,
  registerPushSubscription,
  syncMedicationReminderSchedules,
} from "./push-repository.ts";
import type { FirestoreLike, QueryOperator } from "./firestore-rest.ts";
import type { MedicationPlan } from "./types.ts";

class MemoryDocumentReference {
  readonly store: Map<string, unknown>;
  readonly path: string;

  constructor(
    store: Map<string, unknown>,
    path: string,
  ) {
    this.store = store;
    this.path = path;
  }

  get id() {
    return this.path.split("/").at(-1) ?? "";
  }

  collection(name: string) {
    return new MemoryCollection(this.store, `${this.path}/${name}`);
  }

  async get() {
    const value = this.store.get(this.path);
    return {
      exists: value !== undefined,
      id: this.id,
      ref: this,
      data: () => value,
    };
  }

  async set(data: unknown, options?: { merge?: boolean }) {
    const current = this.store.get(this.path);
    this.store.set(
      this.path,
      options?.merge && current && typeof current === "object"
        ? { ...current, ...(data as object) }
        : data,
    );
  }
}

class MemoryQuery {
  protected readonly store: Map<string, unknown>;
  readonly path: string;
  private readonly filters: Array<[string, QueryOperator, unknown]>;
  private readonly ordering?: [string, "asc" | "desc"];
  private readonly resultLimit?: number;

  constructor(
    store: Map<string, unknown>,
    path: string,
    filters: Array<[string, QueryOperator, unknown]> = [],
    ordering?: [string, "asc" | "desc"],
    resultLimit?: number,
  ) {
    this.store = store;
    this.path = path;
    this.filters = filters;
    this.ordering = ordering;
    this.resultLimit = resultLimit;
  }

  where(field: string, operator: QueryOperator, value: unknown) {
    return new MemoryQuery(this.store, this.path, [...this.filters, [field, operator, value]], this.ordering, this.resultLimit);
  }

  orderBy(field: string, direction: "asc" | "desc" = "asc") {
    return new MemoryQuery(this.store, this.path, this.filters, [field, direction], this.resultLimit);
  }

  limit(count: number) {
    return new MemoryQuery(this.store, this.path, this.filters, this.ordering, count);
  }

  async get() {
    const prefix = `${this.path}/`;
    let entries = [...this.store.entries()].filter(
      ([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"),
    );
    entries = entries.filter(([, value]) =>
      this.filters.every(([field, operator, expected]) => {
        const actual = (value as Record<string, unknown>)[field];
        if (operator === "==") return actual === expected;
        if (operator === "<=") return String(actual) <= String(expected);
        if (operator === "<") return String(actual) < String(expected);
        if (operator === ">=") return String(actual) >= String(expected);
        return String(actual) > String(expected);
      }),
    );
    if (this.ordering) {
      const [field, direction] = this.ordering;
      entries.sort(([, left], [, right]) => {
        const compared = String((left as Record<string, unknown>)[field]).localeCompare(
          String((right as Record<string, unknown>)[field]),
        );
        return direction === "desc" ? -compared : compared;
      });
    }
    if (this.resultLimit) entries = entries.slice(0, this.resultLimit);
    return {
      docs: entries.map(([path, value]) => {
        const ref = new MemoryDocumentReference(this.store, path);
        return { exists: true, id: ref.id, ref, data: () => value };
      }),
    };
  }
}

class MemoryCollection extends MemoryQuery {
  doc(id: string) {
    return new MemoryDocumentReference(this.store, `${this.path}/${id}`);
  }
}

class MemoryFirestore implements FirestoreLike {
  readonly store = new Map<string, unknown>();

  collection(path: string) {
    return new MemoryCollection(this.store, path);
  }

  batch() {
    const operations: Array<() => Promise<void>> = [];
    const store = this.store;
    const batch = {
      set(ref: MemoryDocumentReference, data: unknown, options?: { merge?: boolean }) {
        operations.push(() => ref.set(data, options));
        return batch;
      },
      create(ref: MemoryDocumentReference, data: unknown) {
        operations.push(async () => {
          if (store.has(ref.path)) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
          await ref.set(data);
        });
        return batch;
      },
      delete(ref: MemoryDocumentReference) {
        operations.push(async () => {
          store.delete(ref.path);
        });
        return batch;
      },
      async commit() {
        for (const operation of operations) await operation();
      },
    };
    return batch;
  }
}

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

test("도래한 복약 일정을 한 번 발송하고 다음 복약일로 전진한다", async () => {
  const firestore = new MemoryFirestore();
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
  assert.equal(sentTtl, 30 * 60);
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
  const initialSchedules = await syncMedicationReminderSchedules({
    firestore,
    recipientId: "new-recipient-2",
    medications: [medication],
    now: registeredAt,
  });
  assert.equal(initialSchedules.length, 1);

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
