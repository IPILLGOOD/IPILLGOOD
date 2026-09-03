import assert from "node:assert/strict";
import test from "node:test";

import { getAccountSessionState, isCareAccountActive } from "./account-lifecycle.ts";
import {
  getHealthDataReset,
  processHealthDataReset,
  requestHealthDataReset,
} from "./health-data-reset.ts";
import type { FirebaseAccountAdmin } from "./firebase-account-admin.ts";
import { MemoryFirestore, fixedClock } from "../test-support/memory-firestore.ts";

function fixture() {
  const firestore = new MemoryFirestore();
  const clock = fixedClock("2026-09-01T00:00:00.000Z");
  const userId = "health-reset-user";
  const recipientId = `google-${userId}`;
  let authDeletes = 0;
  const auth: FirebaseAccountAdmin = {
    async lookup(id) { return { localId: id }; },
    async revoke() {},
    async disable() {},
    async delete() { authDeletes += 1; },
  };
  const dependencies = { firestore, auth, now: clock.now };
  const request = (deleteFirebaseAccount = false) => requestHealthDataReset({
    userId,
    tokenUserId: userId,
    authTime: Math.floor(clock.now().getTime() / 1000),
    confirmation: "건강정보 삭제",
    deleteFirebaseAccount,
  }, dependencies);
  return { firestore, clock, userId, recipientId, dependencies, request, authDeletes: () => authDeletes };
}

test("건강정보 초기화는 Firebase 계정은 유지하고 빈 프로필만 다시 만든다", async () => {
  const f = fixture();
  f.firestore.store.set(`careRecipients/${f.recipientId}`, {
    id: f.recipientId,
    displayName: "삭제 대상",
    allergies: ["민감 알레르기"],
    consentConfirmed: true,
  });
  for (const path of [
    `careRecipients/${f.recipientId}/clinicalDocuments/document`,
    `careRecipients/${f.recipientId}/agentRuns/run`,
    `careReadModels/${f.recipientId}`,
    `careConnections/${f.recipientId}`,
    `connectionCodes/code`,
    `pushSubscriptions/device`,
  ]) {
    f.firestore.store.set(path, path === "connectionCodes/code"
      ? { recipientId: f.recipientId }
      : path === "pushSubscriptions/device"
        ? { recipientId: f.recipientId }
        : { private: true });
  }

  const requested = await f.request(false);
  assert.equal(await isCareAccountActive(f.firestore, f.recipientId), false);
  const completed = await processHealthDataReset(f.userId, f.dependencies);

  assert.equal(completed?.status, "completed");
  assert.equal(completed?.verified, true);
  assert.equal(f.authDeletes(), 0);
  assert.equal(await isCareAccountActive(f.firestore, f.recipientId), true);
  const profile = f.firestore.store.get(`careRecipients/${f.recipientId}`) as Record<string, unknown>;
  assert.equal(profile.id, f.recipientId);
  assert.equal(profile.displayName, "");
  assert.deepEqual(profile.allergies, []);
  assert.equal(profile.consentConfirmed, false);
  assert.equal([...f.firestore.store.keys()].some((path) =>
    path.startsWith(`careRecipients/${f.recipientId}/`)), false);
  assert.equal(f.firestore.store.has(`careReadModels/${f.recipientId}`), false);
  assert.equal(f.firestore.store.has(`pushSubscriptions/device`), false);
  assert.equal((await getHealthDataReset(f.userId, f.firestore))?.requestId, requested.requestId);
});

test("선택한 경우 건강정보 검증 후 Firebase 계정을 삭제하고 기존 세션 세대를 폐기한다", async () => {
  const f = fixture();
  f.firestore.store.set(`careRecipients/${f.recipientId}`, { id: f.recipientId, consentConfirmed: true });
  f.firestore.store.set(`careRecipients/${f.recipientId}/symptomEvents/private`, { symptomType: "민감" });
  const requested = await f.request(true);

  const completed = await processHealthDataReset(f.userId, f.dependencies);

  assert.equal(completed?.status, "completed");
  assert.equal(f.authDeletes(), 1);
  assert.equal(f.firestore.store.has(`careRecipients/${f.recipientId}`), false);
  const sessionState = await getAccountSessionState(f.userId, f.firestore);
  assert.equal(sessionState.active, true);
  assert.equal(sessionState.version, requested.requestId);
  assert.ok(sessionState.authValidAfter > Math.floor(Date.parse(requested.requestedAt) / 1000));
});

test("대량·부분 실패 초기화는 완료로 오인하지 않고 남은 데이터부터 재시도한다", async () => {
  const f = fixture();
  f.firestore.store.set(`careRecipients/${f.recipientId}`, { id: f.recipientId, consentConfirmed: true });
  for (let index = 0; index < 205; index++) {
    f.firestore.store.set(`careRecipients/${f.recipientId}/agentRuns/${index}`, { private: true });
  }
  await f.request(false);
  f.firestore.beforeCommit = (operations) => {
    if (operations.some((operation) => operation.kind === "delete")) {
      f.firestore.beforeCommit = undefined;
      throw new Error("INJECTED_RESET_FAILURE");
    }
  };

  assert.equal((await processHealthDataReset(f.userId, f.dependencies))?.status, "failed");
  const resumed = await processHealthDataReset(f.userId, f.dependencies);
  assert.equal(resumed?.status, "pending");
  assert.equal(resumed?.deletedDocuments, 200);
  const completed = await processHealthDataReset(f.userId, f.dependencies);
  assert.equal(completed?.status, "completed");
  assert.equal(completed?.verified, true);
  assert.equal([...f.firestore.store.keys()].some((path) => path.includes("/agentRuns/")), false);
});

test("최근 Google 본인 확인과 정확한 2단계 문구 없이는 초기화 작업을 만들지 않는다", async () => {
  const f = fixture();
  await assert.rejects(requestHealthDataReset({
    userId: f.userId,
    tokenUserId: "different-user",
    authTime: Math.floor(f.clock.now().getTime() / 1000),
    confirmation: "건강정보 삭제",
    deleteFirebaseAccount: false,
  }, f.dependencies), /ACCOUNT_MISMATCH/);
  await assert.rejects(requestHealthDataReset({
    userId: f.userId,
    tokenUserId: f.userId,
    authTime: Math.floor(f.clock.now().getTime() / 1000),
    confirmation: "삭제",
    deleteFirebaseAccount: false,
  }, f.dependencies), /RESET_CONFIRMATION_REQUIRED/);
  assert.equal(await getHealthDataReset(f.userId, f.firestore), null);
});
