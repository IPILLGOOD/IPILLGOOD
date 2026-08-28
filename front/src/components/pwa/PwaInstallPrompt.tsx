"use client";

import { Download, HeartPulse, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  InstallEnvironmentBadge,
  PwaInstallGuide,
  type ActiveInstallMode,
} from "./PwaInstallGuide";
import {
  detectInstallEnvironment,
  fallbackInstallEnvironment,
} from "./pwa-install-environment";

const NEVER_SHOW_KEY = "ipillgood:pwa-install-prompt:hidden";
const SESSION_DISMISSED_KEY = "ipillgood:pwa-install-prompt:session-dismissed";
const MOBILE_VIEWPORT_QUERY = "(max-width: 959px)";
const STANDALONE_QUERY = "(display-mode: standalone)";
const PROMPT_DELAY_MS = 900;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function storageHas(storage: Storage, key: string) {
  try {
    return storage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function storageSet(storage: Storage, key: string) {
  try {
    storage.setItem(key, "true");
  } catch {
    // Storage can be unavailable in private or restricted browsing modes.
  }
}

function isRunningStandalone() {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia(STANDALONE_QUERY).matches || navigatorWithStandalone.standalone === true
  );
}

export function PwaInstallPrompt() {
  const pathname = usePathname();
  const [isVisible, setIsVisible] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [environment] = useState(() =>
    typeof navigator === "undefined"
      ? fallbackInstallEnvironment
      : detectInstallEnvironment({
          maxTouchPoints: navigator.maxTouchPoints,
          platform: navigator.platform,
          userAgent: navigator.userAgent,
        }),
  );
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const installEventRef = useRef<BeforeInstallPromptEvent | null>(null);
  const isPublicPage = pathname === "/" || pathname === "/login";
  const mode: ActiveInstallMode = installEvent ? "native" : environment.guideMode;

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => undefined);
    }

    const mobileQuery = window.matchMedia(MOBILE_VIEWPORT_QUERY);
    const standaloneQuery = window.matchMedia(STANDALONE_QUERY);
    let showTimer: ReturnType<typeof setTimeout> | undefined;

    const canShow = () =>
      mobileQuery.matches &&
      !standaloneQuery.matches &&
      !isRunningStandalone() &&
      !storageHas(window.localStorage, NEVER_SHOW_KEY) &&
      !storageHas(window.sessionStorage, SESSION_DISMISSED_KEY);

    const schedulePrompt = () => {
      if (showTimer) clearTimeout(showTimer);
      if (!canShow()) {
        setIsVisible(false);
        return;
      }
      showTimer = setTimeout(() => setIsVisible(true), PROMPT_DELAY_MS);
    };

    const handleInstallAvailable = (event: Event) => {
      event.preventDefault();
      const promptEvent = event as BeforeInstallPromptEvent;
      installEventRef.current = promptEvent;
      setInstallEvent(promptEvent);
      schedulePrompt();
    };

    const handleInstalled = () => {
      setIsVisible(false);
      installEventRef.current = null;
      setInstallEvent(null);
    };

    const handleDisplayModeChange = () => schedulePrompt();

    schedulePrompt();
    window.addEventListener("beforeinstallprompt", handleInstallAvailable);
    window.addEventListener("appinstalled", handleInstalled);
    mobileQuery.addEventListener("change", handleDisplayModeChange);
    standaloneQuery.addEventListener("change", handleDisplayModeChange);

    return () => {
      if (showTimer) clearTimeout(showTimer);
      window.removeEventListener("beforeinstallprompt", handleInstallAvailable);
      window.removeEventListener("appinstalled", handleInstalled);
      mobileQuery.removeEventListener("change", handleDisplayModeChange);
      standaloneQuery.removeEventListener("change", handleDisplayModeChange);
    };
  }, []);

  const closeForSession = () => {
    storageSet(window.sessionStorage, SESSION_DISMISSED_KEY);
    setIsVisible(false);
  };

  const neverShowAgain = () => {
    storageSet(window.localStorage, NEVER_SHOW_KEY);
    setIsVisible(false);
  };

  const installApp = async () => {
    const promptEvent = installEventRef.current;
    if (!promptEvent || isInstalling) return;

    setIsInstalling(true);
    try {
      await promptEvent.prompt();
      await promptEvent.userChoice;
      storageSet(window.sessionStorage, SESSION_DISMISSED_KEY);
      installEventRef.current = null;
      setInstallEvent(null);
      setIsVisible(false);
    } finally {
      setIsInstalling(false);
    }
  };

  // Account verification/deletion must not compete with a second dialog.
  if (!isVisible || pathname === "/profile" || pathname === "/account/recovery") return null;

  return (
    <aside
      className={`pwa-install${isPublicPage ? "" : " pwa-install--above-nav"}`}
      role="dialog"
      aria-labelledby="pwa-install-title"
      aria-describedby="pwa-install-description"
    >
      <div className="pwa-install__heading">
        <span className="pwa-install__app-icon" aria-hidden="true">
          <HeartPulse size={23} strokeWidth={2.3} />
        </span>
        <div>
          <p className="pwa-install__eyebrow">홈 화면에서 더 편하게</p>
          <h2 id="pwa-install-title">IPILLGOOD를 앱으로 사용해 보세요</h2>
        </div>
        <button
          className="pwa-install__close"
          type="button"
          onClick={closeForSession}
          aria-label="PWA 설치 안내 닫기"
        >
          <X size={21} aria-hidden="true" />
        </button>
      </div>

      <p id="pwa-install-description" className="pwa-install__description">
        주소를 다시 찾지 않아도 홈 화면에서 바로 열어 오늘의 복약과 안부를 확인할 수 있어요.
      </p>

      <InstallEnvironmentBadge
        environment={environment}
        canInstallDirectly={mode === "native"}
      />
      <PwaInstallGuide mode={mode} />

      <div className="pwa-install__actions">
        {mode === "native" ? (
          <button
            className="button button--primary pwa-install__install-button"
            type="button"
            onClick={installApp}
            disabled={isInstalling}
          >
            <Download size={18} aria-hidden="true" />
            {isInstalling ? "설치창 여는 중…" : "앱으로 설치"}
          </button>
        ) : null}
        <div className="pwa-install__dismiss-actions">
          <button type="button" className="button button--quiet" onClick={neverShowAgain}>
            다시 보지 않기
          </button>
          <button type="button" className="button button--secondary" onClick={closeForSession}>
            닫기
          </button>
        </div>
      </div>
    </aside>
  );
}
