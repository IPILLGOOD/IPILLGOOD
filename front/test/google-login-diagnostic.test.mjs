import assert from "node:assert/strict";
import test from "node:test";

import { googleLoginFailure } from "../src/lib/auth/google-login-diagnostic.ts";

test("로컬 에뮬레이터 연결 실패는 실행 명령을 안내한다", () => {
  const failure = googleLoginFailure(new Error("TypeError: fetch failed ECONNREFUSED"), {
    authEmulatorHost: "127.0.0.1:9199",
    nodeEnv: "development",
  });
  assert.equal(failure.clientCode, "firebase_local_emulator_unavailable");
  assert.equal(failure.status, 503);
  assert.match(failure.logMessage, /npm run dev:local/);
});

test("ADC와 IAM 오류는 브라우저 계정과 서버 계정을 구분해 안내한다", () => {
  const failure = googleLoginFailure(new Error("7 PERMISSION_DENIED"), {});
  assert.equal(failure.clientCode, "firebase_server_permission");
  assert.equal(failure.status, 503);
  assert.match(failure.logMessage, /ADC 실행 계정/);
});

test("일반적인 잘못된 토큰은 인증 실패로 유지한다", () => {
  assert.deepEqual(googleLoginFailure(new Error("JWT invalid"), {}), {
    clientCode: "google_login_failed",
    status: 401,
  });
});
