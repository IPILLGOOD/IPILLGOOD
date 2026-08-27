import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { getPushDeviceHealth, getPushDeviceStatus, registerPushSubscription } from "./push-repository.ts";
import { MemoryFirestore } from "../test-support/memory-firestore.ts";

test("device health is scoped, read-only and does not expose endpoint or encryption keys", async () => {
  const firestore = new MemoryFirestore();
  const input = { userId: "user-a", recipientId: "recipient-a", deviceId: "test-device-000001", firestore };
  const id = createHash("sha256").update(`${input.userId}\u0000${input.deviceId}`).digest("hex").slice(0, 48);
  const endpoint = "https://fcm.googleapis.com/fcm/send/synthetic";
  const ref = firestore.collection("pushSubscriptions").doc(id);
  const record = { ...input, firestore: undefined, id, active: true, lastHttpStatus: 403, subscription: { endpoint, keys: { auth: "secret", p256dh: "secret" } } };
  await ref.set(record);
  const before = (await ref.get()).data();
  assert.deepEqual(await getPushDeviceHealth(input), { subscribed: true, endpointHash: createHash("sha256").update(endpoint).digest("hex"), lastHttpStatus: 403 });
  assert.equal(await getPushDeviceStatus(input), true);
  assert.deepEqual(await getPushDeviceHealth({ ...input, userId: "user-b" }), { subscribed: false, endpointHash: null, lastHttpStatus: null });
  assert.deepEqual(await getPushDeviceHealth({ ...input, recipientId: "recipient-b" }), { subscribed: false, endpointHash: null, lastHttpStatus: null });
  assert.deepEqual((await ref.get()).data(), before);
  await ref.set({ ...record, active: false });
  assert.deepEqual(await getPushDeviceHealth(input), { subscribed: false, endpointHash: null, lastHttpStatus: null });
});

test("automatic repair cannot create, revive or transfer an inactive account/device subscription", async () => {
  const firestore = new MemoryFirestore();
  const input = {
    userId: "user-a", recipientId: "recipient-a", deviceId: "test-device-000001", firestore,
    platform: "android" as const, browser: "chrome" as const, userAgent: "synthetic", timeZone: "Asia/Seoul",
    subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/new", keys: { auth: "test", p256dh: "test" } },
    medications: [], onlyIfActive: true,
  };
  assert.equal((await registerPushSubscription(input)).record, null);
  assert.equal(firestore.writes, 0);
  const id = createHash("sha256").update(`${input.userId}\u0000${input.deviceId}`).digest("hex").slice(0, 48);
  const ref = firestore.collection("pushSubscriptions").doc(id);
  for (const scope of [
    { active: false, userId: input.userId, recipientId: input.recipientId },
    { active: true, userId: input.userId, recipientId: "another-recipient" },
    { active: true, userId: "another-user", recipientId: input.recipientId },
  ]) {
    await ref.set({ ...scope, deviceId: input.deviceId, subscription: input.subscription });
    const before = structuredClone(firestore.store);
    assert.equal((await registerPushSubscription(input)).record, null);
    assert.deepEqual(firestore.store, before);
  }
});

test("automatic repair updates an active subscription but cannot overwrite a concurrent opt-out", async () => {
  const firestore = new MemoryFirestore();
  const input = {
    userId: "user-a", recipientId: "recipient-a", deviceId: "test-device-000001", firestore,
    platform: "android" as const, browser: "chrome" as const, userAgent: "synthetic", timeZone: "Asia/Seoul",
    subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/old", keys: { auth: "test", p256dh: "test" } },
    medications: [],
  };
  const initial = await registerPushSubscription(input);
  assert.ok(initial.record);
  const repaired = await registerPushSubscription({ ...input, onlyIfActive: true, subscription: { ...input.subscription, endpoint: "https://fcm.googleapis.com/fcm/send/new" } });
  assert.equal(repaired.record?.subscription.endpoint, "https://fcm.googleapis.com/fcm/send/new");
  const ref = firestore.collection("pushSubscriptions").doc(initial.record.id);
  let optedOut = false;
  const writes = firestore.writes;
  firestore.beforeRead = async (path) => {
    if (path === ref.path && !optedOut) {
      optedOut = true;
      await ref.set({ active: false }, { merge: true });
    }
  };
  assert.equal((await registerPushSubscription({ ...input, onlyIfActive: true })).record, null);
  assert.equal(firestore.writes, writes + 1, "only the user's opt-out writes data");
  assert.equal((await ref.get()).data()?.active, false);
  assert.equal(((await ref.get()).data()?.subscription as { endpoint: string }).endpoint, "https://fcm.googleapis.com/fcm/send/new");
});
