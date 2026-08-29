"use client";

import {
  CalendarCheck2,
  ClipboardCheck,
  FileText,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Pill,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { SessionUser } from "@/lib/auth/session";
import { PushStatusProvider } from "@/components/notifications/PushStatusProvider";
import { PushKeyNotice } from "@/components/notifications/PushKeyNotice";
import { CareSyncProvider } from "@/components/sync/CareSyncProvider";

const navigation = [
  { href: "/today", label: "오늘 할 일", icon: CalendarCheck2, mobile: true },
  { href: "/dashboard", label: "대시보드", icon: LayoutDashboard, mobile: true },
  { href: "/medications", label: "복용약", icon: Pill, mobile: true },
  { href: "/check-in", label: "안부 확인", icon: ClipboardCheck, mobile: true },
  { href: "/documents", label: "문서", icon: FileText, mobile: true },
  { href: "/profile", label: "프로필", icon: UserRound, mobile: false },
];

function Brand() {
  return (
    <Link className="brand" href="/today" aria-label="IPILLGOOD 오늘 할 일 화면으로 이동">
      <span className="brand__mark" aria-hidden="true">
        <HeartPulse size={22} strokeWidth={2.2} />
      </span>
      <span>
        <strong>IPILLGOOD</strong>
        <small>매일 이어지는 안심 돌봄</small>
      </span>
    </Link>
  );
}

function NavigationLinks({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      className={mobile ? "mobile-nav" : "side-nav"}
      aria-label={mobile ? "주요 메뉴" : "서비스 메뉴"}
    >
      {navigation
        .filter((item) => !mobile || item.mobile)
        .map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={active ? "nav-link nav-link--active" : "nav-link"}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={mobile ? 21 : 20} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        );
        })}
    </nav>
  );
}

export function AppShell({
  children,
  user,
}: {
  children: React.ReactNode;
  user: SessionUser | null;
}) {
  const pathname = usePathname();
  const isPublicPage = pathname === "/" || pathname === "/login" || pathname === "/account/recovery" || pathname === "/404";

  if (isPublicPage) return children;

  return (
    <CareSyncProvider enabled={Boolean(user && user.provider !== "demo")} connected={user?.provider === "connected"}>
    <PushStatusProvider key={`${user?.provider}:${user?.id}`} enabled={Boolean(user)}>
      <a className="skip-link" href="#main-content">
        본문으로 바로가기
      </a>
      <div className="app-shell">
        <aside className="sidebar">
          <Brand />
          <NavigationLinks />
          {user ? (
            <div className="sidebar-user">
              <span className="sidebar-user__avatar" aria-hidden="true">
                {user.name.slice(0, 1)}
              </span>
              <span className="sidebar-user__copy">
                <strong>{user.name}</strong>
                <small>{user.provider === "google" ? "Google 계정" : user.provider === "connected" ? "연결 사용자" : "데모 모드"}</small>
              </span>
              <form action="/api/auth/logout" method="post">
                <button type="submit" aria-label="로그아웃" title="로그아웃">
                  <LogOut size={17} aria-hidden="true" />
                </button>
              </form>
            </div>
          ) : null}
        </aside>

        <div className="app-column">
          <header className="mobile-header">
            <Brand />
            <div className="mobile-account-actions">
            <Link className="mobile-logout" href="/profile" aria-label="프로필 및 계정 관리"><UserRound size={19} aria-hidden="true" /></Link>
            <form action="/api/auth/logout" method="post">
              <button className="mobile-logout" type="submit" aria-label="로그아웃">
                <LogOut size={19} aria-hidden="true" />
              </button>
            </form>
            </div>
          </header>
          <main id="main-content" className="main-content" tabIndex={-1}>
            <PushKeyNotice />
            {children}
          </main>
          <footer className="app-footer">
            IPILLGOOD는 의사·약사의 진단과 복약지도를 대신하지 않아요. 약을 임의로
            중단하거나 양을 바꾸지 마세요.
          </footer>
        </div>
      </div>
      <NavigationLinks mobile />
    </PushStatusProvider>
    </CareSyncProvider>
  );
}
