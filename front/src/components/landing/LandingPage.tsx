import {
  ArrowRight,
  Check,
  BellRing,
  HeartPulse,
  Leaf,
  LockKeyhole,
  MessageCircleQuestion,
  Pill,
  ScanText,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";

import { DemoLoginButton } from "@/components/auth/DemoLoginButton";
import { CareDashboardPreview } from "./CareDashboardPreview";
import { LandingHeader } from "./LandingHeader";
import { LandingMotion } from "./LandingMotion";
import { CareFlowExplorer } from "./CareFlowExplorer";
import { NutritionPreview } from "./NutritionPreview";

const journey = [
  {
    number: "01",
    eyebrow: "읽고",
    title: "약봉투를 돌봄 정보로",
    description:
      "복잡한 약 이름과 복용법을 읽어, 보호자가 원본과 대조하기 쉬운 형태로 정리합니다.",
    icon: ScanText,
  },
  {
    number: "02",
    eyebrow: "챙기고",
    title: "오늘 할 일을 시간순으로",
    description:
      "복약 알림으로 먹을 시간을 챙기고, 먹었는지 놓쳤는지를 한 번의 선택으로 기록합니다.",
    icon: Pill,
  },
  {
    number: "03",
    eyebrow: "이어가고",
    title: "기록을 다음 진료까지",
    description:
      "몸 상태와 복약 기록을 모아 다음 상담에서 확인할 흐름과 질문을 준비합니다.",
    icon: HeartPulse,
  },
];

const marqueeItems = [
  "약봉투 이해",
  "오늘 복약",
  "복약 시간 알림",
  "쉬운 약 설명",
  "몸 상태 기록",
  "식사·영양",
  "가족 돌봄",
  "다음 진료 준비",
];

export function LandingPage() {
  return (
    <LandingMotion>
      <div className="landing-page landing-page--next">
        <a className="skip-link" href="#landing-main">
          본문으로 바로가기
        </a>
        <LandingHeader />
        <main id="landing-main">
          <section className="launch-hero">
            <div className="launch-hero__mesh" aria-hidden="true" />
            <div className="launch-container launch-hero__grid">
              <div className="launch-hero__copy" data-landing-reveal>
                <div
                  className="launch-award"
                  aria-label="Codex Community Hackathon 1위 수상작"
                >
                  <span className="launch-award__mark">
                    <Image
                      src="/landing/codex-community-logo.png"
                      width={52}
                      height={52}
                      alt="Codex"
                    />
                  </span>
                  <span>
                    <small>Codex Community Hackathon</small>
                    <strong>
                      <Trophy size={14} aria-hidden="true" /> 1위 수상작
                    </strong>
                  </span>
                </div>
                <p className="launch-eyebrow">
                  <span>Care beyond the medicine bag</span>
                  <i />
                </p>
                <h1>
                  <span>약봉투 한 장을,</span>
                  <em>오늘의 돌봄으로.</em>
                </h1>
                <p className="launch-hero__lead">
                  약봉투를 이해하는 순간부터 오늘의 복약, 몸 상태 기록, 다음
                  진료 준비까지. 흩어진 돌봄을 하나의 흐름으로 연결하는 보호자
                  중심 복약/웰니스 컨설턴트 서비스입니다.
                </p>
                <div className="launch-hero__actions">
                  <Link
                    className="launch-button launch-button--solid"
                    href="/login"
                  >
                    무료로 시작하기 <ArrowRight size={18} aria-hidden="true" />
                  </Link>
                  <DemoLoginButton className="launch-button launch-button--ghost">
                    데모 화면 보기
                  </DemoLoginButton>
                </div>
                <div className="launch-hero__signals" aria-label="서비스 원칙">
                  <span>
                    <Check size={14} /> 원본 문서 미저장
                  </span>
                  <span>
                    <Check size={14} /> 공식 정보 우선
                  </span>
                  <span>
                    <Check size={14} /> 가족과 함께 기록
                  </span>
                </div>
              </div>
              <div className="launch-hero__visual" data-landing-reveal>
                <CareDashboardPreview />
              </div>
            </div>
            <div className="launch-marquee" aria-hidden="true">
              <div className="launch-marquee__track">
                {[0, 1].map((copy) => (
                  <div className="launch-marquee__group" key={copy}>
                    {Array.from({ length: 6 }, (_, repeat) =>
                      marqueeItems.map((item) => (
                        <span
                          className="launch-marquee__item"
                          key={`${repeat}-${item}`}
                        >
                          {item}
                          <i />
                        </span>
                      )),
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="launch-intro" data-landing-reveal>
            <div className="launch-container">
              <div className="launch-intro__grid">
                <p className="launch-section-index">01 / Why</p>
                <h2>
                  복용하며 생기는
                  <br />
                  작은 질문들을 놓치지 않게.
                </h2>
                <div className="launch-intro__copy">
                  <p>
                    약 이름, 어렵죠? 이 약의 직접적인 효능은 무엇인지, 같이
                    먹어도 되는건지. 오늘 먹긴 했는지, 그리고 평소와 무엇이
                    달랐는지. 보호자의 하루에는 확인해야 할 일이 계속 생깁니다.
                  </p>
                  <p>
                    IPILLGOOD는 더 많은 정보를 쌓기보다,{" "}
                    <strong>지금 확인할 것과 다음에 물어볼 것</strong>을
                    선명하게 보여줍니다.
                  </p>
                </div>
              </div>
              <CareFlowExplorer />
            </div>
          </section>

          <section
            className="launch-journey"
            id="journey"
            aria-labelledby="journey-title"
          >
            <div className="launch-container">
              <div className="launch-section-head" data-landing-reveal>
                <p className="launch-section-index">02 / One flow</p>
                <h2 id="journey-title">
                  한 장의 문서가
                  <br />
                  하루의 돌봄이 되는 과정
                </h2>
                <p>
                  기능을 따로 배우지 않아도 다음 단계가 자연스럽게 이어집니다.
                </p>
              </div>
              <ol className="launch-journey__list">
                {journey.map(
                  ({ number, eyebrow, title, description, icon: Icon }) => (
                    <li key={number} data-landing-reveal>
                      <span className="launch-journey__number">{number}</span>
                      <span className="launch-journey__icon" aria-hidden="true">
                        <Icon size={24} />
                      </span>
                      <div>
                        <small>{eyebrow}</small>
                        <h3>{title}</h3>
                        <p>{description}</p>
                      </div>
                      <ArrowRight size={22} aria-hidden="true" />
                    </li>
                  ),
                )}
              </ol>
            </div>
          </section>

          <section
            className="launch-features"
            id="features"
            aria-labelledby="features-title"
          >
            <div className="launch-container">
              <div
                className="launch-section-head launch-section-head--row"
                data-landing-reveal
              >
                <div>
                  <p className="launch-section-index">03 / Product</p>
                  <h2 id="features-title">
                    돌봄에 필요한 화면만,
                    <br />더 빠르게 이해하도록.
                  </h2>
                </div>
                <DemoLoginButton className="launch-text-link">
                  직접 둘러보기 <ArrowRight size={17} />
                </DemoLoginButton>
              </div>
              <div className="launch-feature-grid">
                <article
                  className="launch-feature launch-feature--medication"
                  data-landing-reveal
                >
                  <span className="launch-feature__icon">
                    <Pill size={21} />
                  </span>
                  <small>Medication</small>
                  <h3>
                    약 이름보다 먼저
                    <br />
                    쉬운 설명을 읽어요.
                  </h3>
                  <p>
                    일반적인 쓰임은 쉬운 말로, 실제 복용 일정은 약봉투에서
                    확인한 기록 그대로 구분합니다.
                  </p>
                  <div className="launch-mini-med">
                    <span>노바스크정 5mg</span>
                    <strong>
                      혈압을 낮추는 데<br />
                      사용되는 약이에요.
                    </strong>
                  </div>
                </article>
                <article
                  className="launch-feature launch-feature--today"
                  data-landing-reveal
                >
                  <span className="launch-feature__icon">
                    <Sparkles size={21} />
                  </span>
                  <small>Today</small>
                  <h3>
                    오늘 복용할 것을
                    <br />
                    한눈에 확인해요.
                  </h3>
                  <p className="launch-feature__reminder">
                    <BellRing size={17} aria-hidden="true" />
                    <span>
                      알림을 켜두면, 앱을 닫아도 약 먹을 시간을 알려드려요.
                    </span>
                  </p>
                  <div className="launch-mini-timeline" aria-hidden="true">
                    <span className="is-done">
                      <time>08:30</time>
                      <i />
                      <b>아침 약</b>
                    </span>
                    <span>
                      <time>13:00</time>
                      <i />
                      <b>점심 약</b>
                    </span>
                    <span>
                      <time>19:30</time>
                      <i />
                      <b>저녁 약</b>
                    </span>
                  </div>
                </article>
                <article
                  className="launch-feature launch-feature--care"
                  data-landing-reveal
                >
                  <span className="launch-feature__icon">
                    <Users size={21} />
                  </span>
                  <small>Together</small>
                  <h3>
                    같은 기록을
                    <br />
                    가족과 함께 봐요.
                  </h3>
                  <p>
                    한 명의 돌봄 대상자를 중심으로 복약과 몸 상태 기록을
                    안전하게 공유합니다.
                  </p>
                  <div className="launch-care-avatars" aria-hidden="true">
                    <i>나</i>
                    <i>보</i>
                    <span>연결됨</span>
                  </div>
                </article>
                <article
                  className="launch-feature launch-feature--nutrition"
                  data-landing-reveal
                >
                  <span className="launch-feature__icon">
                    <Leaf size={21} />
                  </span>
                  <small>Nutrition</small>
                  <h3>
                    질환에 맞는 식사 자료를
                    <br />
                    직접 찾는 수고 없이.
                  </h3>
                  <p>
                    확정된 질환을 기준으로 식단, 영양소와 같은 외부 정보/글을
                    모아 보여줍니다.
                  </p>
                  <NutritionPreview />
                </article>
              </div>
            </div>
          </section>

          <section
            className="launch-principles"
            id="principles"
            aria-labelledby="principles-title"
          >
            <div className="launch-container launch-principles__grid">
              <div className="launch-principles__lead" data-landing-reveal>
                <p className="launch-section-index">04 / Principles</p>
                <h2 id="principles-title">
                  건강 정보일수록
                  <br />
                  선명한 경계가 필요하니까.
                </h2>
                <p>서비스가 아는 것과 알 수 없는 것을 구분해 보여줍니다.</p>
              </div>
              <div className="launch-principles__list">
                <article data-landing-reveal>
                  <ShieldCheck size={22} />
                  <span>
                    <strong>공식 정보와 AI 설명을 구분</strong>
                    <small>
                      출처가 있는 정보와 쉬운 설명의 역할을 섞지 않아요.
                    </small>
                  </span>
                  <b>01</b>
                </article>
                <article data-landing-reveal>
                  <MessageCircleQuestion size={22} />
                  <span>
                    <strong>원인을 단정하지 않는 기록</strong>
                    <small>
                      변화를 결론 내리지 않고 상담할 질문으로 남겨요.
                    </small>
                  </span>
                  <b>02</b>
                </article>
                <article data-landing-reveal>
                  <LockKeyhole size={22} />
                  <span>
                    <strong>필요한 정보만 저장</strong>
                    <small>업로드한 문서 원본은 처리 후 보관하지 않아요.</small>
                  </span>
                  <b>03</b>
                </article>
              </div>
            </div>
          </section>

          <section className="launch-cta" data-landing-reveal>
            <div className="launch-cta__glow" aria-hidden="true" />
            <div className="launch-container launch-cta__inner">
              <p>From your medicine bag to everyday care.</p>
              <h2>
                바로 지금부터
                <br />
                복약 관리를 시작하세요
              </h2>
              <div>
                <Link
                  className="launch-button launch-button--light"
                  href="/login"
                >
                  IPILLGOOD 시작하기 <ArrowRight size={18} />
                </Link>
                <Link
                  className="launch-button launch-button--dark-ghost"
                  href="/preview"
                >
                  샘플 화면 둘러보기
                </Link>
              </div>
              <div className="launch-pill-scene" aria-hidden="true">
                <span className="launch-pill-scene__orbit" />
                <span className="launch-pill-scene__orbit launch-pill-scene__orbit--inner" />
                <span className="launch-pill-scene__shadow" />
                <span className="launch-capsule">
                  <i />
                  <i />
                  <b>IPILLGOOD</b>
                </span>
                <span className="launch-tablet launch-tablet--one" />
                <span className="launch-tablet launch-tablet--two" />
                <span className="launch-pill-scene__note">
                  <Check size={13} /> 모바일 환경 사용을 권장드립니다.
                </span>
              </div>
            </div>
          </section>
        </main>
        <footer className="launch-footer">
          <div className="launch-container launch-footer__inner">
            <span className="launch-brand">
              <span className="launch-brand__mark">
                <HeartPulse size={19} strokeWidth={2.3} />
              </span>
              <strong>IPILLGOOD</strong>
            </span>
            <p>약봉투에서 시작하는 매일의 돌봄.</p>
            <small>
              © 2026 IPILLGOOD · 의사와 약사의 진단 및 복약지도를 대신하지
              않습니다.
            </small>
          </div>
        </footer>
      </div>
    </LandingMotion>
  );
}
