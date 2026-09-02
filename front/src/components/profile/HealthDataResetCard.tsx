"use client";

import { useRef, useState } from "react";

import { HealthDataResetDialog } from "./HealthDataResetDialog";

export function HealthDataResetCard({
  userId,
  email,
  reauthenticating = false,
}: {
  userId: string;
  email?: string;
  reauthenticating?: boolean;
}) {
  const [open, setOpen] = useState(reauthenticating);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <section className="card account-deletion-card health-data-reset-card" aria-labelledby="health-data-reset-title">
      <div>
        <h2 id="health-data-reset-title">건강정보 초기화</h2>
        <p>Google 로그인은 유지하고 저장된 돌봄 기록만 모두 삭제할 수 있어요.</p>
        <p className="field-hint">문서·복약·증상·안부·질문·Agent 기록과 보호자 연결, 알림을 삭제한 뒤 서버 잔존 여부를 확인해요.</p>
      </div>
      <button ref={trigger} type="button" className="button button--secondary health-data-reset-entry" onClick={() => setOpen(true)}>
        건강정보 삭제
      </button>
      {open ? <HealthDataResetDialog
        userId={userId}
        email={email}
        onClose={() => { setOpen(false); trigger.current?.focus(); }}
      /> : null}
    </section>
  );
}
