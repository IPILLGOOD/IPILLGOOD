"use client";

import {
  CalendarCheck2,
  ArrowUpRight,
  ChevronRight,
  ShieldCheck,
  ClipboardCheck,
  FileText,
  HeartPulse,
  Leaf,
  LayoutDashboard,
  LogOut,
  Pill,
  Plus,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { SessionUser } from "@/lib/auth/session";
import { PushStatusProvider } from "@/components/notifications/PushStatusProvider";
import { PushKeyNotice } from "@/components/notifications/PushKeyNotice";
import { CareSyncProvider } from "@/components/sync/CareSyncProvider";

const navigation = [
  { href: "/today", label: "오늘 할 일", icon: CalendarCheck2, mobile: true },
  {
    href: "/dashboard",
    label: "대시보드",
    icon: LayoutDashboard,
    mobile: true,
  },
  { href: "/medications", label: "복용약", icon: Pill, mobile: true },
  { href: "/nutrition", label: "식사/영양", icon: Leaf, mobile: true },
  { href: "/check-in", label: "안부 확인", icon: ClipboardCheck, mobile: true },
  { href: "/documents", label: "문서", icon: FileText, mobile: true },
  { href: "/profile", label: "프로필", icon: UserRound, mobile: false },
];

function Brand() {
  return (
    <Link
      className="brand"
      href="/today"
      aria-label="IPILLGOOD 오늘 할 일 화면으로 이동"
    >
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
        .map(({ href, label, icon: Icon }, index) => {
          const active = pathname.startsWith(href);
          return (
            <Fragment key={href}>
              {mobile && index === 3 ? <MobileQuickAction /> : null}
              <Link
                href={href}
                className={active ? "nav-link nav-link--active" : "nav-link"}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={mobile ? 21 : 20} aria-hidden="true" />
                <span>{label}</span>
                {!mobile ? (
                  <ChevronRight
                    className="nav-link__arrow"
                    size={15}
                    aria-hidden="true"
                  />
                ) : null}
              </Link>
            </Fragment>
          );
        })}
    </nav>
  );
}

function MobileQuickAction() {
  const [open, setOpen] = useState(false);
  const triggerButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerButton.current?.focus());
  };
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "Tab") {
        const controls = dialogRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
        if (!controls?.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <>
      <button
        ref={triggerButton}
        className="mobile-quick-action"
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="mobile-quick-action-dialog"
      >
        <span>
          <Plus size={29} strokeWidth={2.4} aria-hidden="true" />
        </span>
        <small>빠른 기록</small>
      </button>
      {open
        ? createPortal(
            <div
              className="mobile-quick-action__backdrop"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) close();
              }}
            >
              <section
                ref={dialogRef}
                id="mobile-quick-action-dialog"
                className="mobile-quick-action__dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="quick-action-title"
              >
                <span className="mobile-quick-action__dialog-icon">
                  <Plus size={22} aria-hidden="true" />
                </span>
                <h2 id="quick-action-title">무엇을 기록할까요?</h2>
                <p>필요한 기록 화면으로 바로 이동하세요.</p>
                <div className="mobile-quick-action__links">
                  <Link className="button button--secondary" href="/dashboard" onClick={close}>복용 여부 기록</Link>
                  <Link className="button button--secondary" href="/check-in" onClick={close}>오늘 몸 상태 기록</Link>
                  <Link className="button button--secondary" href="/documents" onClick={close}>처방전·약봉투 등록</Link>
                </div>
                <button
                  ref={closeButton}
                  className="button button--primary"
                  type="button"
                  onClick={close}
                >
                  닫기
                </button>
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function AppShell({
  children,
  user,
  pushSessionKey,
}: {
  children: React.ReactNode;
  user: SessionUser | null;
  pushSessionKey: string;
}) {
  const pathname = usePathname();
  const isPublicPage =
    pathname.startsWith("/preview") ||
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/account/recovery" ||
    pathname === "/404";

  if (isPublicPage) return children;
  const currentPage =
    navigation.find((item) => pathname.startsWith(item.href))?.label ??
    (pathname.startsWith("/report") ? "상담용 기록" : "나의 돌봄");

  return (
    <CareSyncProvider
      enabled={Boolean(user && user.provider !== "demo")}
      connected={user?.provider === "connected"}
    >
      <PushStatusProvider
        key={`${user?.provider}:${user?.id}:${pushSessionKey}`}
        enabled={Boolean(user)}
        sessionKey={pushSessionKey}
      >
        <a className="skip-link" href="#main-content">
          본문으로 바로가기
        </a>
        <div className="app-shell experience-shell">
          <aside className="sidebar">
            <Brand />
            <p className="sidebar-section-label">나의 돌봄 공간</p>
            <NavigationLinks />
            <Link className="sidebar-guide" href="/documents">
              <span className="sidebar-guide__icon">
                <FileText size={19} aria-hidden="true" />
              </span>
              <strong>처방전에서 시작하는 돌봄</strong>
              <span>
                새 문서를 등록하고
                <br />
                복약 정보를 모아보세요.
              </span>
              <span className="sidebar-guide__action">
                문서 등록 <ArrowUpRight size={15} aria-hidden="true" />
              </span>
            </Link>
            {user ? (
              <div className="sidebar-user">
                <span className="sidebar-user__avatar" aria-hidden="true">
                  {user.name.slice(0, 1)}
                </span>
                <span className="sidebar-user__copy">
                  <strong>{user.name}</strong>
                  <small>
                    {user.provider === "google"
                      ? "Google 계정"
                      : user.provider === "connected"
                        ? "연결된 사용자"
                        : "데모 모드"}
                  </small>
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
            <div className="workspace-context" aria-label="현재 위치">
              <span>
                나의 돌봄 공간 <ChevronRight size={14} aria-hidden="true" />{" "}
                <strong>{currentPage}</strong>
              </span>
              <span className="workspace-context__privacy">
                <ShieldCheck size={15} aria-hidden="true" /> 함께 지키는 돌봄
                기록
              </span>
            </div>
            <header className="mobile-header">
              <Brand />
              <div className="mobile-account-actions">
                <Link
                  className="mobile-logout"
                  href="/profile"
                  aria-label="프로필 및 계정 관리"
                >
                  <UserRound size={19} aria-hidden="true" />
                </Link>
                <form action="/api/auth/logout" method="post">
                  <button
                    className="mobile-logout"
                    type="submit"
                    aria-label="로그아웃"
                  >
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
              IPILLGOOD는 의사·약사의 진단과 복약지도를 대신하지 않아요. 약을
              임의로 중단하거나 양을 바꾸지 마세요.
            </footer>
          </div>
        </div>
        <NavigationLinks mobile />
      </PushStatusProvider>
    </CareSyncProvider>
  );
}
