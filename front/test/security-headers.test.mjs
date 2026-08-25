import assert from "node:assert/strict";
import test from "node:test";

import {
  apiContentSecurityPolicy,
  commonSecurityHeaders,
  contentSecurityPolicy,
  cspResponseHeaderName,
  serviceWorkerContentSecurityPolicy,
} from "../src/lib/security-headers.ts";

test("운영 HTML CSP는 요청 nonce와 필요한 Firebase 브라우저 출처만 허용한다", () => {
  const policy = contentSecurityPolicy({
    development: false,
    nonce: "nonce-value",
    upgradeInsecureRequests: true,
  });
  for (const directive of [
    "default-src",
    "script-src",
    "style-src",
    "img-src",
    "font-src",
    "connect-src",
    "frame-src",
    "frame-ancestors",
    "base-uri",
    "form-action",
    "object-src",
  ]) {
    assert.match(policy, new RegExp(`(?:^|; )${directive} `));
  }
  assert.match(policy, /script-src[^;]+'nonce-nonce-value'[^;]+'strict-dynamic'/);
  assert.match(policy, /connect-src[^;]+identitytoolkit\.googleapis\.com/);
  assert.match(policy, /connect-src[^;]+securetoken\.googleapis\.com/);
  assert.match(policy, /frame-src[^;]+care-atlas-seoul-2026-v2\.firebaseapp\.com/);
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval|\*/);
  assert.doesNotMatch(policy, /api\.openai\.com|apis\.data\.go\.kr/);
  assert.match(policy, /upgrade-insecure-requests/);
});

test("개발 CSP만 React 디버깅과 스타일용 임시 예외를 허용한다", () => {
  const policy = contentSecurityPolicy({ development: true, nonce: "dev-nonce" });
  assert.match(policy, /'unsafe-eval'/);
  assert.match(policy, /style-src[^;]+'unsafe-inline'/);
  assert.doesNotMatch(policy, /upgrade-insecure-requests/);
});

test("API와 서비스 워커는 문서 CSP보다 더 좁은 정책을 사용한다", () => {
  assert.equal(apiContentSecurityPolicy.includes("default-src 'none'"), true);
  assert.equal(apiContentSecurityPolicy.includes("form-action 'none'"), true);
  assert.equal(serviceWorkerContentSecurityPolicy.includes("connect-src 'self'"), true);
  assert.equal(serviceWorkerContentSecurityPolicy.includes("https:"), false);
});

test("공통 헤더와 CSP report-only/enforce 전환을 회귀 검증한다", () => {
  const productionHeaders = Object.fromEntries(
    commonSecurityHeaders(true).map(({ key, value }) => [key.toLowerCase(), value]),
  );
  assert.equal(productionHeaders["x-content-type-options"], "nosniff");
  assert.equal(productionHeaders["referrer-policy"], "no-referrer");
  assert.match(productionHeaders["permissions-policy"], /camera=\(\)/);
  assert.match(productionHeaders["strict-transport-security"], /max-age=31536000/);
  assert.equal(
    commonSecurityHeaders(false).some(({ key }) => key === "Strict-Transport-Security"),
    false,
  );
  assert.equal(cspResponseHeaderName("report-only"), "Content-Security-Policy-Report-Only");
  assert.equal(cspResponseHeaderName("enforce"), "Content-Security-Policy");
  assert.equal(cspResponseHeaderName(undefined), "Content-Security-Policy");
});
