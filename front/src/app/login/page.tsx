import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginPanel } from "@/components/auth/LoginPanel";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "로그인",
  description: "Google 계정 또는 비식별 데모로 Care Atlas를 시작하세요.",
};

const errorMessages: Record<string, string> = {
  google_not_configured:
    "Google 로그인이 아직 설정되지 않았어요. 지금은 데모 로그인으로 둘러볼 수 있어요.",
  google_cancelled: "Google 로그인이 취소되었어요. 다시 시도하거나 데모로 둘러보세요.",
  invalid_oauth_state: "로그인 요청이 만료되었어요. Google 로그인을 다시 시작해주세요.",
  google_token_failed: "Google 인증을 완료하지 못했어요. 잠시 후 다시 시도해주세요.",
  google_profile_failed: "확인된 Google 계정 정보를 불러오지 못했어요.",
  google_login_failed: "Google 로그인 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (session) redirect("/today");

  const { error } = await searchParams;
  return <LoginPanel errorMessage={error ? errorMessages[error] : undefined} />;
}
