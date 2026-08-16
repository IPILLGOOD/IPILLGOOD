import type { Metadata } from "next";

import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "처방전 한 장을, 오늘의 돌봄으로",
  description:
    "처방전의 어려운 표현을 쉬운 돌봄 행동으로 바꾸고, 복약과 몸 상태 기록을 다음 진료까지 연결하는 보호자 중심 서비스입니다.",
};

export default function HomePage() {
  return <LandingPage />;
}
