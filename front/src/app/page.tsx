import type { Metadata } from "next";

import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "처방전 다음의 돌봄을 이어가세요",
  description:
    "처방전을 쉬운 말과 오늘의 복약 계획으로 바꾸고, 매일의 몸 상태를 다음 진료에 가져갈 기록으로 쌓는 보호자용 서비스입니다.",
};

export default function HomePage() {
  return <LandingPage />;
}
