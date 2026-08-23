import assert from "node:assert/strict";
import test from "node:test";

import {
  detectPushEnvironment,
  shouldShowPushNotificationSection,
} from "../src/lib/push/environment.ts";

test("iPhone Safari를 iOS Safari 환경으로 식별한다", () => {
  const result = detectPushEnvironment(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 Version/18.4 Mobile/15E148 Safari/604.1",
  );
  assert.deepEqual(result, { platform: "ios", browser: "safari", isIos: true });
});

test("iPhone Chrome도 iOS의 Chrome 설치 경로로 식별한다", () => {
  const result = detectPushEnvironment(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 CriOS/136.0 Mobile/15E148 Safari/604.1",
  );
  assert.deepEqual(result, { platform: "ios", browser: "chrome", isIos: true });
});

test("Android Chrome과 macOS Safari를 구분한다", () => {
  const android = detectPushEnvironment(
    "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/136.0 Mobile Safari/537.36",
  );
  const macSafari = detectPushEnvironment(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_5) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15",
  );
  assert.equal(android.platform, "android");
  assert.equal(android.browser, "chrome");
  assert.equal(macSafari.platform, "macos");
  assert.equal(macSafari.browser, "safari");
});

test("PC 일반 브라우저에서는 알림 섹션을 숨긴다", () => {
  assert.equal(
    shouldShowPushNotificationSection({ platform: "macos", standalone: false }),
    false,
  );
  assert.equal(
    shouldShowPushNotificationSection({ platform: "windows", standalone: false }),
    false,
  );
  assert.equal(
    shouldShowPushNotificationSection({ platform: "other", standalone: false }),
    false,
  );
});

test("설치형 PWA와 모바일 설치 안내 환경에서는 알림 섹션을 표시한다", () => {
  assert.equal(
    shouldShowPushNotificationSection({ platform: "macos", standalone: true }),
    true,
  );
  assert.equal(
    shouldShowPushNotificationSection({ platform: "ios", standalone: false }),
    true,
  );
  assert.equal(
    shouldShowPushNotificationSection({ platform: "android", standalone: false }),
    true,
  );
});
