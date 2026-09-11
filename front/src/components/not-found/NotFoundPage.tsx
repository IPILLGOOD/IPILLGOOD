import { HeartPulse, House } from "lucide-react";
import Link from "next/link";

import { NotFoundAnimation } from "@/components/not-found/NotFoundAnimation";
import { getSession } from "@/lib/auth/session";

import "@/styles/not-found.css";

export async function NotFoundPage() {
  const session = await getSession();
  const homeHref = session ? "/today" : "/";

  return (
    <div className="not-found-page">
      <header className="not-found-page__header">
        <Link
          className="brand"
          href={homeHref}
          aria-label="IPILLGOOD 시작 화면으로 이동"
          prefetch={false}
        >
          <span className="brand__mark" aria-hidden="true">
            <HeartPulse size={22} strokeWidth={2.2} />
          </span>
          <strong>IPILLGOOD</strong>
        </Link>
      </header>
      <main id="main-content" className="not-found-page__main" tabIndex={-1}>
        <NotFoundAnimation />
        <h1>페이지를 찾을 수 없어요</h1>
        <p className="not-found-page__description">
          주소가 바뀌었거나 더 이상 없는 페이지예요.
          <br />
          시작 화면에서 다시 찾아볼까요?
        </p>
        <Link className="button button--primary" href={homeHref} prefetch={false}>
          <House size={19} aria-hidden="true" />
          {session ? "오늘 할 일로 돌아가기" : "홈으로 돌아가기"}
        </Link>
      </main>
      <footer className="not-found-page__footer">매일 이어지는 안심 돌봄, IPILLGOOD</footer>
    </div>
  );
}
