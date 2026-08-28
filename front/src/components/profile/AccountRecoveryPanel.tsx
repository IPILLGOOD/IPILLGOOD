"use client";
import { useRef, useState } from "react";
import { formatInSeoul } from "@care-atlas/backend/dates";
import { clearDeletedAccountFromBrowser } from "@/lib/auth/account-browser-cleanup";
import type { DeletionProgress } from "./AccountDeletionProgress";

export function AccountRecoveryPanel({ initial, email }: { initial: DeletionProgress; email?: string }) {
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(initial.recoveryExpired);
  const lock = useRef(false);

  async function submit(action: "restore" | "cancel") {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      if (action === "cancel") await clearDeletedAccountFromBrowser();
      const response = await fetch("/api/account/recovery", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(60_000),
        body: JSON.stringify(action === "restore" ? { action, confirmation: accepted } : { action }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 410) setExpired(true);
        throw new Error(result.message ?? "계정 복구를 완료하지 못했어요.");
      }
      window.location.replace(action === "restore" ? "/profile?restored=1" : "/login");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "연결을 확인한 뒤 다시 시도해주세요."); }
    finally { lock.current = false; setBusy(false); }
  }

  return <main id="main-content" className="account-recovery-page">
    <section className="card account-deletion-progress" aria-labelledby="recovery-title">
      <p className="eyebrow">계정 복구</p>
      <h1 id="recovery-title">{expired ? "계정 복구 기간이 지났어요" : "탈퇴한 계정을 복구할까요?"}</h1>
      {email && <p className="account-recovery-email">{email}</p>}
      <p>{expired ? "3개월의 보관 기간이 끝나 영구 삭제 대상이 되었어요. 기존 계정과 돌봄 기록은 더 이상 복구할 수 없어요." : "같은 Google 계정으로 본인 확인을 마쳤어요. 아직 서비스에 로그인된 상태는 아니며, 아래에서 복구를 확인해야 다시 이용할 수 있어요."}</p>
      <dl className="account-recovery-dates">
        <div><dt>탈퇴 일시</dt><dd>{formatInSeoul(initial.requestedAt, { dateStyle: "long", timeStyle: "short" })}</dd></div>
        <div><dt>복구 기한</dt><dd>{formatInSeoul(initial.deleteAfter, { dateStyle: "long", timeStyle: "short" })} (한국 시간)</dd></div>
      </dl>
      {!expired && <>
        <p>복구하면 프로필·문서·복약·안부 기록을 다시 이용할 수 있어요. 모든 기기의 이전 로그인은 해제된 상태를 유지하고, 알림은 사용할 기기에서 다시 설정해야 해요.</p>
        <p className="field-hint">로그인만으로 복구되거나 삭제 기한이 연장되지는 않아요. 복구하지 않으면 기한 후 영구 삭제합니다. 본인 확인은 5분간 유효해요.</p>
        <label className="consent-row"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} disabled={busy} /><span>탈퇴를 취소하고 기존 계정과 돌봄 기록을 복구할게요.</span></label>
      </>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="button button--secondary" type="button" disabled={busy} onClick={() => void submit("cancel")}>{expired ? "로그인 화면으로" : "복구하지 않고 나가기"}</button>
        {!expired && <button className="button button--primary" type="button" disabled={busy || !accepted} aria-busy={busy} onClick={() => void submit("restore")}>{busy ? "계정 복구 중…" : "확인하고 계정 복구"}</button>}
      </div>
    </section>
  </main>;
}
