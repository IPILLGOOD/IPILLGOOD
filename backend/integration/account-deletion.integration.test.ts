import assert from "node:assert/strict";
import test from "node:test";
import { emulatorFixture } from "../test-support/emulator.ts";
import { deleteRecipientHealthData } from "../src/health-data-deletion.ts";
import { createFirebaseAccountAdmin } from "../src/firebase-account-admin.ts";
import { getAccountDeletion, requestAccountDeletion, processAccountDeletion, restoreAccount } from "../src/account-deletion.ts";
import { getAccountDeletionPolicy } from "../src/account-deletion-policy.ts";
import { getAccountSessionState } from "../src/account-lifecycle.ts";
import { seedCareAccount, syntheticMedication } from "../test-support/care-fixtures.ts";
import { fixedClock } from "../test-support/memory-firestore.ts";
import { registerPushSubscription } from "../src/push-repository.ts";

for (const adapter of ["admin", "rest"] as const) {
  test(`${adapter}: stale suspension cannot erase a restored account's new Push opt-in`, async (t) => {
    const f = emulatorFixture(adapter);
    t.after(async () => {
      await f.admin.collection("accountDeletions").doc(f.scope.recipientId).delete();
      await f.cleanup();
    });
    const clock = fixedClock();
    const auth = { async lookup() { return { localId: f.namespace }; }, async revoke() {}, async disable() {}, async delete() {} };
    const dependencies = { firestore: f.firestore, auth, now: clock.now };
    await seedCareAccount(f.firestore, f.scope.recipientId, { medications: [syntheticMedication] });
    const job = await requestAccountDeletion({ userId: f.namespace, tokenUserId: f.namespace,
      authTime: Math.floor(clock.now().getTime() / 1000), confirmation: "회원 탈퇴", policyVersion: getAccountDeletionPolicy().version }, dependencies);
    let resume!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => { resume = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const staleWorker = processAccountDeletion(f.namespace, { ...dependencies, auth: { ...auth, async revoke() { entered(); await blocked; } } });
    await started;
    let registration: Awaited<ReturnType<typeof registerPushSubscription>> | undefined;
    let restored: Awaited<ReturnType<typeof restoreAccount>> | undefined;
    try {
      clock.advance(301_000);
      assert.equal((await processAccountDeletion(f.namespace, dependencies))?.status, "soft_deleted");
      restored = await restoreAccount({ userId: f.namespace, requestId: job.requestId,
        authTime: Math.floor(clock.now().getTime() / 1000), confirmation: true }, dependencies);
      registration = await registerPushSubscription({
        userId: f.namespace, recipientId: f.scope.recipientId, deviceId: f.namespace, platform: "android", browser: "chrome",
        userAgent: "synthetic", timeZone: "Asia/Seoul", now: clock.now(), firestore: f.firestore,
        subscription: { endpoint: "https://push.invalid/synthetic", keys: { auth: "fake", p256dh: "fake" } }, medications: [syntheticMedication],
      });
      assert.ok(registration.record);
      assert.ok(registration.schedules.length > 0);
    } finally {
      resume();
      await staleWorker;
    }
    assert.deepEqual(await getAccountDeletion(f.namespace, f.firestore), restored);
    assert.deepEqual((await f.firestore.collection("pushSubscriptions").doc(registration!.record!.id).get()).data(), registration!.record);
    for (const schedule of registration!.schedules) {
      assert.deepEqual((await f.firestore.collection("medicationReminderSchedules").doc(schedule.id).get()).data(), schedule);
    }
  });

  test(`${adapter}: recursive erasure discovers orphaned and unknown nested collections`, async (t) => {
    const fixture = emulatorFixture(adapter);
    t.after(() => fixture.cleanup());
    const recipient = fixture.firestore.collection("careRecipients").doc(fixture.scope.recipientId);
    await recipient.collection("unknown").doc("missing").collection("nested").doc("leaf").set({ private: true });
    await recipient.collection("clinicalDocuments").doc("a").set({ private: true });
    const children = await recipient.listCollections();
    assert.deepEqual(children.map((collection) => collection.path.split("/").at(-1)).sort(), ["clinicalDocuments", "unknown"]);
    assert.equal((await recipient.collection("unknown").listDocuments())[0]?.id, "missing");
    const result = await deleteRecipientHealthData({ firestore: fixture.firestore, recipientId: fixture.scope.recipientId, includeProfile: true });
    assert.equal(result.verified, true);
    assert.equal(result.deletedDocuments, 2);
    assert.equal((await recipient.listCollections()).length, 0);
  });
}

test("Auth emulator: server lookup, disable/revoke, delete, verify absence and idempotent retry", async () => {
  const projectId = process.env.FIREBASE_PROJECT_ID!;
  const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST!;
  const auth = createFirebaseAccountAdmin({ projectId, emulatorHost, accessToken: async () => "owner" });
  const response = await fetch(`http://${emulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=synthetic`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnSecureToken: true }),
  });
  assert.equal(response.ok, true);
  const { localId } = await response.json() as { localId: string };
  try {
    assert.equal((await auth.lookup(localId))?.localId, localId);
    await auth.revoke(localId);
    assert.notEqual((await auth.lookup(localId))?.disabled, true);
    await auth.disable(localId);
    assert.equal((await auth.lookup(localId))?.disabled, true);
    await auth.delete(localId);
    assert.equal(await auth.lookup(localId), null);
    await auth.disable(localId);
    await auth.delete(localId);
  } finally { await auth.delete(localId); }
});

for (const adapter of ["admin", "rest"] as const) {
  test(`${adapter}: soft deletion, session generation and competing restore/erasure transactions`, async (t) => {
    const f = emulatorFixture(adapter);
    t.after(async () => {
      await f.admin.collection("accountDeletions").doc(f.scope.recipientId).delete();
      await f.cleanup();
    });
    const now = new Date("2026-08-31T02:00:00.000Z");
    let authExists = true;
    let disabled = false;
    const auth = {
      async lookup() { return authExists ? { localId: f.namespace, disabled } : null; },
      async revoke() {}, async disable() { disabled = true; }, async delete() { authExists = false; },
    };
    const data = f.firestore.collection("careRecipients").doc(f.scope.recipientId).collection("unknown").doc("retained");
    await data.set({ original: "synthetic" });
    const input = { userId: f.namespace, tokenUserId: f.namespace, authTime: Math.floor(now.getTime() / 1000), confirmation: "회원 탈퇴", policyVersion: getAccountDeletionPolicy().version };
    const job = await requestAccountDeletion(input, { firestore: f.firestore, now: () => now });
    const soft = await processAccountDeletion(f.namespace, { firestore: f.firestore, auth, now: () => now });
    assert.equal(soft?.status, "soft_deleted");
    assert.equal(disabled, false);
    assert.equal((await data.get()).exists, true);
    assert.equal((await getAccountSessionState(f.namespace, f.firestore)).active, false);

    const beforeDeadline = new Date(Date.parse(job.deleteAfter) - 1);
    const [recovery] = await Promise.allSettled([
      restoreAccount({ userId: f.namespace, requestId: job.requestId, authTime: Math.floor(beforeDeadline.getTime() / 1000), confirmation: true }, { firestore: f.firestore, now: () => beforeDeadline }),
      processAccountDeletion(f.namespace, { firestore: f.firestore, auth, now: () => new Date(job.deleteAfter) }),
    ]);
    const final = await getAccountDeletion(f.namespace, f.firestore);
    if (recovery.status === "fulfilled") {
      assert.equal(final?.status, "restored");
      assert.equal((await data.get()).exists, true);
      assert.equal(authExists, true);
      assert.equal((await getAccountSessionState(f.namespace, f.firestore)).version, job.requestId);
    } else {
      assert.equal(final?.status, "completed");
      assert.equal((await data.get()).exists, false);
      assert.equal(authExists, false);
    }
  });
}
