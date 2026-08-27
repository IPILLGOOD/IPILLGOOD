import assert from "node:assert/strict";
import test from "node:test";
import { emulatorFixture } from "../test-support/emulator.ts";
import { getCareSnapshot, registerDocument, updateRecipientProfile, rebuildCareReadModel } from "../src/care-repository.ts";
import { getOrCreateQuestionSet } from "../src/care-orchestration-service.ts";
import { runCareAgent } from "../src/ai/care-agent.ts";
import { seedCareAccount, syntheticMedication, syntheticDocument } from "../test-support/care-fixtures.ts";
import { dispatchDueMedicationReminders, registerPushSubscription, syncMedicationReminderSchedules } from "../src/push-repository.ts";

for (const adapter of ["admin", "rest"] as const) {
  test(`${adapter}: atomic batch, field merge, query and transaction contracts`, { timeout: 90_000 }, async (t) => {
    const fixture = emulatorFixture(adapter);
    t.after(() => fixture.cleanup());
    const { firestore, namespace } = fixture;
    const rows = firestore.collection(namespace);
    const a = rows.doc("a");
    const b = rows.doc("b");
    await a.set({ value: 0, nested: { left: 0, right: 0 }, active: false });
    await b.set({ exists: true });
    await assert.rejects(firestore.batch().set(a, { value: 99 }).create(b, { exists: false }).commit());
    assert.equal(((await a.get()).data() as { value: number }).value, 0);
    await Promise.all([
      a.set({ nested: { left: 1 } }, { merge: true }),
      a.set({ nested: { right: 2 }, lastHttpStatus: 503 }, { merge: true }),
    ]);
    const merged = (await a.get()).data() as { nested: unknown; active: boolean };
    assert.deepEqual(merged.nested, { left: 1, right: 2 });
    assert.equal(merged.active, false);
    await Promise.all(Array.from({ length: 4 }, () => firestore.runTransaction(async (tx) => {
      const data = (await tx.get(a)).data() as { value: number };
      tx.set(a, { value: data.value + 1 }, { merge: true });
    })));
    assert.equal(((await a.get()).data() as { value: number }).value, 4);
    const batch = firestore.batch();
    for (let index = 0; index < 101; index++) batch.set(rows.doc(`ended-${index}`), { status: "ended", nextDueAt: "2020-01-01" });
    batch.set(rows.doc("active"), { status: "active", nextDueAt: "2026-08-27" });
    await batch.commit();
    const query = await rows.where("status", "==", "active").where("nextDueAt", "<=", "2026-08-28").orderBy("nextDueAt").limit(1).get();
    assert.deepEqual(query.docs.map((doc) => doc.id), ["active"]);
    await rows.doc("cursor-a").set({ key: "same", id: "a" });
    await rows.doc("cursor-b").set({ key: "same", id: "b" });
    const after = await rows.orderBy("key").orderBy("id").startAfter("same", "a").get();
    assert.deepEqual(after.docs.map((doc) => doc.id), ["cursor-b"]);
  });

  test(`${adapter}: concurrent account writes, canonical recovery and single question generation`, { timeout: 90_000 }, async (t) => {
    const fixture = emulatorFixture(adapter);
    t.after(() => fixture.cleanup());
    const { scope, firestore } = fixture;
    const initial = await getCareSnapshot(scope);
    const upload = syntheticDocument;
    await Promise.all([registerDocument(scope, upload("a")), registerDocument(scope, upload("b")), updateRecipientProfile(scope, { ...initial.recipient, displayName: "계정 검증" }, initial)]);
    const result = await getCareSnapshot(scope);
    assert.deepEqual(result.documents.map((doc) => doc.id).sort(), ["a", "b"]);
    assert.equal(result.recipient.displayName, "계정 검증");
    const model = firestore.collection("careReadModels").doc(scope.recipientId);
    await model.set({ documents: [] }, { merge: true });
    assert.equal((await rebuildCareReadModel(scope)).repaired, true);
    let calls = 0;
    const runAgent: typeof runCareAgent = async (input) => { calls++; return runCareAgent({ ...input, apiKey: "" }); };
    const questions = await Promise.all(Array.from({ length: 3 }, () => getOrCreateQuestionSet({ scope, answerer: "caregiver", targetDate: "2026-08-27" }, { runAgent })));
    assert.equal(calls, 1);
    assert.equal(new Set(questions.map((q) => q.question_set_id)).size, 1);
    assert.equal((await firestore.collection(`careRecipients/${scope.recipientId}/agentRuns`).get()).docs.length, 1);
  });

  test(`${adapter}: reminder no-op sync and concurrent delivery`, { timeout: 90_000 }, async (t) => {
    const fixture = emulatorFixture(adapter);
    t.after(() => fixture.cleanup());
    const { firestore, scope, admin } = fixture;
    await seedCareAccount(firestore, scope.recipientId, { medications: [syntheticMedication] });
    const beforeDue = new Date("2026-08-23T22:00:00.000Z");
    const registration = await registerPushSubscription({ firestore, userId: scope.recipientId, recipientId: scope.recipientId,
      deviceId: fixture.namespace, platform: "android", browser: "chrome", userAgent: "synthetic", timeZone: "Asia/Seoul",
      subscription: { endpoint: "https://push.invalid/synthetic", keys: { auth: "fake", p256dh: "fake" } }, medications: [], now: beforeDue,
    });
    const ref = admin.collection("medicationReminderSchedules").doc(registration.schedules[0]!.id);
    const updateTime = (await ref.get()).updateTime!.toMillis();
    await syncMedicationReminderSchedules({ firestore, recipientId: scope.recipientId, now: beforeDue });
    assert.equal((await ref.get()).updateTime!.toMillis(), updateTime);
    let sends = 0;
    const sender = async () => { sends++; return { ok: true, status: 201, expired: false, responseBody: "" }; };
    await Promise.all(Array.from({ length: 3 }, () => dispatchDueMedicationReminders({ firestore, sender,
      vapid: { publicKey: "fake", privateKey: "fake", subject: "mailto:test@example.test" }, now: new Date("2026-08-23T23:00:10Z"),
    })));
    assert.equal(sends, 1);
    assert.equal((await ref.get()).data()?.nextDueAt, "2026-08-24T23:00:00.000Z");
  });
}
