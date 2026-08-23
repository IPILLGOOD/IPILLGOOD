import assert from "node:assert/strict";
import test from "node:test";

import { detectInstallEnvironment } from "../src/components/pwa/pwa-install-environment.ts";

test("iOS 브라우저는 공유 메뉴 설치 안내로 분류한다", () => {
  const safari = detectInstallEnvironment({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
  });
  const chrome = detectInstallEnvironment({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/140.0 Mobile/15E148 Safari/604.1",
  });

  assert.deepEqual(safari, {
    browserLabel: "Safari",
    guideMode: "ios",
    platformLabel: "iPhone",
  });
  assert.deepEqual(chrome, {
    browserLabel: "Chrome",
    guideMode: "ios",
    platformLabel: "iPhone",
  });
});

test("터치 기반 iPad 데스크톱 UA도 iOS 안내로 분류한다", () => {
  assert.deepEqual(
    detectInstallEnvironment({
      maxTouchPoints: 5,
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Safari/605.1.15",
    }),
    {
      browserLabel: "Safari",
      guideMode: "ios",
      platformLabel: "iPad",
    },
  );
});

test("Android Firefox와 Samsung Internet에 전용 안내를 제공한다", () => {
  const firefox = detectInstallEnvironment({
    userAgent: "Mozilla/5.0 (Android 15; Mobile; rv:141.0) Gecko/141.0 Firefox/141.0",
  });
  const samsung = detectInstallEnvironment({
    userAgent:
      "Mozilla/5.0 (Linux; Android 15; SM-S938N) AppleWebKit/537.36 Chrome/138.0 Mobile Safari/537.36 SamsungBrowser/28.0",
  });

  assert.equal(firefox.guideMode, "android-firefox");
  assert.equal(firefox.browserLabel, "Firefox");
  assert.equal(samsung.guideMode, "android-samsung");
  assert.equal(samsung.browserLabel, "Samsung Internet");
});

test("Android Chromium 계열은 브라우저 이름과 공통 수동 안내를 제공한다", () => {
  const chrome = detectInstallEnvironment({
    userAgent:
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36",
  });
  const edge = detectInstallEnvironment({
    userAgent:
      "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36 EdgA/140.0",
  });

  assert.equal(chrome.browserLabel, "Chrome");
  assert.equal(chrome.guideMode, "android-manual");
  assert.equal(edge.browserLabel, "Edge");
  assert.equal(edge.guideMode, "android-manual");
});
