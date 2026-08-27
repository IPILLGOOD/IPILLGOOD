import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { getPushDeviceHealth, getPushDeviceStatus } from "./push-repository.ts";
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
