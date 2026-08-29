"use client";

import { ArrowLeft, ArrowRight, Check, HeartPulse, Link2, PlayCircle, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { DemoLoginButton } from "./DemoLoginButton";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { GoogleLogo } from "./GoogleLogo";

export function LoginPanel({ errorMessage, successMessage }: { errorMessage?: string; successMessage?: string }) {
  const [method, setMethod] = useState<"google" | "connection">("google");

  return (
    <main className="login-page" id="main-content">
      <div className="login-page__brand-column">
        <Link className="login-back" href="/"><ArrowLeft size={17} aria-hidden="true" /> 홈으로</Link>
        <div className="login-brand-copy">
          <span className="login-brand-mark" aria-hidden="true"><HeartPulse size={25} /></span>
          <p className="landing-section-label">IPILLGOOD</p>
          <h1>오늘의 확인이<br />내일의 안심이 되도록.</h1>
          <p>처방 이후의 복약과 몸 상태를 가족이 함께 살피고, 다음 진료에 가져갈 기록으로 이어가세요.</p>
        </div>
        <ul className="login-benefits">
          <li><Check size={16} aria-hidden="true" /> 처방 정보를 쉬운 말로 정리</li>
          <li><Check size={16} aria-hidden="true" /> 매일 1분 복약·몸 상태 확인</li>
          <li><Check size={16} aria-hidden="true" /> 의료진에게 물어볼 질문 준비</li>
        </ul>
      </div>

      <div className="login-page__panel-column">
        <section className="login-panel" aria-labelledby="login-title">
          <div className="login-panel__heading">
            <span className="login-panel__secure"><ShieldCheck size={15} aria-hidden="true" /> 안전한 로그인</span>
            <h2 id="login-title">IPILLGOOD 시작하기</h2>
            <p>원하는 방법을 선택하세요. 데모에서는 비식별 샘플만 사용합니다.</p>
          </div>

          {errorMessage ? <p className="login-error" role="alert">{errorMessage}</p> : null}
          {successMessage ? <p className="account-deletion-notice" role="status">{successMessage}</p> : null}

          <div className="login-access-card">
            <div className="login-method-tabs" role="tablist" aria-label="로그인 방법">
              <button aria-controls="login-method-panel" aria-selected={method === "google"} className={method === "google" ? "login-method-tab login-method-tab--active" : "login-method-tab"} onClick={() => setMethod("google")} role="tab" type="button">
                <UserRound size={17} aria-hidden="true" /> 내 계정
              </button>
              <button aria-controls="login-method-panel" aria-selected={method === "connection"} className={method === "connection" ? "login-method-tab login-method-tab--active" : "login-method-tab"} onClick={() => setMethod("connection")} role="tab" type="button">
                <Link2 size={17} aria-hidden="true" /> 연결 코드
              </button>
            </div>

            <div className="login-method-panel" id="login-method-panel" role="tabpanel">
              {method === "google" ? (
                <>
                  <div className="login-method-copy">
                    <span className="login-choice__icon"><GoogleLogo /></span>
                    <span><strong>Google 계정으로 시작하기</strong><small>돌봄 기록을 만들고 함께 사용할 사람을 초대할 수 있어요.</small></span>
                  </div>
                  <GoogleSignInButton />
                </>
              ) : (
                <>
                  <div className="login-method-copy">
                    <span className="login-choice__icon"><Link2 size={22} aria-hidden="true" /></span>
                    <span><strong>초대받은 돌봄 화면 연결하기</strong><small>전달받은 8자리 코드만 입력하면 같은 화면을 바로 볼 수 있어요.</small></span>
                  </div>
                  <form className="connection-login-form" action="/api/auth/connection/redeem" method="post">
                    <label htmlFor="connection-code">연결 코드</label>
                    <div className="connection-login-form__row">
                      <input id="connection-code" name="code" inputMode="text" autoComplete="one-time-code" minLength={8} maxLength={20} placeholder="ABCD-EFGH" required />
                      <button className="login-demo-button" type="submit">연결하기 <ArrowRight size={17} aria-hidden="true" /></button>
                    </div>
                  </form>
                </>
              )}
            </div>
          </div>

          <div className="login-divider" role="separator"><span>서비스를 먼저 둘러보고 싶다면</span></div>

          <div className="login-demo-entry">
            <span className="login-demo-entry__icon"><PlayCircle size={20} aria-hidden="true" /></span>
            <span><strong>체험 모드</strong><small>가입 없이 비식별 샘플로 둘러봐요.</small></span>
            <DemoLoginButton ariaLabel="데모로 둘러보기" className="login-demo-button">
              둘러보기 <ArrowRight size={16} aria-hidden="true" />
            </DemoLoginButton>
          </div>

          <p className="login-panel__notice">
            로그인하면 서비스 이용 목적의 최소 계정 정보 처리에 동의하게 됩니다.
            IPILLGOOD는 의료진의 진단이나 복약지도를 대신하지 않습니다.
          </p>
        </section>
      </div>
    </main>
  );
}
