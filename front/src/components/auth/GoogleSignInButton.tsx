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
  const attempt = useRef<AbortController | null>(null);
  const redirectResult = useRef<ReturnType<typeof readRedirectUser> | null>(null);
  const [loadingState, setLoadingState] = useState<LoadingState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>();
  const isLoading = loadingState !== "idle";

  useEffect(() => {
    // Safari can restore the pre-redirect document with its disabled button.
    const restore = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      attempt.current?.abort();
      attempt.current = null;
      clearGoogleRedirectState();
      setErrorMessage("로그인이 완료되지 않았어요. 다시 시도해주세요.");
      setLoadingState("idle");
    };
    window.addEventListener("pageshow", restore);
    return () => {
      window.removeEventListener("pageshow", restore);
      attempt.current?.abort();
      attempt.current = null;
    };
  }, []);

  useEffect(() => {
    if (!hasPendingGoogleRedirect()) return;
    const controller = new AbortController();
    attempt.current = controller;
    queueMicrotask(() => { if (!controller.signal.aborted) setLoadingState("completing"); });

    void (async () => {
      try {
        // Firebase consumes the redirect result once, including in Strict Mode.
        redirectResult.current ??= readRedirectUser();
        const { user, auth, authModule } = await redirectResult.current;
        controller.signal.throwIfAborted();
        await createGoogleServerSession(user, auth, authModule, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) return;
        clearGoogleRedirectState();
        setErrorMessage(getGoogleAuthErrorMessage(error));
        setLoadingState("idle");
        attempt.current = null;
      }
    })();

    return () => controller.abort();
  }, []);

  async function handleSignIn() {
    if (attempt.current || isLoading) return;
    const controller = new AbortController();
    attempt.current = controller;
    setErrorMessage(undefined);
    const mode = currentGoogleAuthMode();
    setLoadingState(mode);

    try {
      await withGoogleAuthTimeout((async () => {
        const { auth, authModule } = await loadFirebaseAuth(mode);
        controller.signal.throwIfAborted();
        const provider = new authModule.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });

        if (mode === "redirect") {
          markGoogleRedirectPending();
          await authModule.signInWithRedirect(auth, provider);
          throw Object.assign(new Error("redirect did not navigate"), { code: "auth/redirect-result-missing" });
        }

        const credential = await authModule.signInWithPopup(auth, provider);
        controller.signal.throwIfAborted();
        await createGoogleServerSession(credential.user, auth, authModule, controller.signal);
      })(), mode === "redirect" ? 30_000 : 90_000,
      mode === "redirect" ? "auth/redirect-timeout" : "auth/popup-timeout");
    } catch (error) {
      if (controller.signal.aborted) return;
      controller.abort();
      attempt.current = null;
      clearGoogleRedirectState();
      setErrorMessage(getGoogleAuthErrorMessage(error));
      setLoadingState("idle");
    }
  }

  function restartLogin() {
    attempt.current?.abort();
    clearGoogleRedirectState();
    // A fresh document also recovers failed SDK chunks and stale Firebase state.
    window.location.reload();
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
            {errorMessage ? "Google 로그인 다시 시도" : "Google로 계속하기"} <ArrowRight size={17} aria-hidden="true" />
          </>
        )}
      </button>
      {isLoading || errorMessage ? (
        <button className="login-restart-button" type="button" onClick={restartLogin}>
          로그인 화면 새로고침
        </button>
      ) : null}
      {errorMessage ? (
        <p className="login-provider-error" role="alert">{errorMessage}</p>
      ) : null}
    </>
  );
}

async function readRedirectUser() {
  return withGoogleAuthTimeout((async () => {
    const { auth, authModule } = await loadFirebaseAuth("redirect");
    const credential = await authModule.getRedirectResult(auth);
    await auth.authStateReady();
    const user = credential?.user ?? auth.currentUser;
    if (!user) {
      throw Object.assign(new Error("redirect result missing"), {
        code: "auth/redirect-result-missing",
      });
    }
    return { user, auth, authModule };
  })(), 30_000, "auth/redirect-timeout");
}
