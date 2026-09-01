import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFirestore } from "../test-support/memory-firestore.ts";
import { activatePushSubscription, authorizePushDisplay, deactivatePushSubscription, dispatchDueMedicationReminders, getPushDeviceHealth, registerPushSubscription } from "./push-repository.ts";
import type { MedicationPlan } from "./types.ts";
import { reconcileMedicationReminders } from "./reminder-reconciliation.ts";

const now = new Date("2026-08-31T00:00:00Z");
async function fixture() {
  const firestore = new MemoryFirestore();
  const plan: MedicationPlan = { id: "plan", productName: "synthetic", ingredientName: "synthetic", categoryPlain: "", purposePlain: "", descriptionPlain: "", doseAmount: "1", frequency: "하루 1회", timing: "아침 식사 후", startDate: "2026-08-01", status: "active", isNew: false, sourceLabel: "", watchFor: [] };
  await firestore.collection("careReadModels").doc("recipient-a").set({ revision: 0 });
  await firestore.collection("careRecipients/recipient-a/medicationPlans").doc(plan.id).set(plan);
  return {
    firestore, now, userId: "user-a", recipientId: "recipient-a", deviceId: "shared-device-0001",
    platform: "android" as const, browser: "chrome" as const, userAgent: "synthetic", timeZone: "Asia/Seoul",
    bindingId: "binding-a", sessionKey: "session-a", deferActivation: true, medications: [plan],
    subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/synthetic", keys: { auth: "synthetic", p256dh: "synthetic" } },
  };
}

test("unacknowledged registration stays inactive and cannot send, even after reconciliation", async () => {
  const f = await fixture();
  const prepared = await registerPushSubscription(f);
  assert.equal(prepared.record?.active, false);
  assert.equal((await getPushDeviceHealth(f)).subscribed, false);
  await reconcileMedicationReminders(f);
  let sends = 0;
  await dispatchDueMedicationReminders({ ...f, vapid: { publicKey: "test", privateKey: "test", subject: "mailto:test@example.com" }, sender: async () => { sends++; throw new Error("must not send"); } });
  assert.equal(sends, 0);
  assert.equal(await authorizePushDisplay({ ...f, subscriptionId: prepared.record!.id }), false);
});

test("schedule read or transaction commit failure cannot leave an activated subscription", async () => {
  for (const mode of ["read", "commit"]) {
    const f = await fixture();
    const prepared = await registerPushSubscription(f);
    const before = structuredClone(f.firestore.store);
    if (mode === "read") f.firestore.beforeRead = async (path) => { if (path.endsWith("/medicationPlans")) throw new Error("schedule unavailable"); };
    else f.firestore.failCommits = 1;
    await assert.rejects(activatePushSubscription(f));
    assert.deepEqual(f.firestore.store, before);
    f.firestore.beforeRead = undefined;
    const status = await activatePushSubscription(f);
    assert.equal(status?.activeSubscriptionCount, 1);
    assert.equal(status?.activeScheduleCount, 1);
    assert.equal(await authorizePushDisplay({ ...f, subscriptionId: prepared.record!.id }), true);
  }
});

test("confirmation is idempotent, rejects another session, and cannot revive opt-out", async () => {
  const f = await fixture();
  await registerPushSubscription(f);
  assert.equal(await activatePushSubscription({ ...f, sessionKey: "session-b" }), null);
  const first = await activatePushSubscription(f);
  assert.deepEqual(await activatePushSubscription(f), first);
  await deactivatePushSubscription(f);
  assert.equal(await activatePushSubscription(f), null);
  assert.equal((await registerPushSubscription({ ...f, onlyIfActive: true })).record, null);
});

test("revocation atomically queues schedule cleanup; failure is safely retryable without a login session", async () => {
  const f = await fixture();
  await registerPushSubscription(f);
  await activatePushSubscription(f);
  f.firestore.failCommits = 1;
  await assert.rejects(deactivatePushSubscription(f));
  assert.equal((await getPushDeviceHealth(f)).subscribed, true);
  // The signed cleanup capability supplies precisely these fields even after session deletion.
  await deactivatePushSubscription({ firestore: f.firestore, userId: f.userId, deviceId: f.deviceId, bindingId: f.bindingId, now });
  assert.equal((await getPushDeviceHealth(f)).subscribed, false);
  assert.equal(f.firestore.values.get("medicationReminderSync/recipient-a")?.status, "pending");
  await reconcileMedicationReminders(f);
  const schedules = await f.firestore.collection("medicationReminderSchedules").get();
  assert.ok(schedules.docs.every((doc) => doc.data()?.status === "ended"));
});

test("delayed cleanup cannot disable a newer opt-in, including legacy cleanup", async () => {
  const f = await fixture();
  await registerPushSubscription(f);
  await activatePushSubscription(f);
  const newer = { ...f, bindingId: "binding-new", sessionKey: "session-new" };
  const prepared = await registerPushSubscription(newer);
  await activatePushSubscription(newer);
  assert.equal(await deactivatePushSubscription(f), false);
  assert.equal(await deactivatePushSubscription({ ...f, bindingId: "legacy" }), false);
  assert.equal(await authorizePushDisplay({ ...newer, subscriptionId: prepared.record!.id }), true);
  assert.equal(await authorizePushDisplay({ ...f, subscriptionId: prepared.record!.id }), false);
});

test("account B cannot silently inherit account A, and explicit opt-in revokes a reused endpoint even with a new device ID", async () => {
  const a = await fixture();
  const previous = await registerPushSubscription(a);
  await activatePushSubscription(a);
  const b = { ...a, userId: "user-b", recipientId: "recipient-b", sessionKey: "session-b", bindingId: "binding-b", deviceId: "new-device-id-0002" };
  assert.equal((await registerPushSubscription({ ...b, onlyIfActive: true })).record, null);
  const prepared = await registerPushSubscription(b);
  assert.equal(a.firestore.values.get(`pushSubscriptions/${previous.record!.id}`)?.active, false);
  assert.equal(await activatePushSubscription(a), null);
  await activatePushSubscription(b);
  assert.equal(await authorizePushDisplay({ ...b, subscriptionId: prepared.record!.id }), true);
  assert.equal(await authorizePushDisplay({ ...a, subscriptionId: previous.record!.id }), false);
});

test("prepared registrations from a different login are not reported or automatically repaired", async () => {
  const f = await fixture();
  await registerPushSubscription(f);
  assert.equal((await getPushDeviceHealth({ ...f, sessionKey: "new-login" })).subscribed, false);
  assert.equal((await registerPushSubscription({ ...f, sessionKey: "new-login", onlyIfActive: true })).record, null);
  assert.equal((await getPushDeviceHealth({ ...f, bindingId: "missing-cookie" })).subscribed, false);
});

test("preparing a replacement preserves the last dose's existing grace-window schedule", async () => {
  const f = await fixture();
  await f.firestore.collection("careRecipients/recipient-a/medicationPlans").doc("plan").set({ ...f.medications[0], endDate: "2026-09-01" });
  await registerPushSubscription(f);
  await activatePushSubscription(f);
  const [schedule] = (await f.firestore.collection("medicationReminderSchedules").get()).docs;
  const due = schedule.data()!.nextDueAt as string;
  const replacement = { ...f, now: new Date(Date.parse(due) + 1000), bindingId: "binding-replacement" };
  await registerPushSubscription(replacement);
  assert.equal((await schedule.ref.get()).data()?.status, "active");
  await activatePushSubscription(replacement);
  assert.equal((await schedule.ref.get()).data()?.nextDueAt, due);
  assert.equal((await schedule.ref.get()).data()?.status, "active");
});
