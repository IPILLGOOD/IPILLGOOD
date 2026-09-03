import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFirestore, fixedClock } from "../test-support/memory-firestore.ts";
import { getCareSnapshot, updateRecipientProfile } from "./care-repository.ts";
import { getAccountDeletion, processAccountDeletion, requestAccountDeletion, retryAccountDeletions, restoreAccount, publicAccountDeletion } from "./account-deletion.ts";
import { accountDeletionDeadline, assertRecentAccountAuthentication, getAccountDeletionPolicy } from "./account-deletion-policy.ts";
import { getAccountSessionState, isCareAccountActive } from "./account-lifecycle.ts";
import type { FirebaseAccountAdmin } from "./firebase-account-admin.ts";
import { deleteRecipientHealthData } from "./health-data-deletion.ts";
import { getOrCreateQuestionSet } from "./care-orchestration-service.ts";
import { runCareAgent } from "./ai/care-agent.ts";
import { dispatchDueMedicationReminders, registerPushSubscription, syncMedicationReminderSchedules } from "./push-repository.ts";
import { seedCareAccount, syntheticMedication } from "../test-support/care-fixtures.ts";
import { withCareAccountProcessing } from "./account-processing.ts";

const policy = getAccountDeletionPolicy();
function fixture() {
  const firestore = new MemoryFirestore();
  const clock = fixedClock();
  const uid = "account-a";
  const recipientId = `google-${uid}`;
  let authExists = true;
  let deleteCalls = 0;
  let revokeCalls = 0;
  let disabled = false;
  const auth: FirebaseAccountAdmin = {
    async lookup() { return authExists ? { localId: uid, disabled } : null; },
    async revoke() { revokeCalls++; },
    async disable() { disabled = true; },
    async delete() { deleteCalls++; authExists = false; },
  };
  const dependencies = { firestore, auth, now: clock.now };
  const input = { userId: uid, tokenUserId: uid, authTime: Math.floor(clock.now().getTime() / 1000), confirmation: "회원 탈퇴", policyVersion: policy.version };
  const deadline = accountDeletionDeadline(clock.now());
  return { firestore, uid, recipientId, clock, auth, dependencies, input, deleteCalls: () => deleteCalls, revokeCalls: () => revokeCalls,
    expire: () => clock.advance(Math.max(0, Date.parse(deadline) - clock.now().getTime())) };
}

test("confirmed policy uses three Seoul calendar months, including month-end and leap years", () => {
  assert.equal(policy.softDeleteMonths, 3);
  for (const [start, end] of [
    ["2026-08-28T02:34:56.789Z", "2026-11-28T02:34:56.789Z"],
    ["2026-08-31T14:00:00.000Z", "2026-11-30T14:00:00.000Z"],
    ["2026-11-30T14:00:00.000Z", "2027-02-28T14:00:00.000Z"],
    ["2027-11-30T14:00:00.000Z", "2028-02-29T14:00:00.000Z"],
    ["2026-11-30T16:00:00.000Z", "2027-02-28T16:00:00.000Z"],
  ]) assert.equal(accountDeletionDeadline(new Date(start!)), end);
  assert.throws(() => accountDeletionDeadline(new Date(NaN)));
});

test("fresh authentication and confirmation are enforced before any write", async () => {
  const f = fixture();
  for (const input of [
    { ...f.input, tokenUserId: "other" },
    { ...f.input, authTime: f.input.authTime - 301 },
    { ...f.input, authTime: f.input.authTime + 1 },
    { ...f.input, confirmation: "" },
    { ...f.input, policyVersion: "old" },
    { ...f.input, userId: "../other", tokenUserId: "../other" },
  ]) await assert.rejects(requestAccountDeletion(input, f.dependencies));
  assert.equal(f.firestore.store.size, 0);
  assert.throws(() => assertRecentAccountAuthentication({ userId: "a", tokenUserId: "a", authTime: NaN }));
});

test("concurrent requests share a job and fence stale reads/writes without touching other accounts", async () => {
  const f = fixture();
  const scope = { recipientId: f.recipientId, firestore: f.firestore };
  const original = await getCareSnapshot(scope);
  const [a, b] = await Promise.all([requestAccountDeletion(f.input, f.dependencies), requestAccountDeletion(f.input, f.dependencies)]);
  assert.equal(a.requestId, b.requestId);
  assert.equal(await isCareAccountActive(f.firestore, f.recipientId), false);
  await assert.rejects(getCareSnapshot(scope));
  await assert.rejects(updateRecipientProfile(scope, original.recipient, original));
  assert.equal(await isCareAccountActive(f.firestore, "google-other"), true);
});

test("recursive erasure includes missing parents, unknown nested collections and only the scoped account", async () => {
  const f = fixture();
  for (const path of [
    `careRecipients/${f.recipientId}/clinicalDocuments/missing/nested/deep`,
    `careRecipients/${f.recipientId}/unknown/a/children/b`,
    `careReadModels/${f.recipientId}`,
    `medicationReminderSync/${f.recipientId}`,
  ]) f.firestore.store.set(path, { private: true });
  for (const name of ["pushSubscriptions", "medicationReminderSchedules", "pushDeliveries"]) {
    f.firestore.store.set(`${name}/owned`, { recipientId: f.recipientId, userId: f.uid });
    f.firestore.store.set(`${name}/other`, { recipientId: "google-other", userId: "other" });
  }
  f.firestore.store.set("careRecipients/google-other/clinicalDocuments/keep", { private: true });
  f.firestore.store.set("careRecipients/google-account-ab/clinicalDocuments/keep", { private: true });
  await requestAccountDeletion(f.input, f.dependencies);
  f.expire();
  const result = await processAccountDeletion(f.uid, f.dependencies);
  assert.equal(result?.status, "completed");
  assert.equal(f.deleteCalls(), 1);
  assert.equal([...f.firestore.store.keys()].some((path) => path.startsWith(`careRecipients/${f.recipientId}/`)), false);
  assert.equal(f.firestore.store.has("careRecipients/google-other/clinicalDocuments/keep"), true);
  assert.equal(f.firestore.store.has("careRecipients/google-account-ab/clinicalDocuments/keep"), true);
  for (const name of ["pushSubscriptions", "medicationReminderSchedules", "pushDeliveries"]) {
    assert.equal(f.firestore.store.has(`${name}/owned`), false);
    assert.equal(f.firestore.store.has(`${name}/other`), true);
  }
  await processAccountDeletion(f.uid, f.dependencies);
  assert.equal(f.deleteCalls(), 1);
});

test("large erasure is resumable and never completes before the remaining data is verified", async () => {
  const f = fixture();
  for (let index = 0; index < 430; index++) f.firestore.store.set(`careRecipients/${f.recipientId}/agentRuns/${index}`, { private: true });
  await requestAccountDeletion(f.input, f.dependencies);
  f.expire();
  assert.equal((await processAccountDeletion(f.uid, f.dependencies))?.status, "pending");
  assert.equal(f.deleteCalls(), 0);
  assert.equal((await processAccountDeletion(f.uid, f.dependencies))?.status, "pending");
  assert.equal((await processAccountDeletion(f.uid, f.dependencies))?.status, "completed");
});

test("partial data failure and missing Auth user recover without falsely reporting completion", async () => {
  const f = fixture();
  f.firestore.store.set(`careRecipients/${f.recipientId}/clinicalDocuments/a`, { private: true });
  await requestAccountDeletion(f.input, f.dependencies);
  f.expire();
  f.firestore.beforeCommit = (operations) => {
    if (operations.some((op) => op.kind === "delete")) { f.firestore.beforeCommit = undefined; throw new Error("DELETE_FAILED"); }
  };
  assert.equal((await processAccountDeletion(f.uid, f.dependencies))?.status, "failed");
  assert.equal(f.deleteCalls(), 0);
  await f.auth.delete(f.uid); // Auth disappeared independently; job remains recoverable.
  assert.equal((await processAccountDeletion(f.uid, f.dependencies))?.status, "completed");
});

test("Auth deletion failure and a crash lease are retryable; concurrent workers erase once", async () => {
  const f = fixture();
  await requestAccountDeletion(f.input, f.dependencies);
  f.expire();
  const remove = f.auth.delete;
  f.auth.delete = async () => { throw new Error("AUTH_UNAVAILABLE"); };
  const failed = await processAccountDeletion(f.uid, f.dependencies);
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.stage, "auth");
  f.auth.delete = remove;
  const ref = f.firestore.collection("accountDeletions").doc(f.recipientId);
  await ref.set({ status: "processing", leaseUntil: new Date(f.clock.now().getTime() + 1000).toISOString() }, { merge: true });
  assert.equal((await processAccountDeletion(f.uid, f.dependencies))?.status, "processing");
  assert.equal(f.deleteCalls(), 0);
  f.clock.advance(1001);
  await Promise.all([processAccountDeletion(f.uid, f.dependencies), processAccountDeletion(f.uid, f.dependencies)]);
  assert.equal(f.deleteCalls(), 1);
  assert.equal((await getAccountDeletion(f.uid, f.firestore))?.status, "completed");
});

test("hard deletion adds no extra retention after three months and verified completion", async () => {
  const f = fixture();
  await requestAccountDeletion(f.input, f.dependencies);
  await processAccountDeletion(f.uid, f.dependencies);
  f.expire();
  f.clock.advance(-1);
  await retryAccountDeletions(f.dependencies);
  assert.ok(await getAccountDeletion(f.uid, f.firestore));
  assert.equal(f.deleteCalls(), 0);
  f.clock.advance(1);
  await retryAccountDeletions(f.dependencies);
  assert.equal(f.deleteCalls(), 1);
  assert.equal(await getAccountDeletion(f.uid, f.firestore), null);
});

test("retry scans only due deletion jobs instead of every retained soft-deleted account", async () => {
  const f = fixture();
  await requestAccountDeletion(f.input, f.dependencies);
  await processAccountDeletion(f.uid, f.dependencies);
  const revokeCalls = f.revokeCalls();
  const reads: string[] = [];
  f.firestore.beforeRead = async (path) => { reads.push(path); };

  assert.deepEqual(await retryAccountDeletions(f.dependencies), { processed: 0, failed: 0 });
  assert.deepEqual(reads, ["accountDeletions", "accountDeletions"]);
  assert.equal(f.revokeCalls(), revokeCalls);
  assert.equal((await getAccountDeletion(f.uid, f.firestore))?.status, "soft_deleted");
});

test("#55 common health reset can retain the profile without retaining health descendants", async () => {
  const f = fixture();
  f.firestore.store.set(`careRecipients/${f.recipientId}`, { id: f.recipientId });
  f.firestore.store.set(`careRecipients/${f.recipientId}/clinicalDocuments/a`, { private: true });
  const result = await deleteRecipientHealthData({ firestore: f.firestore, recipientId: f.recipientId, includeProfile: false });
  assert.equal(result.verified, true);
  assert.deepEqual([...f.firestore.store.keys()], [`careRecipients/${f.recipientId}`]);
});

test("deletion fences a running AI result and does not recreate its checkpoint or failure record", async () => {
  const f = fixture();
  const scope = { recipientId: f.recipientId, firestore: f.firestore };
  const current = await getCareSnapshot(scope);
  await updateRecipientProfile(scope, { ...current.recipient, consentConfirmed: true }, current);
  await assert.rejects(getOrCreateQuestionSet({ scope, answerer: "caregiver" }, {
    wait: async () => undefined,
    runAgent: async (input) => {
      await requestAccountDeletion(f.input, f.dependencies);
      await processAccountDeletion(f.uid, f.dependencies);
      return runCareAgent({ ...input, apiKey: "" });
    },
  }));
  f.expire();
  await processAccountDeletion(f.uid, f.dependencies);
  assert.equal([...f.firestore.store.keys()].some((path) => path.startsWith(`careRecipients/${f.recipientId}`)), false);
});

test("pending deletion blocks registration, schedule reconciliation and new dispatch before cleanup runs", async () => {
  const f = fixture();
  await seedCareAccount(f.firestore, f.recipientId, { medications: [syntheticMedication] });
  const registration = { userId: f.uid, recipientId: f.recipientId, deviceId: "device-a", platform: "android" as const, browser: "chrome" as const,
    userAgent: "synthetic", timeZone: "Asia/Seoul", subscription: { endpoint: "https://push.invalid/synthetic", keys: { auth: "fake", p256dh: "fake" } }, medications: [], firestore: f.firestore, now: new Date("2026-08-23T22:00:00Z") };
  await registerPushSubscription(registration);
  await requestAccountDeletion(f.input, f.dependencies);
  await assert.rejects(registerPushSubscription(registration));
  assert.deepEqual(await syncMedicationReminderSchedules(registration), []);
  let sends = 0;
  const summary = await dispatchDueMedicationReminders({ firestore: f.firestore, now: new Date("2026-08-23T23:00:10Z"),
    vapid: { publicKey: "fake", privateKey: "fake", subject: "mailto:test@example.test" },
    sender: async () => { sends++; return { ok: true, status: 201, expired: false, responseBody: "" }; },
  });
  assert.equal(summary.claimed, 0);
  assert.equal(sends, 0);
});

test("soft deletion waits for already admitted external work and refuses any new work", async () => {
  const f = fixture();
  let finish!: () => void;
  let started!: () => void;
  const admitted = new Promise<void>((resolve) => { started = resolve; });
  const running = withCareAccountProcessing(f.recipientId, async () => {
    started();
    await new Promise<void>((resolve) => { finish = resolve; });
  }, f.firestore);
  await admitted;
  await requestAccountDeletion(f.input, f.dependencies);
  assert.equal((await processAccountDeletion(f.uid, f.dependencies))?.status, "pending");
  assert.equal(f.deleteCalls(), 0);
  await assert.rejects(withCareAccountProcessing(f.recipientId, async () => assert.fail("must not start"), f.firestore));
  finish();
  await running;
  assert.equal((await processAccountDeletion(f.uid, f.dependencies))?.status, "soft_deleted");
  assert.equal(f.deleteCalls(), 0);
});

test("soft deletion preserves health data and Firebase sign-in but unlinks Push on every device", async () => {
  const f = fixture();
  const healthPath = `careRecipients/${f.recipientId}/clinicalDocuments/a`;
  f.firestore.store.set(healthPath, { original: "preserved" });
  f.firestore.store.set(`careReadModels/${f.recipientId}`, { original: "preserved" });
  for (const name of ["pushSubscriptions", "medicationReminderSchedules", "pushDeliveries", "medicationReminderSync"]) {
    f.firestore.store.set(`${name}/owned`, { recipientId: f.recipientId, active: true });
    f.firestore.store.set(`${name}/other`, { recipientId: "google-other", active: true });
  }
  const requested = await requestAccountDeletion(f.input, f.dependencies);
  const job = await processAccountDeletion(f.uid, f.dependencies);
  assert.equal(job?.status, "soft_deleted");
  assert.equal(f.deleteCalls(), 0);
  assert.equal(f.revokeCalls(), 1);
  assert.equal((await f.auth.lookup(f.uid))?.disabled, false);
  assert.deepEqual(f.firestore.store.get(healthPath), { original: "preserved" });
  assert.ok(f.firestore.store.has(`careReadModels/${f.recipientId}`));
  for (const name of ["pushSubscriptions", "medicationReminderSchedules", "pushDeliveries", "medicationReminderSync"]) {
    assert.equal(f.firestore.store.has(`${name}/owned`), false);
    assert.equal(f.firestore.store.has(`${name}/other`), true);
  }
  f.clock.advance(86400_000);
  const again = await requestAccountDeletion({ ...f.input, authTime: Math.floor(f.clock.now().getTime() / 1000) }, f.dependencies);
  assert.equal(again.deleteAfter, requested.deleteAfter);
  await processAccountDeletion(f.uid, f.dependencies);
  assert.equal(f.revokeCalls(), 1);
});

test("explicit fresh recovery preserves data, changes session generation, and cancels scheduled erasure", async () => {
  const f = fixture();
  const scope = { recipientId: f.recipientId, firestore: f.firestore };
  const before = await getCareSnapshot(scope);
  const oldSession = await getAccountSessionState(f.uid, f.firestore);
  const job = await requestAccountDeletion(f.input, f.dependencies);
  await processAccountDeletion(f.uid, f.dependencies);
  f.clock.advance(1000);
  const input = { userId: f.uid, requestId: job.requestId, authTime: Math.floor(f.clock.now().getTime() / 1000), confirmation: true };
  for (const invalid of [{ ...input, confirmation: false }, { ...input, requestId: "other" }, { ...input, userId: "other" }, { ...input, authTime: f.input.authTime }]) {
    await assert.rejects(restoreAccount(invalid, f.dependencies));
  }
  const restored = await restoreAccount(input, f.dependencies);
  assert.equal(restored.status, "restored");
  assert.equal((await restoreAccount(input, f.dependencies)).requestId, restored.requestId);
  assert.equal(await isCareAccountActive(f.firestore, f.recipientId), true);
  const state = await getAccountSessionState(f.uid, f.firestore);
  assert.notEqual(state.version, oldSession.version);
  assert.equal(state.version, job.requestId);
  assert.ok(state.authValidAfter > f.input.authTime);
  assert.deepEqual((await getCareSnapshot(scope)).recipient, before.recipient);
  f.expire();
  await retryAccountDeletions(f.dependencies);
  assert.equal(f.deleteCalls(), 0);
  const next = await requestAccountDeletion({ ...f.input, authTime: Math.floor(f.clock.now().getTime() / 1000) }, f.dependencies);
  assert.notEqual(next.requestId, job.requestId);
  assert.ok(next.deleteAfter > job.deleteAfter);
  await assert.rejects(restoreAccount({ ...input, authTime: Math.floor(f.clock.now().getTime() / 1000) }, f.dependencies));
});

test("recovery cutoff is exclusive and cannot race permanent deletion", async () => {
  const f = fixture();
  const job = await requestAccountDeletion(f.input, f.dependencies);
  await processAccountDeletion(f.uid, f.dependencies);
  f.expire();
  f.clock.advance(-1);
  assert.equal(publicAccountDeletion((await getAccountDeletion(f.uid, f.firestore))!, f.clock.now()).canRestore, true);
  f.clock.advance(1);
  assert.equal(publicAccountDeletion((await getAccountDeletion(f.uid, f.firestore))!, f.clock.now()).canRestore, false);
  const [recovery, deletion] = await Promise.allSettled([
    restoreAccount({ userId: f.uid, requestId: job.requestId, authTime: Math.floor(f.clock.now().getTime() / 1000), confirmation: true }, f.dependencies),
    processAccountDeletion(f.uid, f.dependencies),
  ]);
  assert.equal(recovery.status, "rejected");
  assert.equal(deletion.status, "fulfilled");
  assert.equal((await getAccountDeletion(f.uid, f.firestore))?.status, "completed");
  assert.equal(f.deleteCalls(), 1);
});

test("suspension failure is retryable and never exposes a recoverable account before notifications are unlinked", async () => {
  const f = fixture();
  const job = await requestAccountDeletion(f.input, f.dependencies);
  const revoke = f.auth.revoke;
  f.auth.revoke = async () => { throw new Error("AUTH_UNAVAILABLE"); };
  assert.equal((await processAccountDeletion(f.uid, f.dependencies))?.status, "failed");
  f.clock.advance(1000);
  const recovery = { userId: f.uid, requestId: job.requestId, authTime: Math.floor(f.clock.now().getTime() / 1000), confirmation: true };
  await assert.rejects(restoreAccount(recovery, f.dependencies), /ACCOUNT_SUSPENSION_INCOMPLETE/);
  f.auth.revoke = revoke;
  await processAccountDeletion(f.uid, f.dependencies);
  assert.equal((await restoreAccount(recovery, f.dependencies)).status, "restored");
});

test("expired suspension worker must not erase a new Push opt-in after another worker restores the account", async () => {
  const f = fixture();
  await seedCareAccount(f.firestore, f.recipientId, { medications: [syntheticMedication] });
  const job = await requestAccountDeletion(f.input, f.dependencies);
  let resume!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>((resolve) => { resume = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  // Model a slow Firestore call that outlives the worker's 5-minute ownership lease.
  f.firestore.beforeRead = async (path) => {
    if (path !== "pushSubscriptions") return;
    f.firestore.beforeRead = undefined;
    entered();
    await blocked;
  };
  const staleWorker = processAccountDeletion(f.uid, f.dependencies);
  await started;
  let registration: Awaited<ReturnType<typeof registerPushSubscription>> | undefined;
  try {
    f.clock.advance(301_000);
    assert.equal((await processAccountDeletion(f.uid, f.dependencies))?.status, "soft_deleted");
    await restoreAccount({ userId: f.uid, requestId: job.requestId,
      authTime: Math.floor(f.clock.now().getTime() / 1000), confirmation: true }, f.dependencies);
    registration = await registerPushSubscription({
      userId: f.uid, recipientId: f.recipientId, deviceId: "newly-consented-device", platform: "android", browser: "chrome",
      userAgent: "synthetic", timeZone: "Asia/Seoul", now: f.clock.now(), firestore: f.firestore,
      subscription: { endpoint: "https://push.invalid/synthetic", keys: { auth: "fake", p256dh: "fake" } }, medications: [syntheticMedication],
    });
    assert.ok(registration.record);
    assert.ok(f.firestore.store.has(`pushSubscriptions/${registration.record.id}`));
    assert.ok(registration.schedules.length > 0);
  } finally {
    resume();
    await staleWorker;
  }
  assert.equal((await getAccountDeletion(f.uid, f.firestore))?.status, "restored");
  assert.ok(f.firestore.store.has(`pushSubscriptions/${registration!.record!.id}`),
    "An expired deletion worker removed the new subscription after explicit account recovery.");
  for (const schedule of registration!.schedules) assert.ok(f.firestore.store.has(`medicationReminderSchedules/${schedule.id}`));
});

test("a suspension lease that expires during discovery cannot delete even before a replacement worker claims it", async () => {
  const f = fixture();
  const path = "pushSubscriptions/expiry-boundary";
  f.firestore.store.set(path, { recipientId: f.recipientId, active: true });
  await requestAccountDeletion(f.input, f.dependencies);
  f.firestore.beforeRead = async (collection) => {
    if (collection !== "pushSubscriptions") return;
    f.firestore.beforeRead = undefined;
    f.clock.advance(300_000); // Equality is already expired, not just strictly after the lease.
  };
  assert.equal((await processAccountDeletion(f.uid, f.dependencies))?.status, "processing");
  assert.equal(f.firestore.store.has(path), true);
  await retryAccountDeletions(f.dependencies);
  assert.equal((await getAccountDeletion(f.uid, f.firestore))?.status, "soft_deleted");
  assert.equal(f.firestore.store.has(path), false);
});

for (const rewithdraw of [false, true]) test(`ownership read and notification deletion are atomic across ${rewithdraw ? "a new withdrawal" : "recovery"}`, async () => {
  const f = fixture();
  const path = "pushSubscriptions/reused-device-key";
  f.firestore.store.set(path, { recipientId: f.recipientId, generation: "old" });
  const job = await requestAccountDeletion(f.input, f.dependencies);
  let resume!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>((resolve) => { resume = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const runTransaction = f.firestore.runTransaction.bind(f.firestore);
  let paused = false;
  f.firestore.runTransaction = (work) => runTransaction(async (tx) => {
    let deletesSubscription = false;
    const remove = tx.delete.bind(tx);
    tx.delete = (ref) => { if (ref.path === path) deletesSubscription = true; return remove(ref); };
    const result = await work(tx);
    if (deletesSubscription && !paused) {
      paused = true;
      entered();
      await blocked; // Ownership was read, but the transaction has not committed yet.
    }
    return result;
  });
  const staleWorker = processAccountDeletion(f.uid, f.dependencies);
  await Promise.race([started, staleWorker.then(() => assert.fail("Notification deletion must use an ownership-checked transaction."))]);
  let expected: Awaited<ReturnType<typeof getAccountDeletion>>;
  try {
    f.clock.advance(301_000);
    await processAccountDeletion(f.uid, f.dependencies);
    await restoreAccount({ userId: f.uid, requestId: job.requestId,
      authTime: Math.floor(f.clock.now().getTime() / 1000), confirmation: true }, f.dependencies);
    f.firestore.store.set(path, { recipientId: f.recipientId, generation: "new-opt-in" });
    if (rewithdraw) await requestAccountDeletion({ ...f.input, authTime: Math.floor(f.clock.now().getTime() / 1000) }, f.dependencies);
    expected = await getAccountDeletion(f.uid, f.firestore);
  } finally {
    resume();
    await staleWorker;
  }
  assert.deepEqual(f.firestore.store.get(path), { recipientId: f.recipientId, generation: "new-opt-in" });
  assert.deepEqual(await getAccountDeletion(f.uid, f.firestore), expected!);
});

test("transaction-fenced notification cleanup remains resumable beyond 200 documents", async () => {
  const f = fixture();
  const healthPath = `careRecipients/${f.recipientId}/clinicalDocuments/keep`;
  f.firestore.store.set(healthPath, { private: true });
  for (let index = 0; index < 205; index++) f.firestore.store.set(`pushSubscriptions/device-${index}`, { recipientId: f.recipientId });
  f.firestore.store.set("pushSubscriptions/other", { recipientId: "google-other" });
  await requestAccountDeletion(f.input, f.dependencies);
  const count = () => [...f.firestore.store].filter(([path, data]) => path.startsWith("pushSubscriptions/") && (data as { recipientId: string }).recipientId === f.recipientId).length;
  assert.equal((await processAccountDeletion(f.uid, f.dependencies))?.status, "pending");
  assert.equal(count(), 5);
  assert.equal((await processAccountDeletion(f.uid, f.dependencies))?.status, "soft_deleted");
  assert.equal(count(), 0);
  assert.equal(f.firestore.store.has("pushSubscriptions/other"), true);
  assert.equal(f.firestore.store.has(healthPath), true);
});
