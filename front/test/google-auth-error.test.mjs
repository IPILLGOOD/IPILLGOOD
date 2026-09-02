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

test("로컬 에뮬레이터와 서버 IAM 오류는 개발자가 조치할 수 있게 구분한다", () => {
  assert.equal(
    getGoogleAuthErrorMessage(googleAuthServerError("firebase_local_emulator_unavailable")),
    "로컬 인증 서버에 연결하지 못했어요. 프로젝트 루트에서 npm run dev:local을 다시 실행해주세요.",
  );
  assert.equal(
    getGoogleAuthErrorMessage(googleAuthServerError("firebase_server_permission")),
    "서버의 Firebase 접근 권한이 부족해요. 개발자는 로컬 Emulator 실행 또는 ADC 권한을 확인해주세요.",
  );
});

test("PWA redirect 결과 누락과 popup timeout을 다시 시도 가능한 오류로 안내한다", () => {
  assert.equal(
    getGoogleAuthErrorMessage({ code: "auth/redirect-result-missing" }),
    "Google 로그인 결과가 앱으로 돌아오지 않았어요. 다시 시도해주세요.",
  );
  assert.equal(
    getGoogleAuthErrorMessage({ code: "auth/popup-timeout" }),
    "Google 로그인 응답이 늦어지고 있어요. 다시 시도해주세요.",
  );
});
