import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginPanel } from "@/components/auth/LoginPanel";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "로그인",
  description: "Google 계정 또는 비식별 데모로 IPILLGOOD를 시작하세요.",
};

const errorMessages: Record<string, string> = {
  google_login_failed: "Google 로그인 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; withdrawn?: string; erased?: string }>;
}) {
  const session = await getSession();
  if (session) redirect("/today");

  const { error, withdrawn, erased } = await searchParams;
  const successMessage = erased === "1" ? "계정과 돌봄 기록을 영구 삭제했어요. 이전 기록은 복구할 수 없어요."
    : withdrawn === "1" ? "탈퇴 처리됐어요. 3개월 안에 같은 Google 계정으로 로그인하면 복구 절차를 안내해요. 복구하지 않으면 계정과 돌봄 기록은 영구 삭제돼요." : undefined;
  return <LoginPanel errorMessage={error ? errorMessages[error] : undefined} successMessage={successMessage} />;
}
