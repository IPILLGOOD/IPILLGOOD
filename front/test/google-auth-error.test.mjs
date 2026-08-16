import assert from "node:assert/strict";
import test from "node:test";

import {
  getGoogleAuthErrorMessage,
  googleAuthServerError,
} from "../src/lib/auth/google-error.ts";

test("Firebase Authentication 미초기화 오류를 운영자가 조치할 수 있게 안내한다", () => {
  assert.equal(
    getGoogleAuthErrorMessage({ code: "auth/configuration-not-found" }),
    "Google 로그인 설정이 완료되지 않았어요. 관리자에게 알려주세요.",
  );
});

test("승인되지 않은 배포 도메인을 구체적으로 안내한다", () => {
  assert.equal(
    getGoogleAuthErrorMessage({ code: "auth/unauthorized-domain" }),
    "현재 접속 주소가 Google 로그인에 등록되지 않았어요.",
  );
});

test("서버 세션 생성 실패와 알 수 없는 오류를 안전하게 구분한다", () => {
  assert.equal(
    getGoogleAuthErrorMessage(googleAuthServerError("google_login_failed")),
    "Google 계정은 확인했지만 로그인 세션을 만들지 못했어요. 잠시 후 다시 시도해주세요.",
  );
  assert.equal(
    getGoogleAuthErrorMessage({ code: "auth/unexpected" }),
    "Google 로그인을 완료하지 못했어요. 다시 시도해주세요.",
  );
});
