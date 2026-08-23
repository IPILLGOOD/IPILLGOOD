export type PushPlatform = "ios" | "android" | "macos" | "windows" | "other";
export type PushBrowser = "chrome" | "safari" | "edge" | "firefox" | "other";

export interface PushEnvironment {
  platform: PushPlatform;
  browser: PushBrowser;
  isIos: boolean;
}

export function shouldShowPushNotificationSection(input: {
  platform: PushPlatform;
  standalone: boolean;
}) {
  return (
    input.standalone ||
    input.platform === "ios" ||
    input.platform === "android"
  );
}

export function detectPushEnvironment(userAgent: string): PushEnvironment {
  const isIos = /iPhone|iPad|iPod/i.test(userAgent);
  const platform: PushPlatform = isIos
    ? "ios"
    : /Android/i.test(userAgent)
      ? "android"
      : /Macintosh|Mac OS X/i.test(userAgent)
        ? "macos"
        : /Windows/i.test(userAgent)
          ? "windows"
          : "other";
  const browser: PushBrowser = /Edg\//i.test(userAgent)
    ? "edge"
    : /Firefox|FxiOS/i.test(userAgent)
      ? "firefox"
      : /Chrome|CriOS/i.test(userAgent)
        ? "chrome"
        : /Safari/i.test(userAgent)
          ? "safari"
          : "other";
  return { platform, browser, isIos };
}

export function isStandalonePwa() {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigatorWithStandalone.standalone === true
  );
}
