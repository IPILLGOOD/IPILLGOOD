"use client";
import { useEffect, useState } from "react";
import type { publicAccountDeletion } from "@care-atlas/backend";
import { formatInSeoul } from "@care-atlas/backend/dates";
import { clearDeletedAccountFromBrowser } from "@/lib/auth/account-browser-cleanup";

export type DeletionProgress = ReturnType<typeof publicAccountDeletion>;

export async function deletionRequest(body: object): Promise<DeletionProgress> {
  const response = await fetch("/api/account/deletion", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? "탈퇴 처리 상태를 확인하지 못했어요.");
  return result;
}

export function AccountDeletionProgress({ initial }: { initial: DeletionProgress }) {
  const [progress, setProgress] = useState(initial);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function run() {
      try {
        const result = await deletionRequest({ action: "process" });
        if (!active) return;
        setProgress(result);
        if (result.status === "failed") return;
        if (result.status === "restored") { window.location.replace("/login"); return; }
        if (result.status === "completed" || result.status === "soft_deleted") {
          await clearDeletedAccountFromBrowser().catch(() => { throw new Error("회원 탈퇴는 완료됐어요. 이 브라우저의 로그인·알림 정리를 다시 시도해주세요."); });
          await deletionRequest({ action: "finish" });
          if (active) window.location.replace(result.status === "completed" ? "/login?erased=1" : "/login?withdrawn=1");
          return;
        }
        timer = setTimeout(() => void run(), 3000);
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : "연결을 확인하고 다시 시도해주세요.");
      }
    }
    void run();
    return () => { active = false; clearTimeout(timer); };
  }, [attempt]);

  const stages = { queued: "탈퇴 요청을 접수했어요", suspension: "기존 로그인과 알림을 해제하고 있어요", waiting: "탈퇴 처리됐어요. 3개월간 계정을 복구할 수 있어요", data: "복구 기간이 지나 건강정보를 영구 삭제하고 있어요", auth: "서비스 인증 계정을 삭제하고 있어요", verification: "남은 데이터가 없는지 확인하고 있어요", restored: "계정이 복구됐어요", completed: "영구 삭제가 완료됐어요" };
  const failed = progress.status === "failed" || Boolean(error);
  return (
    <section className="account-deletion-progress" aria-labelledby="deletion-progress-title">
      <h2 id="deletion-progress-title" tabIndex={-1}>회원 탈퇴 처리</h2>
      <p role="status" aria-live="polite">{stages[progress.stage]}</p>
      {failed ? <>
        <p role="alert">{error || "일부 처리가 완료되지 않았어요. 서비스 이용은 중단된 상태이며, 남은 작업부터 다시 처리해요."}</p>
        <button className="button button--secondary" onClick={() => { setError(""); setAttempt((value) => value + 1); }}>처리 다시 시도</button>
      </> : <p>창을 닫아도 서버에서 계속 처리해요. 완료되면 로그인 화면으로 이동합니다.</p>}
      <p className="field-hint">처리 중에는 건강정보 저장과 새 알림 발송이 중단돼요. 복구 기한: {formatInSeoul(progress.deleteAfter, { dateStyle: "long", timeStyle: "short" })} (한국 시간).</p>
    </section>
  );
}
