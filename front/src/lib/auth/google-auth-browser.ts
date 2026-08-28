import type { Auth, User } from "firebase/auth";

import {
  firebaseAuthDomain,
  googleAuthMode,
  GOOGLE_REDIRECT_PENDING_KEY,
  hasGoogleRedirectMarker,
  urlWithGoogleRedirectMarker,
  urlWithoutGoogleRedirectMarker,
  withGoogleAuthTimeout,
  type GoogleAuthMode,
} from "./google-auth-flow";
import { googleAuthServerError } from "./google-error";

const FIREBASE_BASE_CONFIG = {
  apiKey: "AIzaSyD6wyT0r7lg3Et1qMqgrYabJfHXoN7kcaI",
  projectId: "care-atlas-seoul-2026-v2",
  storageBucket: "care-atlas-seoul-2026-v2.firebasestorage.app",
  messagingSenderId: "419676584381",
  appId: "1:419676584381:web:fe8f784da39fabd5aa7ad4",
} as const;

export type AuthModule = typeof import("firebase/auth");

export function currentGoogleAuthMode() {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return googleAuthMode({
    userAgent: navigator.userAgent,
    displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
    navigatorStandalone: navigatorWithStandalone.standalone === true,
  });
}

export async function loadFirebaseAuth(mode: GoogleAuthMode) {
  const [{ getApp, getApps, initializeApp }, authModule] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
  ]);
  const appName = `care-atlas-v2-${mode}`;
  const app = getApps().some(({ name }) => name === appName)
    ? getApp(appName)
    : initializeApp(
        {
          ...FIREBASE_BASE_CONFIG,
          authDomain: firebaseAuthDomain(mode, window.location),
        },
        appName,
      );
  return { auth: authModule.getAuth(app), authModule };
}

export function clearGoogleRedirectState() {
  try {
    window.localStorage.removeItem(GOOGLE_REDIRECT_PENDING_KEY);
  } catch {
    // Restricted storage must not trap the user in a loading state.
  }
  if (hasGoogleRedirectMarker(window.location.search)) {
    window.history.replaceState(
      window.history.state,
      "",
      urlWithoutGoogleRedirectMarker(window.location.href),
    );
  }
}

export function markGoogleRedirectPending() {
  try {
    window.localStorage.setItem(GOOGLE_REDIRECT_PENDING_KEY, String(Date.now()));
  } catch {
    // The URL marker below is the storage-independent fallback.
  }
  window.history.replaceState(
    window.history.state,
    "",
    urlWithGoogleRedirectMarker(window.location.href),
  );
}

export function hasPendingGoogleRedirect() {
  if (hasGoogleRedirectMarker(window.location.search)) return true;
  try {
    const createdAt = Number(window.localStorage.getItem(GOOGLE_REDIRECT_PENDING_KEY));
    return Number.isFinite(createdAt) && Date.now() - createdAt < 10 * 60 * 1_000;
  } catch {
    return false;
  }
}

export async function createGoogleServerSession(
  user: User,
  auth: Auth,
  authModule: AuthModule,
) {
  const idToken = await user.getIdToken();
  const response = await withGoogleAuthTimeout(
    fetch("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    }),
    15_000,
    "server/session_timeout",
  );
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as { error?: string } | null;
    throw googleAuthServerError(result?.error ?? "google_login_failed");
  }
  const result = await response.json() as { redirectTo?: string };
  await authModule.signOut(auth).catch(() => undefined);
  clearGoogleRedirectState();
  window.location.replace(result.redirectTo === "/account/recovery" ? "/account/recovery" : "/today");
}
