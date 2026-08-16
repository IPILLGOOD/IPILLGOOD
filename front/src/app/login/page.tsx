import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginPanel } from "@/components/auth/LoginPanel";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "로그인",
  description: "Google 계정 또는 비식별 데모로 Care Atlas를 시작하세요.",
};

const errorMessages: Record<string, string> = {
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
