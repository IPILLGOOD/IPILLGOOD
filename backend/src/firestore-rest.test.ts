import assert from "node:assert/strict";
import test from "node:test";

import { createEmulatorFirestoreRestClient, decodeFirestoreFields, encodeFirestoreFields } from "./firestore-rest.ts";

test("Firestore REST 값 인코딩과 디코딩이 중첩 데이터를 보존한다", () => {
  const input = {
    id: "demo",
    active: true,
    count: 3,
    ratio: 1.5,
    empty: null,
    tags: ["약", "돌봄"],
    nested: { severity: 2, note: "확인" },
    ignored: undefined,
  };

  const decoded = decodeFirestoreFields(encodeFirestoreFields(input));

  assert.deepEqual(decoded, {
    id: "demo",
    active: true,
    count: 3,
    ratio: 1.5,
    empty: null,
    tags: ["약", "돌봄"],
    nested: { severity: 2, note: "확인" },
  });
});

test("REST batch는 모든 작업을 단일 commit으로 전송하고 merge를 서버 field mask로 적용한다", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const firestore = createEmulatorFirestoreRestClient("demo-contract", "127.0.0.1:8080", async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({ writeResults: [] });
  });
  const collection = firestore.collection("contracts");
  await firestore.batch()
    .set(collection.doc("a"), { nested: { enabled: true }, "dotted.key": 1 }, { merge: true })
    .create(collection.doc("b"), { active: false })
    .delete(collection.doc("c"))
    .commit();
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /documents:commit$/);
  const writes = calls[0]!.body.writes as Array<Record<string, unknown>>;
  assert.deepEqual(writes[0]!.updateMask, { fieldPaths: ["`nested`.`enabled`", "`dotted.key`"] });
  assert.deepEqual(writes[1]!.currentDocument, { exists: false });
  assert.equal(writes[2]!.delete, "projects/demo-contract/databases/(default)/documents/contracts/c");
});

test("REST query는 IN과 실행 기한 조건을 structured query로 전송한다", async () => {
  let body: Record<string, unknown> | undefined;
  const firestore = createEmulatorFirestoreRestClient("demo-contract", "127.0.0.1:8080", async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json([]);
  });

  await firestore.collection("accountDeletions")
    .where("status", "in", ["pending", "failed"])
    .where("nextAttemptAt", "<=", "2026-08-23T23:00:00.000Z")
    .orderBy("nextAttemptAt")
    .limit(25)
    .get();

  const query = body?.structuredQuery as Record<string, unknown>;
  const filters = (query.where as { compositeFilter: { filters: Array<{ fieldFilter: Record<string, unknown> }> } }).compositeFilter.filters;
  assert.deepEqual(filters[0]!.fieldFilter, {
    field: { fieldPath: "status" },
    op: "IN",
    value: { arrayValue: { values: [{ stringValue: "pending" }, { stringValue: "failed" }] } },
  });
  assert.deepEqual(filters[1]!.fieldFilter, {
    field: { fieldPath: "nextAttemptAt" },
    op: "LESS_THAN_OR_EQUAL",
    value: { stringValue: "2026-08-23T23:00:00.000Z" },
  });
  assert.deepEqual(query.orderBy, [{ field: { fieldPath: "nextAttemptAt" }, direction: "ASCENDING" }]);
  assert.equal(query.limit, 25);
});

test("REST 트랜잭션은 ABORTED 충돌에서 읽기와 쓰기를 함께 재시도한다", async () => {
  let attempts = 0;
  let commits = 0;
  const firestore = createEmulatorFirestoreRestClient("demo-contract", "127.0.0.1:8080", async (url, init) => {
    const address = String(url);
    if (address.endsWith(":beginTransaction")) return Response.json({ transaction: `tx-${++attempts}` });
    if (address.endsWith(":rollback")) return Response.json({});
    if (address.endsWith(":batchGet")) return Response.json([{ found: { fields: { count: { integerValue: String(attempts) } } } }]);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.transaction, `tx-${attempts}`);
    if (++commits === 1) return Response.json({ error: { status: "ABORTED" } }, { status: 409 });
    return Response.json({});
  });
  const ref = firestore.collection("contracts").doc("counter");
  const result = await firestore.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data() as { count: number };
    tx.set(ref, { count: current.count + 1 });
    return current.count + 1;
  });
  assert.equal(result, 3);
  assert.equal(commits, 2);
});
