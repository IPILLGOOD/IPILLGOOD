import assert from "node:assert/strict";
import test from "node:test";

import {
  FIREBASE_DEFAULT_AUTH_DOMAIN,
  firebaseAuthDomain,
  googleAuthMode,
  hasGoogleRedirectMarker,
  urlWithGoogleRedirectMarker,
  urlWithoutGoogleRedirectMarker,
  withGoogleAuthTimeout,
} from "../src/lib/auth/google-auth-flow.ts";

test("설치형 PWA와 모바일 브라우저는 redirect 로그인을 사용한다", () => {
  assert.equal(
    googleAuthMode({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X)",
      displayModeStandalone: false,
      navigatorStandalone: false,
    }),
    "redirect",
  );
  assert.equal(
    googleAuthMode({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_5)",
      displayModeStandalone: true,
      navigatorStandalone: false,
    }),
    "redirect",
  );
  assert.equal(
    googleAuthMode({
      userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/136.0",
      displayModeStandalone: false,
      navigatorStandalone: false,
    }),
    "popup",
  );
});

test("운영 redirect는 현재 도메인의 인증 프록시를 사용하고 로컬은 Firebase 기본 도메인을 사용한다", () => {
  assert.equal(
    firebaseAuthDomain("redirect", {
      protocol: "https:",
      hostname: "ipillgood.wkddudgk4869.workers.dev",
      host: "ipillgood.wkddudgk4869.workers.dev",
    }),
    "ipillgood.wkddudgk4869.workers.dev",
  );
  assert.equal(
    firebaseAuthDomain("redirect", {
      protocol: "http:",
      hostname: "localhost",
      host: "localhost:3000",
    }),
    FIREBASE_DEFAULT_AUTH_DOMAIN,
  );
  assert.equal(
    firebaseAuthDomain("popup", {
      protocol: "https:",
      hostname: "ipillgood.wkddudgk4869.workers.dev",
      host: "ipillgood.wkddudgk4869.workers.dev",
    }),
    FIREBASE_DEFAULT_AUTH_DOMAIN,
  );
});

test("redirect 복귀 표식을 URL에 추가하고 완료 후 제거한다", () => {
  const marked = urlWithGoogleRedirectMarker("https://example.com/login?next=%2Ftoday");
  assert.equal(hasGoogleRedirectMarker(new URL(marked).search), true);
  assert.equal(
    urlWithoutGoogleRedirectMarker(marked),
    "https://example.com/login?next=%2Ftoday",
  );
});

test("응답 없는 인증 작업은 지정한 오류 코드로 종료한다", async () => {
  await assert.rejects(
    withGoogleAuthTimeout(new Promise(() => undefined), 5, "auth/popup-timeout"),
    (error) => error?.code === "auth/popup-timeout",
  );
});
