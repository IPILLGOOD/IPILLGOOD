import assert from "node:assert/strict";
import test from "node:test";

import { MemoryFirestore, fixedClock } from "../test-support/memory-firestore.ts";
import {
  CONNECTED_SESSION_DURATION_SECONDS,
  createCareConnectionCode,
  disconnectCareConnection,
  getCareConnection,
  hashConnectionCode,
  redeemCareConnectionCode,
  touchCareConnection,
  validateCareConnectionSession,
} from "./care-connection.ts";
import { deleteRecipientHealthData } from "./health-data-deletion.ts";

const secret = "connection-test-secret-with-more-than-thirty-two-bytes";

test("일회용 코드는 평문을 저장하지 않고 10분 안에 한 번만 교환된다", async () => {
  const firestore = new MemoryFirestore();
  const clock = fixedClock("2026-08-29T00:00:00.000Z");
  const dependencies = { firestore, now: clock.now, codeSecret: secret, randomCode: () => "2345ABCD" };
  const issued = await createCareConnectionCode("owner-1", dependencies);

  assert.equal(issued.code, "2345-ABCD");
  assert.equal([...firestore.store.keys()].some((key) => key.includes("2345ABCD")), false);
  const codeHash = hashConnectionCode(issued.code, secret);
  assert.ok(firestore.store.has(`connectionCodes/${codeHash}`));

  const connected = await redeemCareConnectionCode("2345-abcd", dependencies);
  assert.equal(connected.recipientId, "google-owner-1");
  assert.ok(await validateCareConnectionSession(connected, dependencies));
  await assert.rejects(redeemCareConnectionCode(issued.code, dependencies), /INVALID_CONNECTION_CODE/);
});

test("같은 코드를 동시에 입력해도 한 연결만 성공한다", async () => {
  const firestore = new MemoryFirestore();
  const dependencies = {
    firestore,
    now: () => new Date("2026-08-29T00:00:00.000Z"),
    codeSecret: secret,
    randomCode: () => "6789WXYZ",
  };
  const { code } = await createCareConnectionCode("owner-2", dependencies);
  const results = await Promise.allSettled([
    redeemCareConnectionCode(code, dependencies),
    redeemCareConnectionCode(code, dependencies),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
});

test("활성 연결은 추가 발급을 막고 활동 갱신 후 30일 미사용 시 만료된다", async () => {
  const firestore = new MemoryFirestore();
  const clock = fixedClock("2026-08-29T00:00:00.000Z");
  let nextCode = "CDEF2345";
  const dependencies = { firestore, now: clock.now, codeSecret: secret, randomCode: () => nextCode };
  const issued = await createCareConnectionCode("owner-3", dependencies);
  const connected = await redeemCareConnectionCode(issued.code, dependencies);
  firestore.store.set("pushSubscriptions/connected-device", {
    id: "connected-device", userId: connected.id, recipientId: connected.recipientId, active: true,
  });
  nextCode = "GHJK6789";
  await assert.rejects(createCareConnectionCode("owner-3", dependencies), /CARE_CONNECTION_ALREADY_ACTIVE/);

  clock.advance(15 * 60 * 1000);
  const touched = await touchCareConnection(connected, dependencies);
  assert.equal(touched.lastSeenAt, clock.now().toISOString());
  clock.advance(CONNECTED_SESSION_DURATION_SECONDS * 1000 + 1);
  assert.equal(await validateCareConnectionSession(connected, dependencies), null);
  assert.equal((await getCareConnection("owner-3", dependencies))?.status, "expired");
  assert.equal((firestore.store.get("pushSubscriptions/connected-device") as { active: boolean }).active, false);
});

test("소유자 해제는 세션 버전을 폐기하고 연결 슬롯을 다시 연다", async () => {
  const firestore = new MemoryFirestore();
  const clock = fixedClock("2026-08-29T00:00:00.000Z");
  let nextCode = "MNPQ2345";
  const dependencies = { firestore, now: clock.now, codeSecret: secret, randomCode: () => nextCode };
  const issued = await createCareConnectionCode("owner-4", dependencies);
  const connected = await redeemCareConnectionCode(issued.code, dependencies);
  await disconnectCareConnection("owner-4", dependencies);
  assert.equal(await validateCareConnectionSession(connected, dependencies), null);
  nextCode = "RSTV6789";
  assert.equal((await createCareConnectionCode("owner-4", dependencies)).code, "RSTV-6789");
});

test("계정 영구 삭제는 연결 상태와 사용된 코드 메타데이터도 제거한다", async () => {
  const firestore = new MemoryFirestore();
  const dependencies = {
    firestore,
    now: () => new Date("2026-08-29T00:00:00.000Z"),
    codeSecret: secret,
    randomCode: () => "WXYZ2345",
  };
  const issued = await createCareConnectionCode("owner-5", dependencies);
  await redeemCareConnectionCode(issued.code, dependencies);
  const result = await deleteRecipientHealthData({ firestore, recipientId: "google-owner-5", includeProfile: true });
  assert.equal(result.verified, true);
  assert.equal([...firestore.store.keys()].some((key) => key.startsWith("careConnections/") || key.startsWith("connectionCodes/")), false);
});
