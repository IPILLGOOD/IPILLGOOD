import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginPanel } from "@/components/auth/LoginPanel";
import { careScopeFor } from "@/lib/auth/care-scope";
import { getSession } from "@/lib/auth/session";
import { isServiceHealthDataConsentConfirmed } from "@care-atlas/backend";

export const metadata: Metadata = {
  title: "로그인",
  description: "Google 계정, 공동 사용 연결 코드 또는 비식별 데모로 IPILLGOOD를 시작하세요.",
};

const errorMessages: Record<string, string> = {
  google_login_failed: "Google 로그인 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.",
  connection_login_failed: "연결 코드가 올바르지 않거나 만료됐어요. 계정 소유자에게 새 코드를 받아주세요.",
  connection_login_limited: "연결 코드를 너무 여러 번 확인했어요. 잠시 후 다시 시도해주세요.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; withdrawn?: string; erased?: string }>;
}) {
  const session = await getSession();
  if (session) {
    const scope = careScopeFor(session);
    redirect(await isServiceHealthDataConsentConfirmed(scope.recipientId) ? "/today" : "/profile?onboarding=1");
  }

  const { error, withdrawn, erased } = await searchParams;
  const successMessage = erased === "1" ? "계정과 돌봄 기록을 영구 삭제했어요. 이전 기록은 복구할 수 없어요."
    : withdrawn === "1" ? "탈퇴 처리됐어요. 3개월 안에 같은 Google 계정으로 로그인하면 복구 절차를 안내해요. 복구하지 않으면 계정과 돌봄 기록은 영구 삭제돼요." : undefined;
  return <LoginPanel errorMessage={error ? errorMessages[error] : undefined} successMessage={successMessage} />;
}
