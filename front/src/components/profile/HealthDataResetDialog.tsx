"use client";

import { useEffect, useRef, useState } from "react";

import {
  finishAccountReauthentication,
  hasAccountReauthentication,
  startAccountReauthentication,
} from "@/lib/auth/account-reauth-browser";
import { getGoogleAuthErrorMessage } from "@/lib/auth/google-error";
import {
  HealthDataResetProgress,
  healthDataResetRequest,
  type HealthDataResetProgressValue,
} from "./HealthDataResetProgress";

export function HealthDataResetDialog({
  userId,
  email,
  onClose,
}: {
  userId: string;
  email?: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const redirectStarted = useRef(false);
  const requestLock = useRef(false);
  const [token, setToken] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [deleteFirebaseAccount, setDeleteFirebaseAccount] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<HealthDataResetProgressValue | null>(null);

  useEffect(() => { dialog.current?.showModal(); heading.current?.focus(); }, []);
  useEffect(() => {
    if (redirectStarted.current || !hasAccountReauthentication("health_data_reset")) return;
    redirectStarted.current = true;
    setBusy(true);
    void finishAccountReauthentication(userId, "health_data_reset")
      .then((value) => { setToken(value); heading.current?.focus(); })
      .catch((failure) => setError(reauthMessage(failure)))
      .finally(() => setBusy(false));
  }, [userId]);

  async function reauthenticate() {
    if (requestLock.current) return;
    requestLock.current = true;
    setError("");
    setBusy(true);
    try {
      const value = await startAccountReauthentication(userId, email, "health_data_reset");
      if (value) { setToken(value); heading.current?.focus(); }
    } catch (failure) {
      setError(reauthMessage(failure));
    } finally {
      requestLock.current = false;
      setBusy(false);
    }
  }

  async function submit() {
    if (requestLock.current || !token || !accepted || confirmation !== "건강정보 삭제") return;
    requestLock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await healthDataResetRequest({
        action: "start",
        idToken: token,
        confirmation,
        deleteFirebaseAccount,
      });
      setToken(null);
      setProgress(result);
      heading.current?.focus();
    } catch (failure) {
      const status = await fetch("/api/account/health-data-reset", {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      }).then(async (response) => response.ok ? await response.json() as HealthDataResetProgressValue : null).catch(() => null);
      if (status) setProgress(status);
      else {
        setToken(null);
        setError(failure instanceof Error ? failure.message : "건강정보 삭제를 시작하지 못했어요. 다시 시도해주세요.");
      }
    } finally {
      requestLock.current = false;
      setBusy(false);
    }
  }

  function close() {
    dialog.current?.close();
    onClose();
  }

  return (
    <dialog
      ref={dialog}
      className="account-deletion-dialog"
      aria-labelledby="health-reset-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy && !progress) close();
      }}
    >
      <h2 ref={heading} id="health-reset-title" tabIndex={-1}>
        {progress ? "건강정보를 삭제하고 있어요" : token ? "삭제 범위를 마지막으로 확인해주세요" : "건강정보 삭제 전 확인해주세요"}
      </h2>
      {progress ? <HealthDataResetProgress initial={progress} /> : <>
        <p>로그인 계정은 유지하면서 IPILLGOOD에 저장된 건강정보를 즉시 초기화할 수 있어요.</p>
        <ul>
          <li>프로필의 건강정보, 문서·분석 결과, 복약·증상·안부 기록을 삭제해요.</li>
          <li>맞춤 질문, Agent 실행 기록, 보호자 연결과 모든 기기의 복약 알림을 삭제해요.</li>
          <li>삭제가 끝나면 서버에서 남은 건강정보가 없는지 다시 확인해요.</li>
          <li>삭제된 건강정보는 복구할 수 없어요.</li>
        </ul>
        {error ? <p role="alert" className="field-error">{error}</p> : null}
        {token ? <>
          <label className="consent-row health-data-reset-account-option">
            <input
              type="checkbox"
              checked={deleteFirebaseAccount}
              onChange={(event) => setDeleteFirebaseAccount(event.target.checked)}
              disabled={busy}
            />
            <span><strong>서비스 로그인 계정도 함께 삭제</strong><small>선택하지 않으면 같은 Google 로그인으로 빈 돌봄 공간을 다시 시작할 수 있어요. 선택하면 Firebase 로그인 계정을 즉시 삭제하고 로그아웃해요.</small></span>
          </label>
          <label className="consent-row">
            <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} disabled={busy} />
            <span>선택한 범위의 정보가 즉시 삭제되며 복구할 수 없음을 확인했어요.</span>
          </label>
          <div className="field">
            <label htmlFor="health-reset-confirmation">확인을 위해 ‘건강정보 삭제’를 입력해주세요</label>
            <input id="health-reset-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" disabled={busy} />
          </div>
        </> : <p className="field-hint">현재 로그인한 Google 계정으로 본인 확인 후 삭제 범위를 선택합니다.</p>}
        <div className="form-actions">
          <button className="button button--secondary" type="button" disabled={busy} onClick={close}>취소하고 돌아가기</button>
          {token ? (
            <button
              className="button account-deletion-button"
              type="button"
              disabled={busy || !accepted || confirmation !== "건강정보 삭제"}
              onClick={() => void submit()}
              aria-busy={busy}
            >
              {busy ? "삭제 요청 중…" : deleteFirebaseAccount ? "건강정보와 로그인 계정 삭제" : "건강정보 삭제"}
            </button>
          ) : (
            <button className="button button--primary" type="button" disabled={busy} onClick={() => void reauthenticate()} aria-busy={busy}>
              {busy ? "Google 계정 확인 중…" : "Google로 본인 확인"}
            </button>
          )}
        </div>
      </>}
    </dialog>
  );
}

function reauthMessage(error: unknown) {
  if (error && typeof error === "object" && "code" in error && error.code === "auth/account-mismatch") {
    return "현재 로그인한 Google 계정을 선택해주세요. 삭제는 진행되지 않았어요.";
  }
  return `${getGoogleAuthErrorMessage(error)} 삭제는 진행되지 않았어요.`;
}
