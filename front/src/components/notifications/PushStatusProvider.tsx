"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { disablePushNotifications, enablePushNotifications, type PushClientState } from "@/lib/push/client";
import { PUSH_LOGOUT_EVENT } from "@/lib/push/browser-cleanup";
import { createPushRefresher } from "@/lib/push/auto-reconnect";
import { detectPushEnvironment, isStandalonePwa, shouldShowPushNotificationSection } from "@/lib/push/environment";
import { observePushReentry } from "@/lib/push/refresh-lifecycle";

type BusyAction = "enable" | "disable" | null;
type PushStatus = {
  client: PushClientState | null;
  error: string;
  busy: BusyAction;
  checking: boolean;
  refresh: () => Promise<void>;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
};
const PushContext = createContext<PushStatus | null>(null);

export function PushStatusProvider({ children, enabled, sessionKey }: { children: React.ReactNode; enabled: boolean; sessionKey: string }) {
  const pathname = usePathname();
  const [client, setClient] = useState<PushClientState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<BusyAction>(null);
  const [checking, setChecking] = useState(false);
  const alive = useRef(false);
  const generation = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const mutation = useRef(false);
  const mutationAbort = useRef<AbortController | null>(null);
  const refreshAbort = useRef<AbortController | null>(null);
  const refreshClient = useRef(createPushRefresher(Date.now, sessionKey));

  const refresh = useCallback(async () => {
    if (!enabled || !alive.current || mutation.current || document.visibilityState !== "visible") return;
    if (inFlight.current) return inFlight.current;
    const environment = detectPushEnvironment(navigator.userAgent);
    if (!shouldShowPushNotificationSection({ platform: environment.platform, standalone: isStandalonePwa() })) return;
    const version = generation.current;
    const controller = new AbortController();
    refreshAbort.current = controller;
    setChecking(true);
    const work = (async () => {
      try {
        const state = await refreshClient.current(controller.signal);
        if (alive.current && version === generation.current) { setClient(state); setError(""); }
      } catch {
        if (alive.current && version === generation.current) {
          setClient(null);
          setError("알림 연결을 확인하지 못했어요. 네트워크 연결 후 다시 확인해 주세요.");
        }
      } finally {
        if (alive.current && version === generation.current) setChecking(false);
      }
    })();
    inFlight.current = work;
    try { await work; } finally { if (inFlight.current === work) inFlight.current = null; }
  }, [enabled]);

  useEffect(() => {
    generation.current++;
    alive.current = true;
    const stopForLogout = () => { alive.current = false; generation.current++; refreshAbort.current?.abort(); mutationAbort.current?.abort(); };
    window.addEventListener(PUSH_LOGOUT_EVENT, stopForLogout);
    const stop = observePushReentry(() => { queueMicrotask(() => { void refresh(); }); }, document, window, window.matchMedia("(display-mode: standalone)"));
    return () => { window.removeEventListener(PUSH_LOGOUT_EVENT, stopForLogout); alive.current = false; inFlight.current = null; refreshAbort.current?.abort(); mutationAbort.current?.abort(); stop(); };
  }, [refresh]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void refresh(); });
    return () => { active = false; };
  }, [pathname, refresh]);

  const act = async (action: Exclude<BusyAction, null>) => {
    if (mutation.current || !alive.current) return;
    mutation.current = true;
    const controller = new AbortController();
    mutationAbort.current = controller;
    generation.current++;
    refreshAbort.current?.abort();
    setBusy(action);
    setError("");
    await inFlight.current;
    try {
      controller.signal.throwIfAborted();
      if (action === "enable") await enablePushNotifications(controller.signal, sessionKey);
      else await disablePushNotifications(controller.signal, sessionKey);
    } catch {
      if (alive.current) setError("알림 연결 변경을 완료하지 못했어요. 상태를 다시 확인한 뒤 재시도해 주세요.");
      return;
    } finally {
      mutation.current = false;
      if (alive.current) { setBusy(null); setClient(null); setChecking(false); }
    }
    await refresh();
  };

  return <PushContext.Provider value={{ client, error, busy, checking, refresh, enable: () => act("enable"), disable: () => act("disable") }}>{children}</PushContext.Provider>;
}

export function usePushStatus() {
  const context = useContext(PushContext);
  if (!context) throw new Error("PushStatusProvider is required");
  return context;
}
