import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR } from "next/font/google";

import { AppShell } from "@/components/navigation/AppShell";
import { getSession } from "@/lib/auth/session";

import "@/styles/tokens.css";
import "@/styles/globals.css";
import "@/styles/components.css";
import "@/styles/pages.css";
import "@/styles/landing.css";

const notoSans = Noto_Sans_KR({
  variable: "--font-noto-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Care Atlas",
    template: "%s | Care Atlas",
  },
  description:
    "처방전의 어려운 말을 쉬운 돌봄 행동으로 바꾸는 노인 복약·웰니스 컨설턴트",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F6F8F4",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();

  return (
    <html lang="ko" className={notoSans.variable}>
      <body suppressHydrationWarning>
        <AppShell user={session}>{children}</AppShell>
      </body>
    </html>
  );
}
