import {
  ArrowRight,
  BookOpenCheck,
  Check,
  FileHeart,
  FileSearch,
  ListChecks,
  LockKeyhole,
  MessageCircleQuestion,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { CareDashboardPreview } from "./CareDashboardPreview";
import { LandingHeader } from "./LandingHeader";

const steps = [
  { number: "01", icon: FileSearch, title: "처방전을 올려주세요", description: "약 이름과 복용법을 읽고, 보호자가 원본과 확인할 수 있게 정리해요." },
  { number: "02", icon: ListChecks, title: "오늘의 돌봄을 확인해요", description: "복용 시간과 관찰할 몸의 변화를 쉬운 말로 한 화면에서 보여드려요." },
  { number: "03", icon: FileHeart, title: "다음 진료를 준비해요", description: "매일의 기록을 시간순으로 모아 의료진에게 물어볼 질문으로 바꿔요." },
];

export function LandingPage() {
  return (
    <div className="landing-page">
      <a className="skip-link" href="#landing-main">본문으로 바로가기</a>
      <LandingHeader />
      <main id="landing-main">
        <section className="landing-hero">
          <div className="landing-container landing-hero__grid">
            <div className="landing-hero__copy">
              <p className="landing-kicker"><ShieldCheck size={16} aria-hidden="true" /> 보호자를 위한 복약·돌봄 기록</p>
              <h1>약을 챙기는 일을,<br /><span>돌봄을 이어가는 기록으로.</span></h1>
              <p className="landing-hero__lead">
                처방전 한 장을 오늘의 복약 대시보드로 바꾸고, 매일의 짧은 답변을 다음 진료에 가져갈 기록으로 쌓아보세요.
              </p>
              <div className="landing-hero__actions">
                <Link className="landing-button landing-button--primary" href="/login">
                  무료로 시작하기 <ArrowRight size={18} aria-hidden="true" />
                </Link>
                <form action="/api/auth/demo" method="post">
                  <button className="landing-button landing-button--secondary" type="submit">데모로 먼저 보기</button>
                </form>
              </div>
              <ul className="landing-hero__assurances" aria-label="서비스 안심 원칙">
                <li><Check size={15} aria-hidden="true" /> 원본 문서 미저장</li>
                <li><Check size={15} aria-hidden="true" /> 공식 정보 우선</li>
                <li><Check size={15} aria-hidden="true" /> 진단·처방 변경 없음</li>
              </ul>
            </div>
            <div className="landing-hero__visual">
              <span className="landing-hero__visual-label">처방 이후의 하루를 한눈에</span>
              <CareDashboardPreview />
            </div>
          </div>
        </section>

        <section className="landing-problem" aria-labelledby="problem-title">
          <div className="landing-container landing-problem__grid">
            <div>
              <p className="landing-section-label">병원 밖에서 시작되는 돌봄</p>
              <h2 id="problem-title">처방전은 병원에서 끝나지만, 돌봄은 매일 이어집니다.</h2>
            </div>
            <div className="landing-problem__copy">
              <p>어려운 약 이름, 여러 장의 메모, 뒤늦게 떠오르는 질문. 보호자는 약의 목적과 실제 복용 여부, 몸 상태 변화를 서로 다른 곳에서 기억해야 했어요.</p>
              <p>Care Atlas는 정보를 더 많이 보여주는 대신, <strong>오늘 무엇을 확인하고 누구에게 무엇을 물어볼지</strong> 알 수 있게 정리합니다.</p>
            </div>
          </div>
        </section>

        <section className="landing-flow" id="how-it-works" aria-labelledby="flow-title">
          <div className="landing-container">
            <div className="landing-section-heading">
              <p className="landing-section-label">하나의 이어지는 흐름</p>
              <h2 id="flow-title">사진 한 장에서 다음 진료까지</h2>
              <p>일회성 약 검색이 아니라, 처방 이후의 돌봄 과정을 연결합니다.</p>
            </div>
            <ol className="landing-steps">
              {steps.map(({ number, icon: Icon, title, description }) => (
                <li key={number}>
                  <span className="landing-step__number">{number}</span>
                  <span className="landing-step__icon" aria-hidden="true"><Icon size={23} /></span>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="landing-safety" id="safety" aria-labelledby="safety-title">
          <div className="landing-container landing-safety__grid">
            <div className="landing-safety__intro">
              <p className="landing-section-label">안심하고 기록할 수 있도록</p>
              <h2 id="safety-title">판단 대신 이해와 기록을 돕습니다.</h2>
              <p>Care Atlas는 의료진을 대신하지 않습니다. 확인된 정보의 출처와 한계를 드러내고, 보호자가 더 나은 질문을 준비하도록 돕습니다.</p>
            </div>
            <div className="landing-safety__list">
              <article><BookOpenCheck size={22} aria-hidden="true" /><div><h3>공식 정보와 분리된 AI</h3><p>약 이름과 주의 정보는 공식 데이터를 우선하고, AI는 쉬운 설명을 만드는 데 사용해요.</p></div></article>
              <article><MessageCircleQuestion size={22} aria-hidden="true" /><div><h3>인과관계를 단정하지 않아요</h3><p>약 변경과 증상이 비슷한 시기에 있어도 원인으로 결론 내리지 않고 상담 질문으로 정리해요.</p></div></article>
              <article><LockKeyhole size={22} aria-hidden="true" /><div><h3>필요한 정보만 다뤄요</h3><p>업로드한 문서 원본은 저장하지 않고, 보호자가 확인한 돌봄 기록만 남겨요.</p></div></article>
            </div>
          </div>
        </section>

        <section className="landing-final-cta" aria-labelledby="final-cta-title">
          <div className="landing-container landing-final-cta__inner">
            <div>
              <p className="landing-section-label">오늘부터 이어지는 안심 돌봄</p>
              <h2 id="final-cta-title">다음 진료에서 기억에만 의존하지 마세요.</h2>
              <p>오늘의 작은 확인을 가족이 함께 보는 돌봄 기록으로 남겨보세요.</p>
            </div>
            <Link className="landing-button landing-button--light" href="/login">Care Atlas 시작하기 <ArrowRight size={18} aria-hidden="true" /></Link>
          </div>
        </section>
      </main>
      <footer className="landing-footer">
        <div className="landing-container landing-footer__inner"><span>© 2026 Care Atlas</span><span>의사·약사의 진단과 복약지도를 대신하지 않습니다.</span></div>
      </footer>
    </div>
  );
}
