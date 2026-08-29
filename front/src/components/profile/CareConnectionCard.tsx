"use client";

import { Check, Clock3, Copy, Link2, Link2Off, RefreshCw, ShieldCheck, UsersRound } from "lucide-react";
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
        <div className="connection-card__title">
          <span className="connection-card__icon" aria-hidden="true"><UsersRound size={22} /></span>
          <div>
            <span className="connection-card__eyebrow">함께 돌보기</span>
            <h2 id="connection-title">돌봄 화면 연결</h2>
            <p>가족 한 명과 같은 화면, 같은 기록을 안전하게 공유해요.</p>
          </div>
        </div>
        <span className={active ? "connection-status-badge connection-status-badge--active" : pending ? "connection-status-badge connection-status-badge--pending" : "connection-status-badge"}>
          <span aria-hidden="true" />{active ? "연결됨" : pending ? "입력 대기 중" : "연결 가능"}
        </span>
      </div>

      <FormMessage state={disconnectState.status !== "idle" ? disconnectState : createState} />

      {active ? (
        <div className="connection-card__status connection-card__status--active">
          <div className="connection-connected-copy">
            <span aria-hidden="true"><Check size={19} /></span>
            <div><strong>한 명이 함께 보고 있어요</strong><p>두 기기의 변경사항이 자동으로 같은 화면에 반영돼요.</p></div>
          </div>
          <dl className="connection-stats">
            <div><dt>연결 시각</dt><dd>{formatDate(connection.connectedAt)}</dd></div>
            <div><dt>최근 활동</dt><dd>{formatDate(connection.lastSeenAt)}</dd></div>
            <div><dt>미사용 만료</dt><dd>{formatDate(connection.expiresAt)}</dd></div>
          </dl>
          <div className="connection-card__footer">
            <p><ShieldCheck size={15} aria-hidden="true" /> 연결 해제 즉시 상대 기기의 접근이 종료돼요.</p>
            <form action={disconnectAction}>
              <SubmitButton className="button button--secondary" pendingText="연결 해제 중…">
              <Link2Off size={17} aria-hidden="true" /> 연결 해제
              </SubmitButton>
            </form>
          </div>
        </div>
      ) : (
        <div className="connection-card__status">
          {code && codeExpiresAt ? (
            <div className="connection-code" aria-live="polite">
              <div className="connection-code__topline">
                <span><ShieldCheck size={15} aria-hidden="true" /> 연결 로그인 코드</span>
                <span className="connection-code__timer"><Clock3 size={14} aria-hidden="true" /><CodeCountdown expiresAt={codeExpiresAt} /></span>
              </div>
              <div className="connection-code__value">{code}</div>
              <button className="connection-code__copy" type="button" onClick={async () => {
                await navigator.clipboard.writeText(code);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2_000);
              }}>
                {copied ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}
                {copied ? "클립보드에 복사했어요" : "코드 복사하기"}
              </button>
            </div>
          ) : (
            <div className="connection-empty">
              <span className="connection-empty__visual" aria-hidden="true"><span>나</span><Link2 size={20} /><span>가족</span></span>
              <div>
                <strong>{pending ? "발급한 코드가 입력을 기다리고 있어요" : "가족과 돌봄 화면을 함께 보세요"}</strong>
                <p>{pending ? "보안을 위해 이전 코드는 다시 표시하지 않아요. 필요하면 새 코드를 발급해주세요." : "별도 회원가입 없이 코드 하나로 연결할 수 있어요."}</p>
              </div>
            </div>
          )}
          <ol className="connection-steps" aria-label="연결 방법">
            <li><span>1</span><p><strong>코드 발급</strong>10분 동안 유효해요</p></li>
            <li><span>2</span><p><strong>가족에게 전달</strong>메신저로 복사해 보내요</p></li>
            <li><span>3</span><p><strong>바로 연결</strong>같은 돌봄 화면을 봐요</p></li>
          </ol>
          <div className="form-actions">
            <form action={createAction}>
              <SubmitButton pendingText="코드 만드는 중…">
                {code || pending ? <RefreshCw size={17} aria-hidden="true" /> : <Link2 size={17} aria-hidden="true" />}
                {code || pending ? "새 코드 발급" : "연결 코드 만들기"}
              </SubmitButton>
            </form>
            {pending ? <form action={disconnectAction}><SubmitButton className="button button--quiet" pendingText="코드 취소 중…">코드 취소</SubmitButton></form> : null}
          </div>
        </div>
      )}
      <p className="connection-card__security"><ShieldCheck size={15} aria-hidden="true" /> 최초 연결은 10분 안에 완료해야 해요. 이후에는 같은 코드로 다시 로그인할 수 있고, 한 번에 한 기기만 연결돼요.</p>
    </section>
  );
}
