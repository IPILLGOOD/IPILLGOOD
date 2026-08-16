"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  getGoogleAuthErrorMessage,
  googleAuthServerError,
} from "@/lib/auth/google-error";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyD6wyT0r7lg3Et1qMqgrYabJfHXoN7kcaI",
  authDomain: "care-atlas-seoul-2026-v2.firebaseapp.com",
  projectId: "care-atlas-seoul-2026-v2",
  storageBucket: "care-atlas-seoul-2026-v2.firebasestorage.app",
  messagingSenderId: "419676584381",
  appId: "1:419676584381:web:fe8f784da39fabd5aa7ad4",
} as const;

export function GoogleSignInButton() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  async function handleSignIn() {
    if (isLoading) return;

    setIsLoading(true);
    setErrorMessage(undefined);

    try {
      const [{ getApp, getApps, initializeApp }, authModule] = await Promise.all([
        import("firebase/app"),
        import("firebase/auth"),
      ]);
      const app = getApps().some(({ name }) => name === "care-atlas-v2")
        ? getApp("care-atlas-v2")
        : initializeApp(FIREBASE_CONFIG, "care-atlas-v2");
      const auth = authModule.getAuth(app);
      const provider = new authModule.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });

      const credential = await authModule.signInWithPopup(auth, provider);
      const idToken = await credential.user.getIdToken();
      const response = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw googleAuthServerError(result?.error ?? "google_login_failed");
      }

      await authModule.signOut(auth).catch(() => undefined);
      router.replace("/today");
      router.refresh();
    } catch (error) {
      setErrorMessage(getGoogleAuthErrorMessage(error));
      setIsLoading(false);
    }
  }

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
            Google 계정 확인 중
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
