import assert from "node:assert/strict";
import test from "node:test";

import {
  firebaseEmulatorOrigin,
  localFirebaseAuthEmulator,
} from "../src/lib/auth/firebase-emulator-config.ts";

test("브라우저 에뮬레이터는 demo 프로젝트의 loopback 주소만 허용한다", () => {
  assert.equal(firebaseEmulatorOrigin("demo-ipillgood-local", "127.0.0.1:9199"), "http://127.0.0.1:9199");
  assert.equal(firebaseEmulatorOrigin("care-atlas-seoul-2026-v2", undefined), undefined);
  assert.throws(() => firebaseEmulatorOrigin("care-atlas-seoul-2026-v2", "127.0.0.1:9199"));
  assert.throws(() => firebaseEmulatorOrigin("demo-ipillgood-local", "auth.example.com:9199"));
});

test("서버의 로컬 토큰 경로는 development에서 Auth와 Firestore가 함께 있을 때만 열린다", () => {
  const environment = {
    authHost: "127.0.0.1:9199",
    firestoreHost: "127.0.0.1:8181",
    projectId: "demo-ipillgood-local",
  };
  assert.deepEqual(localFirebaseAuthEmulator({ ...environment, nodeEnv: "development" }), {
    authOrigin: "http://127.0.0.1:9199",
    projectId: "demo-ipillgood-local",
  });
  assert.equal(localFirebaseAuthEmulator({ ...environment, nodeEnv: "production" }), undefined);
  assert.throws(() => localFirebaseAuthEmulator({ ...environment, firestoreHost: undefined, nodeEnv: "development" }));
});
