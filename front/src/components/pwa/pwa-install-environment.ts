export type InstallGuideMode =
  | "ios"
  | "android-firefox"
  | "android-samsung"
  | "android-manual"
  | "manual";

export interface InstallEnvironment {
  browserLabel: string;
  guideMode: InstallGuideMode;
  platformLabel: string;
}

interface NavigatorDetails {
  maxTouchPoints?: number;
  platform?: string;
  userAgent: string;
}

export const fallbackInstallEnvironment: InstallEnvironment = {
  browserLabel: "모바일 브라우저",
  guideMode: "manual",
  platformLabel: "모바일",
};

export function detectInstallEnvironment({
  maxTouchPoints = 0,
  platform = "",
  userAgent,
}: NavigatorDetails): InstallEnvironment {
  const isIos =
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1);

  if (isIos) {
    const browserLabel = /CriOS/i.test(userAgent)
      ? "Chrome"
      : /FxiOS/i.test(userAgent)
        ? "Firefox"
        : /EdgiOS/i.test(userAgent)
          ? "Edge"
          : "Safari";

    return {
      browserLabel,
      guideMode: "ios",
      platformLabel: /iPad/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1)
        ? "iPad"
        : "iPhone",
    };
  }

  if (/Android/i.test(userAgent)) {
    if (/Firefox|Fennec/i.test(userAgent)) {
      return {
        browserLabel: "Firefox",
        guideMode: "android-firefox",
        platformLabel: "Android",
      };
    }

    if (/SamsungBrowser/i.test(userAgent)) {
      return {
        browserLabel: "Samsung Internet",
        guideMode: "android-samsung",
        platformLabel: "Android",
      };
    }

    const browserLabel = /EdgA/i.test(userAgent)
      ? "Edge"
      : /OPR|Opera/i.test(userAgent)
        ? "Opera"
        : /Chrome/i.test(userAgent)
          ? "Chrome"
          : "모바일 브라우저";

    return {
      browserLabel,
      guideMode: "android-manual",
      platformLabel: "Android",
    };
  }

  return fallbackInstallEnvironment;
}
