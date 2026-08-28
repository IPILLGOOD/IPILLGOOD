"use client";
import { clearGoogleRedirectState, loadFirebaseAuth } from "./google-auth-browser";
import { clearAccountReauthentication } from "./account-reauth-browser";

/** Used after soft deletion or recovery cancellation; no active service session is needed. */
export async function clearDeletedAccountFromBrowser() {
  const results = await Promise.allSettled([
    ...(["popup", "redirect"] as const).map(async (mode) => {
      const { auth, authModule } = await loadFirebaseAuth(mode);
      await authModule.signOut(auth);
    }),
    (async () => {
      if (!("serviceWorker" in navigator)) return;
      for (const registration of await navigator.serviceWorker.getRegistrations()) {
        const subscription = await registration.pushManager?.getSubscription();
        if (subscription && !await subscription.unsubscribe()) throw new Error("PUSH_UNSUBSCRIBE_FAILED");
        for (const notification of await registration.getNotifications()) notification.close();
      }
    })(),
    (async () => {
      if (!("caches" in window)) return;
      for (const name of await caches.keys()) if (name.startsWith("ipillgood-")) await caches.delete(name);
    })(),
  ]);
  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (const key of Object.keys(storage)) if (key.startsWith("ipillgood:") || key.startsWith("care-atlas:")) storage.removeItem(key);
  }
  clearGoogleRedirectState();
  clearAccountReauthentication();
  if (results.some((result) => result.status === "rejected")) throw new Error("BROWSER_CLEANUP_INCOMPLETE");
}
