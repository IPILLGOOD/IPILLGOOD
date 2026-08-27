"use client";

import { usePushStatus } from "./PushStatusProvider";
import { Card } from "@/components/ui/Card";
import styles from "./PushKeyNotice.module.css";

export function PushKeyNotice() {
  const { client, error, busy, checking, enable, refresh } = usePushStatus();
  const needsRenewal = client?.keyStatus === "mismatch" || client?.expired;
  const unverified = client?.keyStatus === "unverifiable";
  const permissionDenied = client?.permission === "denied";
  if (!needsRenewal && !client?.deliveryAuthRejected && !unverified && !error) return null;
  return (
    <Card tone="warning" className={styles.notice} aria-label="알림 연결 확인">
      <p role="status">{error || (permissionDenied
        ? "브라우저 또는 기기 설정에서 알림을 허용한 뒤 다시 확인해 주세요."
        : needsRenewal
        ? "알림 연결 키가 변경되었거나 구독이 만료됐어요. 이 기기의 알림을 다시 연결해 주세요."
        : client?.deliveryAuthRejected
          ? "알림 서비스에서 인증을 거부했어요. 키 또는 서버 인증 설정 확인이 필요해요."
          : "이 브라우저는 구독 키 확인을 지원하지 않아 현재 키와 일치하는지 확인할 수 없어요.")}</p>
      {needsRenewal && !error && !permissionDenied ? (
        <button className="button button--secondary" type="button" onClick={enable} disabled={busy !== null || checking}>
          {busy === "enable" ? "다시 연결 중…" : "알림 다시 연결하기"}
        </button>
      ) : (
        <button className="button button--quiet" type="button" onClick={refresh} disabled={busy !== null || checking}>
          {checking ? "확인 중…" : "알림 상태 다시 확인"}
        </button>
      )}
    </Card>
  );
}
