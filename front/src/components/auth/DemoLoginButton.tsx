"use client";

import { LoaderCircle } from "lucide-react";
import { type ReactNode, useState } from "react";

import { getDemoLoginErrorMessage } from "@/lib/auth/demo-login-error";

type DemoLoginResponse = {
  redirectTo?: string;
  error?: string;
  reason?: string;
};

export function DemoLoginButton({
  children,
  className,
  pendingLabel = "데모 준비 중…",
}: {
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
        setPending(false);
        setErrorMessage(getDemoLoginErrorMessage(body.error, body.reason));
        return;
      }
      window.location.replace(body.redirectTo);
    } catch {
      setPending(false);
      setErrorMessage(getDemoLoginErrorMessage(undefined));
    }
  }

  return (
    <div className="demo-login-control">
      <button
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
