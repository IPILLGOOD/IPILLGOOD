"use client";
import type { User } from "firebase/auth";
import { currentGoogleAuthMode, loadFirebaseAuth } from "./google-auth-browser";
import { withGoogleAuthTimeout } from "./google-auth-flow";

const MARKER = "account_reauth";
export type AccountReauthenticationPurpose = "account_deletion" | "health_data_reset";

export const hasAccountReauthentication = (purpose: AccountReauthenticationPurpose = "account_deletion") => {
  const value = new URLSearchParams(window.location.search).get(MARKER);
  return purpose === "account_deletion" ? value === "1" || value === purpose : value === purpose;
};
export function clearAccountReauthentication() {
  const url = new URL(window.location.href);
  url.searchParams.delete(MARKER);
  window.history.replaceState(window.history.state, "", url);
}

async function verifiedToken(user: User | null, expectedUserId: string) {
  if (!user) throw Object.assign(new Error("No reauthentication result"), { code: "auth/redirect-result-missing" });
  if (user.uid !== expectedUserId) throw Object.assign(new Error("Different account"), { code: "auth/account-mismatch" });
  return user.getIdToken(true);
}

export async function startAccountReauthentication(
  expectedUserId: string,
  email?: string,
  purpose: AccountReauthenticationPurpose = "account_deletion",
) {
  const mode = currentGoogleAuthMode();
  const { auth, authModule } = await loadFirebaseAuth(mode);
  await auth.authStateReady();
  const provider = new authModule.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account", ...(email ? { login_hint: email } : {}) });
  await authModule.setPersistence(auth, mode === "redirect" ? authModule.browserSessionPersistence : authModule.inMemoryPersistence);
  if (mode === "redirect") {
    const url = new URL(window.location.href);
    url.searchParams.set(MARKER, purpose);
    window.history.replaceState(window.history.state, "", url);
    try {
      if (auth.currentUser?.uid === expectedUserId) await authModule.reauthenticateWithRedirect(auth.currentUser, provider);
      else await authModule.signInWithRedirect(auth, provider);
      return null;
    } catch (error) { clearAccountReauthentication(); throw error; }
  }
  try {
    const result = await withGoogleAuthTimeout(
      auth.currentUser?.uid === expectedUserId
        ? authModule.reauthenticateWithPopup(auth.currentUser, provider)
        : authModule.signInWithPopup(auth, provider),
      60_000, "auth/popup-timeout",
    );
    return await verifiedToken(result.user, expectedUserId);
  } finally { await authModule.signOut(auth); }
}

export async function finishAccountReauthentication(
  expectedUserId: string,
  purpose: AccountReauthenticationPurpose = "account_deletion",
) {
  if (!hasAccountReauthentication(purpose)) {
    throw Object.assign(new Error("Missing reauthentication purpose"), { code: "auth/redirect-result-missing" });
  }
  const { auth, authModule } = await loadFirebaseAuth("redirect");
  try {
    const result = await withGoogleAuthTimeout(authModule.getRedirectResult(auth), 30_000, "auth/redirect-timeout");
    // Never fall back to a cached currentUser: a cancelled redirect is not reauthentication.
    return await verifiedToken(result?.user ?? null, expectedUserId);
  } finally { clearAccountReauthentication(); await authModule.signOut(auth); }
}
