import assert from "node:assert/strict";
import test from "node:test";

import {
  isDemoLoginAllowed,
  sessionSecretBytes,
} from "../src/lib/auth/session-security.ts";

const strongSecret = "8ZeS9wI6kXG2pL1fC4hR7uB0nD5mQ3vT+YxAqNbcPjE=";

test("운영과 데모 여부에 관계없이 누락되거나 약한 세션 비밀키를 거부한다", () => {
  for (const sessionSecret of [
    undefined,
    "short-secret",
    "a".repeat(64),
    "care-atlas-local-demo-session-secret-change-before-deploying",
  ]) {
    assert.throws(() =>
      sessionSecretBytes({ nodeEnv: "production", sessionSecret }),
    );
  }
});

test("충분히 강한 세션 비밀키는 Google과 데모 세션 모두에 사용할 수 있다", () => {
  assert.ok(
    sessionSecretBytes({ nodeEnv: "production", sessionSecret: strongSecret }).byteLength >= 32,
  );
  assert.ok(
    sessionSecretBytes({ nodeEnv: "development", sessionSecret: strongSecret }).byteLength >= 32,
  );
});

test("데모 로그인은 명시적으로 켠 비운영 loopback 요청에만 허용한다", () => {
  assert.equal(
    isDemoLoginAllowed({ demoMode: "true", hostname: "localhost", nodeEnv: "development" }),
    true,
  );
  assert.equal(
    isDemoLoginAllowed({ demoMode: "true", hostname: "127.0.0.1", nodeEnv: "test" }),
    true,
  );

  for (const environment of [
    { demoMode: "false", hostname: "localhost", nodeEnv: "development" },
    { demoMode: "true", hostname: "demo.example.com", nodeEnv: "development" },
    { demoMode: "true", hostname: "localhost", nodeEnv: "production" },
  ]) {
    assert.equal(isDemoLoginAllowed(environment), false);
  }
});
