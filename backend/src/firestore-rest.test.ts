import assert from "node:assert/strict";
import test from "node:test";

import { decodeFirestoreFields, encodeFirestoreFields } from "./firestore-rest.ts";

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
