import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_AUTH_HOST,
  LOCAL_FIREBASE_PROJECT_ID,
  LOCAL_FIRESTORE_HOST,
  localFirebaseEnvironment,
  parseJavaMajorVersion,
} from "../../scripts/local-dev-config.mjs";

test("로컬 실행 환경은 실제 자격 증명을 제거하고 demo 에뮬레이터만 사용한다", () => {
  const environment = localFirebaseEnvironment({
    FIREBASE_SERVICE_ACCOUNT_JSON: "sensitive",
    GOOGLE_APPLICATION_CREDENTIALS: "/sensitive/key.json",
  });
  assert.equal(environment.FIREBASE_PROJECT_ID, LOCAL_FIREBASE_PROJECT_ID);
  assert.equal(environment.FIRESTORE_EMULATOR_HOST, LOCAL_FIRESTORE_HOST);
  assert.equal(environment.FIREBASE_AUTH_EMULATOR_HOST, LOCAL_AUTH_HOST);
  assert.equal(environment.NEXT_PUBLIC_FIREBASE_PROJECT_ID, LOCAL_FIREBASE_PROJECT_ID);
  assert.equal(environment.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST, LOCAL_AUTH_HOST);
  assert.equal(environment.FIREBASE_SERVICE_ACCOUNT_JSON, "");
  assert.equal(environment.GOOGLE_APPLICATION_CREDENTIALS, "");
  assert.ok(environment.SESSION_SECRET.length >= 64);
});

test("Java 주 버전을 일반 JDK 출력에서 확인한다", () => {
  assert.equal(parseJavaMajorVersion('openjdk version "21.0.12" 2026-07-21'), 21);
  assert.equal(parseJavaMajorVersion('java version "1.8.0_402"'), 8);
  assert.equal(parseJavaMajorVersion("unknown"), undefined);
});
