import { withPushLifecycleLock } from "./lifecycle-lock.ts";
import { withPushTimeout } from "./key-validation.ts";

export const PUSH_LOGOUT_EVENT = "ipillgood:push-logout";
const PENDING_KEY = "ipillgood:push-cleanup-pending";
const DEVICE_KEY = "ipillgood:push-device-id";

export function markPushCleanupPending() {
  try { window.localStorage.setItem(PENDING_KEY, "true"); } catch { /* Server authorization still fails closed. */ }
}

export async function clearBrowserPush() {
  if ("serviceWorker" in navigator) {
    // getRegistration does not hang on browsers that have never installed a worker.
    const registration = await withPushTimeout(navigator.serviceWorker.getRegistration("/"));
    if (registration) {
      const subscription = await withPushTimeout(registration.pushManager.getSubscription());
      for (const notification of await withPushTimeout(registration.getNotifications())) notification.close();
      if (subscription && !await withPushTimeout(subscription.unsubscribe())) throw new Error("PUSH_CLEANUP_PENDING");
    }
  }
  window.localStorage.removeItem(DEVICE_KEY);
  window.localStorage.removeItem(PENDING_KEY);
}

export async function finishPendingBrowserCleanup() {
  if (window.localStorage.getItem(PENDING_KEY) === "true") await clearBrowserPush();
}

/** Also mounted on public pages so a failed logout cleanup survives session removal. */
export function observePushCleanup() {
  let stopped = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const retry = async () => {
    if (stopped || pending) return;
    pending = true;
    clearTimeout(timer);
    try {
      await withPushLifecycleLock(async () => {
        const [browser, server] = await Promise.allSettled([
          finishPendingBrowserCleanup(),
          fetch("/api/push/cleanup", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000) }),
        ]);
        if (server.status === "rejected") throw server.reason;
        const response = server.value;
        if (!response.ok) throw new Error("PUSH_CLEANUP_PENDING");
        const result = await response.json();
        if (result.cleaned || result.signedIn === false) {
          markPushCleanupPending();
          await clearBrowserPush();
        } else if (browser.status === "rejected") throw browser.reason;
      });
    } catch {
      if (!stopped) timer = setTimeout(() => { void retry(); }, 60_000);
    } finally { pending = false; }
  };
  const onSubmit = (event: SubmitEvent) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || new URL(form.action).origin !== location.origin
      || new URL(form.action).pathname !== "/api/auth/logout" || event.defaultPrevented) return;
    event.preventDefault();
    window.dispatchEvent(new Event(PUSH_LOGOUT_EVENT));
    markPushCleanupPending();
    // Browser cleanup failure must not prevent removal of the login session.
    void withPushLifecycleLock(async () => {
      await clearBrowserPush().catch(() => undefined);
      HTMLFormElement.prototype.submit.call(form);
    });
  };
  const onReentry = () => { void retry(); };
  document.addEventListener("submit", onSubmit);
  window.addEventListener("online", onReentry);
  window.addEventListener("pageshow", onReentry);
  void retry();
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("submit", onSubmit);
    window.removeEventListener("online", onReentry);
    window.removeEventListener("pageshow", onReentry);
  };
}
