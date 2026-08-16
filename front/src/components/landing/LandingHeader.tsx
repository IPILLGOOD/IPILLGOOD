import { ArrowRight, HeartPulse } from "lucide-react";
import Link from "next/link";

export function LandingHeader() {
  return (
    <header className="landing-header">
      <div className="landing-container landing-header__inner">
        <Link className="landing-brand" href="/" aria-label="Care Atlas 홈">
          <span className="landing-brand__mark" aria-hidden="true"><HeartPulse size={20} strokeWidth={2.2} /></span>
          <strong>Care Atlas</strong>
        </Link>
        <nav className="landing-nav" aria-label="랜딩 페이지 메뉴">
          <a href="#how-it-works">이용 방법</a>
          <a href="#safety">안심 원칙</a>
        </nav>
        <Link className="landing-header__cta" href="/login">
          시작하기 <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </header>
  );
}
