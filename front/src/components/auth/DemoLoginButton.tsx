"use client";

import { LoaderCircle } from "lucide-react";
import { type ReactNode, useState } from "react";

type DemoLoginResponse = {
  redirectTo?: string;
  error?: string;
};

export function DemoLoginButton({
  ariaLabel,
  children,
  className,
  pendingLabel = "데모 준비 중…",
}: {
  ariaLabel?: string;
  children: ReactNode;
  className: string;
  pendingLabel?: string;
}) {
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function startDemo() {
    if (pending) return;
    setPending(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/auth/demo", {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const body = (await response.json()) as DemoLoginResponse;
      if (!response.ok || !body.redirectTo) {
        throw new Error(body.error ?? "demo_session_failed");
      }
      window.location.replace(body.redirectTo);
    } catch {
      setPending(false);
      setErrorMessage("데모를 준비하지 못했어요. 잠시 후 다시 시도해주세요.");
    }
  }

  return (
    <div className="demo-login-control">
      <button
        aria-label={ariaLabel}
        className={className}
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={startDemo}
      >
        {pending ? (
          <>
            <LoaderCircle className="login-button-spinner" size={18} aria-hidden="true" />
            <span>{pendingLabel}</span>
          </>
        ) : children}
      </button>
      {errorMessage ? <p className="demo-login-error" role="alert">{errorMessage}</p> : null}
    </div>
  );
}
