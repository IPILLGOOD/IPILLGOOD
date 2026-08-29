"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import {
  CARE_CONNECTION_ACTIVITY_INTERVAL_MS,
  CARE_SYNC_POLL_INTERVAL_MS,
  careSyncFailureDelay,
  retryAfterMilliseconds,
  shouldPollCareRevision,
} from "@/lib/care-sync";


export function CareSyncProvider({
  children,
  enabled,
  connected,
}: {
  children: React.ReactNode;
  enabled: boolean;
  connected: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const revision = useRef<number | null>(null);
  const inFlight = useRef(false);
  const retryAt = useRef(0);
  const failures = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const unauthorized = () => { router.replace(`/login?next=${encodeURIComponent(pathname)}`); };
    const check = async () => {
      if (stopped || !shouldPollCareRevision({
        visible: document.visibilityState === "visible",
        online: navigator.onLine,
        inFlight: inFlight.current,
        retryAt: retryAt.current,
        now: Date.now(),
      })) return;
      inFlight.current = true;
      try {
        const response = await fetch("/api/care/revision", { cache: "no-store", credentials: "same-origin" });
        if (response.status === 401) { unauthorized(); return; }
        if (response.status === 429) {
          retryAt.current = Date.now() + retryAfterMilliseconds(response.headers.get("Retry-After"));
          return;
        }
        if (!response.ok) throw new Error("revision_unavailable");
        const body = await response.json() as { revision?: unknown };
        if (!Number.isSafeInteger(body.revision)) throw new Error("invalid_revision");
        failures.current = 0;
        retryAt.current = 0;
        if (revision.current !== null && revision.current !== body.revision) router.refresh();
        revision.current = body.revision as number;
      } catch {
        failures.current += 1;
        retryAt.current = Date.now() + careSyncFailureDelay(failures.current);
      } finally {
        inFlight.current = false;
      }
    };
    const timer = window.setInterval(() => { void check(); }, CARE_SYNC_POLL_INTERVAL_MS);
    const wake = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    void check();
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
    };
  }, [enabled, pathname, router]);

  useEffect(() => {
    if (!enabled || !connected) return;
    let stopped = false;
    const touch = async () => {
      if (stopped || document.visibilityState !== "visible" || !navigator.onLine) return;
      try {
        const response = await fetch("/api/auth/connection/activity", { method: "POST", credentials: "same-origin" });
        if (response.status === 401) router.replace("/login");
      } catch { /* 다음 활동 주기 또는 revision 인증에서 다시 확인합니다. */ }
    };
    const timer = window.setInterval(() => { void touch(); }, CARE_CONNECTION_ACTIVITY_INTERVAL_MS);
    const wake = () => { if (document.visibilityState === "visible") void touch(); };
    document.addEventListener("visibilitychange", wake);
    void touch();
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [connected, enabled, router]);

  return children;
}
