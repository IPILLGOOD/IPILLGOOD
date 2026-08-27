import assert from "node:assert/strict";
import test from "node:test";

import {
  DEMO_SESSION_CLEANUP_GRACE_SECONDS,
  cleanupExpiredDemoSessions,
  createEphemeralDemoSession,
  createEphemeralDemoSessionId,
  deleteEphemeralDemoSession,
  isEphemeralDemoSessionActive,
  isEphemeralDemoSessionId,
} from "./demo-session.ts";
import { MemoryFirestore } from "../test-support/memory-firestore.ts";

const memoryFirestore = () => new MemoryFirestore();
const firstId = "demo-11111111-1111-4111-8111-111111111111";
const secondId = "demo-22222222-2222-4222-8222-222222222222";
const start = new Date("2026-08-26T00:00:00.000Z");

test("서버 생성 데모 ID만 허용한다", () => {
  assert.equal(
    createEphemeralDemoSessionId(() => "11111111-1111-4111-8111-111111111111"),
    firstId,
  );
  assert.equal(isEphemeralDemoSessionId(firstId), true);
  assert.equal(isEphemeralDemoSessionId("demo-caregiver"), false);
  assert.throws(() => createEphemeralDemoSessionId(() => "not-a-uuid"));
});

test("두 데모 세션은 같은 seed를 서로 다른 저장 범위에 만든다", async () => {
  const firestore = memoryFirestore();
  const expiresAt = new Date(start.getTime() + 60 * 60 * 1_000);
  await createEphemeralDemoSession({ id: firstId, now: start, expiresAt, firestore });
  await createEphemeralDemoSession({ id: secondId, now: start, expiresAt, firestore });

  const firstModel = firestore.values.get(`careReadModels/${firstId}`);
  const secondModel = firestore.values.get(`careReadModels/${secondId}`);
  assert.equal((firstModel?.recipient as { id?: string }).id, firstId);
  assert.equal((secondModel?.recipient as { id?: string }).id, secondId);
  assert.deepEqual(firstModel?.medications, secondModel?.medications);

  await firestore
    .collection("careRecipients")
    .doc(firstId)
    .collection("clinicalDocuments")
    .doc("visitor-only")
    .set({ id: "visitor-only", fileName: "first-session-only.pdf" });
  assert.equal(
    (await firestore
      .collection("careRecipients")
      .doc(secondId)
      .collection("clinicalDocuments")
      .doc("visitor-only")
      .get()).exists,
    false,
  );
  assert.equal(
    await isEphemeralDemoSessionActive(firstId, { now: start, firestore }),
    true,
  );
  assert.equal(
    await isEphemeralDemoSessionActive(firstId, { now: expiresAt, firestore }),
    false,
  );
});

test("로그아웃 정리는 데모 하위·read model·Push 데이터만 삭제한다", async () => {
  const firestore = memoryFirestore();
  const expiresAt = new Date(start.getTime() + 60 * 60 * 1_000);
  await createEphemeralDemoSession({ id: firstId, now: start, expiresAt, firestore });
  await createEphemeralDemoSession({ id: secondId, now: start, expiresAt, firestore });
  await firestore.collection("pushSubscriptions").doc("first-device").set({
    id: "first-device",
    recipientId: firstId,
  });
  await firestore.collection("pushSubscriptions").doc("second-device").set({
    id: "second-device",
    recipientId: secondId,
  });

  const cleanup = await deleteEphemeralDemoSession({ id: firstId, now: start, firestore });

  assert.equal(
    [...firestore.values.entries()].some(
      ([path, value]) =>
        path !== `demoSessions/${firstId}` &&
        (path.includes(firstId) || value.recipientId === firstId),
    ),
    false,
  );
  assert.equal(cleanup.finalized, false);
  assert.equal(
    (firestore.values.get(`demoSessions/${firstId}`) as { status?: string }).status,
    "deleting",
  );
  assert.equal(await isEphemeralDemoSessionActive(secondId, { now: start, firestore }), true);
  assert.equal(firestore.values.has("pushSubscriptions/second-device"), true);

  await firestore
    .collection("careRecipients")
    .doc(firstId)
    .collection("clinicalDocuments")
    .doc("late-write")
    .set({ id: "late-write", fileName: "cleanup-race.pdf" });
  const finalized = await deleteEphemeralDemoSession({
    id: firstId,
    now: new Date(start.getTime() + DEMO_SESSION_CLEANUP_GRACE_SECONDS * 1_000),
    firestore,
  });
  assert.equal(finalized.finalized, true);
  assert.equal(firestore.values.has(`demoSessions/${firstId}`), false);
  assert.equal(
    firestore.values.has(
      `careRecipients/${firstId}/clinicalDocuments/late-write`,
    ),
    false,
  );
});

test("Cron 정리는 만료 세션만 삭제하고 이후 세션은 유지한다", async () => {
  const firestore = memoryFirestore();
  await createEphemeralDemoSession({
    id: firstId,
    now: start,
    expiresAt: new Date(start.getTime() + 60 * 60 * 1_000),
    firestore,
  });
  await createEphemeralDemoSession({
    id: secondId,
    now: start,
    expiresAt: new Date(start.getTime() + 3 * 60 * 60 * 1_000),
    firestore,
  });

  const summary = await cleanupExpiredDemoSessions({
    now: new Date(start.getTime() + 2 * 60 * 60 * 1_000),
    firestore,
  });

  assert.equal(summary.cleanedSessions, 1);
  assert.equal(summary.finalizedSessions, 0);
  assert.equal(await isEphemeralDemoSessionActive(firstId, { now: start, firestore }), false);
  assert.equal(await isEphemeralDemoSessionActive(secondId, { now: start, firestore }), true);

  const finalized = await cleanupExpiredDemoSessions({
    now: new Date(
      start.getTime() +
        (2 * 60 * 60 + DEMO_SESSION_CLEANUP_GRACE_SECONDS) * 1_000,
    ),
    firestore,
  });
  assert.equal(finalized.finalizedSessions, 1);
  assert.equal(firestore.values.has(`demoSessions/${firstId}`), false);
});
