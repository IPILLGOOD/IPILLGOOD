export const FIREBASE_DEFAULT_AUTH_DOMAIN = "care-atlas-seoul-2026-v3.firebaseapp.com";
export const GOOGLE_REDIRECT_MARKER = "google_redirect";
export const GOOGLE_REDIRECT_PENDING_KEY = "ipillgood:google-redirect-pending";

export type GoogleAuthMode = "popup" | "redirect";

export interface GoogleAuthEnvironment {
  userAgent: string;
  displayModeStandalone: boolean;
  navigatorStandalone: boolean;
}

export function googleAuthMode(environment: GoogleAuthEnvironment): GoogleAuthMode {
  const mobile = /Android|iPhone|iPad|iPod/i.test(environment.userAgent);
  return mobile || environment.displayModeStandalone || environment.navigatorStandalone
    ? "redirect"
    : "popup";
}

export function firebaseAuthDomain(
  mode: GoogleAuthMode,
  location: Pick<Location, "host" | "hostname" | "protocol">,
) {
  const isLocal =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname === "[::1]";
  return mode === "redirect" && location.protocol === "https:" && !isLocal
    ? location.host
    : FIREBASE_DEFAULT_AUTH_DOMAIN;
}

export function hasGoogleRedirectMarker(search: string) {
  return new URLSearchParams(search).get(GOOGLE_REDIRECT_MARKER) === "1";
}

export function urlWithGoogleRedirectMarker(value: string) {
  const url = new URL(value);
  url.searchParams.set(GOOGLE_REDIRECT_MARKER, "1");
  return url.toString();
}

export function urlWithoutGoogleRedirectMarker(value: string) {
  const url = new URL(value);
  url.searchParams.delete(GOOGLE_REDIRECT_MARKER);
  return url.toString();
}

function authFlowError(code: string) {
  return Object.assign(new Error(code), { code });
}

export async function withGoogleAuthTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutCode: string,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(authFlowError(timeoutCode)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
