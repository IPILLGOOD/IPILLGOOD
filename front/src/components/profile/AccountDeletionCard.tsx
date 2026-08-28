"use client";
import { useRef, useState } from "react";
import type { AccountDeletionPolicy } from "@care-atlas/backend";
import { AccountDeletionDialog } from "./AccountDeletionDialog";

export function AccountDeletionCard({ userId, email, demo, policy, reauthenticating = false }: { userId: string; email?: string; demo: boolean; policy: AccountDeletionPolicy | null; reauthenticating?: boolean }) {
  const [open, setOpen] = useState(!demo && reauthenticating);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <section className="card account-deletion-card" aria-labelledby="account-settings-title">
      <div><h2 id="account-settings-title">계정 관리</h2>
        <p>서비스 이용을 마치려면 회원 탈퇴를 진행할 수 있어요.</p>
        <p className="field-hint">{demo ? "데모는 실제 회원 계정이 아니에요. 로그아웃하면 체험 기록이 삭제돼요." : "탈퇴 후 3개월 안에는 같은 Google 계정으로 복구할 수 있어요. 복구하지 않으면 계정과 돌봄 기록을 영구 삭제해요."}</p>
      </div>
      <button ref={trigger} type="button" className="button button--secondary account-deletion-entry" disabled={demo} onClick={() => setOpen(true)}>회원 탈퇴</button>
      {open && <AccountDeletionDialog userId={userId} email={email} policy={policy} onClose={() => { setOpen(false); trigger.current?.focus(); }} />}
    </section>
  );
}
