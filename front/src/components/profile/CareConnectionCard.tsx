"use client";

import { Check, Copy, Link2, Link2Off } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import {
  createConnectionCodeAction,
  disconnectConnectionAction,
  type ConnectionActionState,
} from "@/app/actions";
import { FormMessage } from "@/components/ui/FormMessage";
import { SubmitButton } from "@/components/ui/SubmitButton";
import type { PublicCareConnection } from "@care-atlas/backend";

const initialState: ConnectionActionState = { status: "idle", message: "" };

function formatDate(value: string | null) {
  if (!value) return "확인되지 않음";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value));
}

function CodeCountdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, Date.parse(expiresAt) - Date.now()));
  useEffect(() => {
    const update = () => setRemaining(Math.max(0, Date.parse(expiresAt) - Date.now()));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  return <span role="timer">{remaining ? `${minutes}:${String(seconds).padStart(2, "0")} 남음` : "코드가 만료됐어요"}</span>;
}

export function CareConnectionCard({ connection }: { connection: PublicCareConnection | null }) {
  const [createState, createAction] = useActionState(createConnectionCodeAction, initialState);
  const [disconnectState, disconnectAction] = useActionState(disconnectConnectionAction, initialState);
  const [copied, setCopied] = useState(false);
  const code = createState.code;
  const codeExpiresAt = createState.expiresAt;
  const active = connection?.status === "active";
  const pending = connection?.status === "pending";

  return (
    <section className="card connection-card" aria-labelledby="connection-title">
      <div className="connection-card__heading">
        <span className="connection-card__icon" aria-hidden="true"><Link2 size={22} /></span>
        <div>
          <h2 id="connection-title">공동 사용 연결</h2>
          <p>한 명을 연결해 같은 돌봄 화면과 기록을 함께 사용할 수 있어요.</p>
        </div>
      </div>

      <FormMessage state={disconnectState.status !== "idle" ? disconnectState : createState} />

      {active ? (
        <div className="connection-card__status">
          <strong>연결 사용자 1명이 이용 중이에요</strong>
          <dl>
            <div><dt>연결 시각</dt><dd>{formatDate(connection.connectedAt)}</dd></div>
            <div><dt>최근 활동</dt><dd>{formatDate(connection.lastSeenAt)}</dd></div>
            <div><dt>미사용 만료</dt><dd>{formatDate(connection.expiresAt)}</dd></div>
          </dl>
          <form action={disconnectAction}>
            <SubmitButton className="button button--secondary" pendingText="연결 해제 중…">
              <Link2Off size={17} aria-hidden="true" /> 연결 해제
            </SubmitButton>
          </form>
        </div>
      ) : (
        <div className="connection-card__status">
          {code && codeExpiresAt ? (
            <div className="connection-code" aria-live="polite">
              <span>일회용 연결 코드</span>
              <strong>{code}</strong>
              <CodeCountdown expiresAt={codeExpiresAt} />
              <button
                className="button button--quiet"
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(code);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2_000);
                }}
              >
                {copied ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}
                {copied ? "복사했어요" : "코드 복사"}
              </button>
            </div>
          ) : (
            <p>{pending ? "앞서 발급한 코드가 입력을 기다리고 있어요. 보안을 위해 코드는 다시 표시하지 않아요." : "연결된 사용자가 없어요. 코드를 받은 사람은 별도 계정 없이 로그인할 수 있어요."}</p>
          )}
          <div className="form-actions">
            <form action={createAction}>
              <SubmitButton pendingText="코드 만드는 중…">{code || pending ? "새 코드 발급" : "연결 코드 발급"}</SubmitButton>
            </form>
            {pending ? <form action={disconnectAction}><SubmitButton className="button button--quiet" pendingText="코드 취소 중…">코드 취소</SubmitButton></form> : null}
          </div>
        </div>
      )}
      <p className="field-hint">코드는 10분 동안 한 번만 사용할 수 있고, 연결 사용자는 한 기기에서만 로그인할 수 있어요.</p>
    </section>
  );
}
