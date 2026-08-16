"use client";

import {
  ClipboardCheck,
  FileText,
  HeartPulse,
  Home,
  Pill,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { href: "/", label: "오늘", icon: Home },
  { href: "/medications", label: "복용약", icon: Pill },
  { href: "/check-in", label: "안부 확인", icon: ClipboardCheck },
  { href: "/documents", label: "문서", icon: FileText },
  { href: "/profile", label: "프로필", icon: UserRound },
];

function Brand() {
  return (
    <Link className="brand" href="/" aria-label="Care Atlas 오늘 화면으로 이동">
      <span className="brand__mark" aria-hidden="true">
        <HeartPulse size={22} strokeWidth={2.2} />
      </span>
      <span>
        <strong>Care Atlas</strong>
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
      {navigation.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
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

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        본문으로 바로가기
      </a>
      <div className="app-shell">
        <aside className="sidebar">
          <Brand />
          <NavigationLinks />
          <div className="sidebar__care-note">
            <HeartPulse size={19} aria-hidden="true" />
            <p>
              기록은 진단이 아니라
              <br />더 나은 상담을 위한 준비예요.
            </p>
          </div>
        </aside>

        <div className="app-column">
          <header className="mobile-header">
            <Brand />
          </header>
          <main id="main-content" className="main-content" tabIndex={-1}>
            {children}
          </main>
          <footer className="app-footer">
            Care Atlas는 의사·약사의 진단과 복약지도를 대신하지 않아요. 약을 임의로
            중단하거나 양을 바꾸지 마세요.
          </footer>
        </div>
      </div>
      <NavigationLinks mobile />
    </>
  );
}
