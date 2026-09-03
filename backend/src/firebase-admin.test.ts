import assert from "node:assert/strict";
import test from "node:test";

import { assertSafeFirestoreEmulator } from "./firebase-admin.ts";

test("Firestore emulator는 demo 프로젝트와 loopback 조합만 허용한다", () => {
  assert.doesNotThrow(() => assertSafeFirestoreEmulator("demo-ipillgood-local", "127.0.0.1:8181"));
  assert.doesNotThrow(() => assertSafeFirestoreEmulator("care-atlas-seoul-2026-v3", undefined));
  assert.throws(() => assertSafeFirestoreEmulator("care-atlas-seoul-2026-v3", "127.0.0.1:8181"));
  assert.throws(() => assertSafeFirestoreEmulator("demo-ipillgood-local", "firestore.example.com:8181"));
});
