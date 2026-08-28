"use client";
import { useEffect, useRef, useState } from "react";
import type { AccountDeletionPolicy } from "@care-atlas/backend";
import { finishAccountReauthentication, hasAccountReauthentication, startAccountReauthentication } from "@/lib/auth/account-reauth-browser";
import { getGoogleAuthErrorMessage } from "@/lib/auth/google-error";
import { AccountDeletionProgress, deletionRequest, type DeletionProgress } from "./AccountDeletionProgress";

export function AccountDeletionDialog({ userId, email, policy, onClose }: { userId: string; email?: string; policy: AccountDeletionPolicy | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const redirectStarted = useRef(false);
  const requestLock = useRef(false);
  const [token, setToken] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<DeletionProgress | null>(null);

  useEffect(() => { dialog.current?.showModal(); heading.current?.focus(); }, []);
  useEffect(() => {
    if (redirectStarted.current || !hasAccountReauthentication()) return;
    redirectStarted.current = true;
    setBusy(true);
    void finishAccountReauthentication(userId)
      .then((value) => { setToken(value); heading.current?.focus(); })
      .catch((failure) => setError(reauthMessage(failure)))
      .finally(() => setBusy(false));
  }, [userId]);

  async function reauthenticate() {
    if (requestLock.current) return;
    requestLock.current = true;
    setError(""); setBusy(true);
    try {
      const value = await startAccountReauthentication(userId, email);
      if (value) { setToken(value); heading.current?.focus(); }
    } catch (failure) { setError(reauthMessage(failure)); }
    finally { requestLock.current = false; setBusy(false); }
  }

  async function submit() {
    if (requestLock.current || !token || !policy || !accepted || confirmation !== "회원 탈퇴") return;
    requestLock.current = true;
    setBusy(true); setError("");
    try {
      const result = await deletionRequest({ action: "start", idToken: token, confirmation, policyVersion: policy.version });
      setToken(null); setProgress(result); heading.current?.focus();
    } catch (failure) {
      // The server may have committed even if its response was lost. Check before offering a new request.
      const status = await fetch("/api/account/deletion", { cache: "no-store", signal: AbortSignal.timeout(15_000) }).then(async (res) => res.ok ? await res.json() as DeletionProgress : null).catch(() => null);
      if (status) setProgress(status);
      else { setToken(null); setError(failure instanceof Error ? failure.message : "탈퇴를 요청하지 못했어요. 다시 시도해주세요."); }
    } finally { requestLock.current = false; setBusy(false); }
  }

  function close() {
    dialog.current?.close();
    onClose();
  }

  return (
    <dialog ref={dialog} className="account-deletion-dialog" aria-labelledby="deletion-title" onCancel={(event) => { event.preventDefault(); if (!busy && !progress) close(); }}>
      <h2 ref={heading} id="deletion-title" tabIndex={-1}>{progress ? "탈퇴 요청을 처리하고 있어요" : token ? "정말 회원 탈퇴하시겠어요?" : "회원 탈퇴 전 확인해주세요"}</h2>
      {progress ? <AccountDeletionProgress initial={progress} /> : <>
        <p>탈퇴하면 IPILLGOOD 이용이 즉시 중단되고, 계정과 돌봄 기록은 3개월간 복구 대기 상태로 보관돼요.</p>
        <ul>
          <li>프로필, 문서·분석 결과, 복약·안부 기록, 맞춤 질문과 Agent 기록은 복구 기간이 끝나면 삭제돼요.</li>
          <li>모든 기기의 알림 구독과 복약 알림 일정이 해제돼요.</li>
          <li>3개월 안에 같은 Google 계정으로 로그인하면 복구 절차를 안내해요. 복구를 확인해야 다시 이용할 수 있어요.</li>
          <li>로그인만으로 삭제 기한이 연장되지는 않아요. 기한이 지나 영구 삭제한 정보는 되돌릴 수 없어요.</li>
          <li>Google 계정 자체는 삭제되지 않아요.</li>
        </ul>
        {policy ? <div className="account-deletion-notice">
          <h3>삭제·보존 안내</h3><p>{policy.notice}</p>
          <p>3개월은 탈퇴일부터 한국 시간의 달력 기준으로 계산해요. 같은 날짜가 없는 달에는 말일이 복구 기한이 돼요.</p>
          <p className="field-hint">정책 버전: {policy.version}</p>
        </div> : <p className="account-deletion-notice" role="status">삭제·보존 정책을 확인하고 있어요. 안내가 확정될 때까지 회원 탈퇴를 실행할 수 없어요.</p>}
        {error && <p role="alert" className="field-error">{error}</p>}
        {token ? <>
          <label className="consent-row"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} disabled={busy} /><span>3개월간 복구를 위해 보관하며, 복구하지 않으면 영구 삭제됨을 확인했어요.</span></label>
          <div className="field"><label htmlFor="deletion-confirmation">확인을 위해 ‘회원 탈퇴’를 입력해주세요</label><input id="deletion-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" disabled={busy} /></div>
        </> : <p className="field-hint">현재 로그인한 Google 계정으로 본인 확인 후, 마지막으로 한 번 더 확인합니다.</p>}
        <div className="form-actions">
          <button className="button button--secondary" type="button" disabled={busy} onClick={close}>취소하고 돌아가기</button>
          {token ? <button className="button account-deletion-button" type="button" disabled={busy || !accepted || confirmation !== "회원 탈퇴"} onClick={() => void submit()} aria-busy={busy}>{busy ? "탈퇴 요청 중…" : "확인하고 회원 탈퇴"}</button>
            : <button className="button button--primary" type="button" disabled={busy || !policy} onClick={() => void reauthenticate()} aria-busy={busy}>{busy ? "Google 계정 확인 중…" : "Google로 본인 확인"}</button>}
        </div>
      </>}
    </dialog>
  );
}

function reauthMessage(error: unknown) {
  if (error && typeof error === "object" && "code" in error && error.code === "auth/account-mismatch") return "현재 로그인한 Google 계정을 선택해주세요. 탈퇴는 진행되지 않았어요.";
  return `${getGoogleAuthErrorMessage(error)} 탈퇴는 진행되지 않았어요.`;
}
