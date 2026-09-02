"use client";

import { useEffect, useState } from "react";
import type { publicHealthDataReset } from "@care-atlas/backend";

import { clearDeletedAccountFromBrowser } from "@/lib/auth/account-browser-cleanup";

export type HealthDataResetProgressValue = ReturnType<typeof publicHealthDataReset>;

export async function healthDataResetRequest(body: object): Promise<HealthDataResetProgressValue> {
  const response = await fetch("/api/account/health-data-reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? "건강정보 삭제 상태를 확인하지 못했어요.");
  return result;
}

export function HealthDataResetProgress({ initial }: { initial: HealthDataResetProgressValue }) {
  const [progress, setProgress] = useState(initial);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function run() {
      try {
        const result = initial.status === "completed" && attempt === 0
          ? initial
          : await healthDataResetRequest({ action: "process" });
        if (!active) return;
        setProgress(result);
        if (result.status === "failed") return;
        if (result.status === "completed") {
          await clearDeletedAccountFromBrowser().catch(() => {
            throw new Error("서버 삭제는 완료됐어요. 이 브라우저의 로그인·알림 정리를 다시 시도해주세요.");
          });
          if (active) window.location.replace(result.deleteFirebaseAccount
            ? "/login?erased=1"
            : "/profile?health_data_reset=1&onboarding=1");
          return;
        }
        timer = setTimeout(() => void run(), 1500);
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : "연결을 확인하고 다시 시도해주세요.");
      }
    }
    void run();
    return () => { active = false; clearTimeout(timer); };
  }, [attempt, initial]);

  const stages = {
    waiting: "진행 중인 분석과 저장이 끝나기를 기다리고 있어요",
    data: "건강정보와 연결된 알림을 삭제하고 있어요",
    auth: "서비스 로그인 계정을 삭제하고 있어요",
    verification: "서버에 남은 건강정보가 없는지 확인하고 있어요",
    completed: "건강정보 삭제가 완료됐어요",
  };
  const failed = progress.status === "failed" || Boolean(error);
  return (
    <section className="account-deletion-progress" aria-labelledby="health-reset-progress-title">
      <h2 id="health-reset-progress-title" tabIndex={-1}>건강정보 삭제 처리</h2>
      <p role="status" aria-live="polite">{stages[progress.stage]}</p>
      {failed ? <>
        <p role="alert">{error || "일부 삭제가 완료되지 않았어요. 새 건강정보 저장은 차단된 상태이며 남은 작업부터 다시 처리할 수 있어요."}</p>
        <button className="button button--secondary" onClick={() => { setError(""); setAttempt((value) => value + 1); }}>처리 다시 시도</button>
      </> : <p>창을 닫거나 새로고침해도 같은 삭제 작업을 이어서 처리해요.</p>}
      <p className="field-hint">삭제된 서버 문서: {progress.deletedDocuments}개 · 잔존 데이터 검증: {progress.verified ? "완료" : "진행 중"}</p>
    </section>
  );
}
