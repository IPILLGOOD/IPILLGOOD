"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  clearGoogleRedirectState,
  createGoogleServerSession,
  currentGoogleAuthMode,
  hasPendingGoogleRedirect,
  loadFirebaseAuth,
  markGoogleRedirectPending,
} from "@/lib/auth/google-auth-browser";
import { withGoogleAuthTimeout } from "@/lib/auth/google-auth-flow";
import { getGoogleAuthErrorMessage } from "@/lib/auth/google-error";
type LoadingState = "idle" | "popup" | "redirect" | "completing";

export function GoogleSignInButton() {
  const redirectCheckStarted = useRef(false);
  const [loadingState, setLoadingState] = useState<LoadingState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>();
  const isLoading = loadingState !== "idle";

  useEffect(() => {
    if (redirectCheckStarted.current || !hasPendingGoogleRedirect()) return;
    redirectCheckStarted.current = true;
    let active = true;
    setLoadingState("completing");

    void (async () => {
      try {
        const { auth, authModule } = await loadFirebaseAuth("redirect");
        const credential = await withGoogleAuthTimeout(
          authModule.getRedirectResult(auth),
          30_000,
          "auth/redirect-timeout",
        );
        await auth.authStateReady();
        const user = credential?.user ?? auth.currentUser;
        if (!user) {
          throw Object.assign(new Error("redirect result missing"), {
            code: "auth/redirect-result-missing",
          });
        }
        await createGoogleServerSession(user, auth, authModule);
      } catch (error) {
        clearGoogleRedirectState();
        if (!active) return;
        setErrorMessage(getGoogleAuthErrorMessage(error));
        setLoadingState("idle");
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  async function handleSignIn() {
    if (isLoading) return;
    setErrorMessage(undefined);
    const mode = currentGoogleAuthMode();
    setLoadingState(mode);

    try {
      const { auth, authModule } = await loadFirebaseAuth(mode);
      const provider = new authModule.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });

      if (mode === "redirect") {
        markGoogleRedirectPending();
        await authModule.signInWithRedirect(auth, provider);
        return;
      }

      const credential = await withGoogleAuthTimeout(
        authModule.signInWithPopup(auth, provider),
        60_000,
        "auth/popup-timeout",
      );
      await createGoogleServerSession(credential.user, auth, authModule);
    } catch (error) {
      clearGoogleRedirectState();
      setErrorMessage(getGoogleAuthErrorMessage(error));
      setLoadingState("idle");
    }
  }

  const loadingLabel =
    loadingState === "redirect"
      ? "Google 로그인으로 이동 중"
      : loadingState === "completing"
        ? "Google 로그인 마무리 중"
        : "Google 계정 확인 중";

  return (
    <>
      <button
        aria-busy={isLoading}
        className="login-provider-button"
        disabled={isLoading}
        onClick={handleSignIn}
        type="button"
      >
        {isLoading ? (
          <>
            {loadingLabel}
            <LoaderCircle className="login-button-spinner" size={17} aria-hidden="true" />
          </>
        ) : (
          <>
            Google로 계속하기 <ArrowRight size={17} aria-hidden="true" />
          </>
        )}
      </button>
      {errorMessage ? (
        <p className="login-provider-error" role="alert">{errorMessage}</p>
      ) : null}
    </>
  );
}
