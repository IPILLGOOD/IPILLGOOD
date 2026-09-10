import { ArrowUpRight, HeartPulse } from "lucide-react";
import Link from "next/link";

export function LandingHeader() {
  return (
    <header className="launch-header">
      <div className="launch-container launch-header__inner">
        <Link className="launch-brand" href="/" aria-label="IPILLGOOD 홈">
          <span className="launch-brand__mark" aria-hidden="true">
            <HeartPulse size={19} strokeWidth={2.3} />
          </span>
          <strong>IPILLGOOD</strong>
          <small>v2.</small>
        </Link>
        <nav className="launch-nav" aria-label="랜딩 페이지 메뉴">
          <a href="#journey">서비스 흐름</a>
          <a href="#features">주요 기능</a>
          <a href="#principles">안심 원칙</a>
        </nav>
        <Link className="launch-header__cta" href="/login">
          시작하기 <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </header>
  );
}
