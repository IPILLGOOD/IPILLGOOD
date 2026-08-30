import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR } from "next/font/google";

import { AppShell } from "@/components/navigation/AppShell";
import { PwaInstallPrompt } from "@/components/pwa/PwaInstallPrompt";
import { getPushSessionKey } from "@/lib/push/server-binding";
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
    default: "IPILLGOOD",
    template: "%s | IPILLGOOD",
  },
  description:
    "처방전의 어려운 말을 쉬운 돌봄 행동으로 바꾸는 고령자 복약·웰니스 컨설턴트",
  applicationName: "IPILLGOOD",
  appleWebApp: {
    capable: true,
    title: "IPILLGOOD",
    statusBarStyle: "default",
  },
  icons: {
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
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
        <AppShell user={session} pushSessionKey={session ? await getPushSessionKey() : ""}>{children}</AppShell>
        <PwaInstallPrompt />
      </body>
    </html>
  );
}
