import { ArrowLeft, ArrowRight, Check, HeartPulse, PlayCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { GoogleSignInButton } from "./GoogleSignInButton";
import { GoogleLogo } from "./GoogleLogo";

export function LoginPanel({ errorMessage }: { errorMessage?: string }) {
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

          <div className="login-choice login-choice--google">
            <div>
              <span className="login-choice__icon"><GoogleLogo /></span>
              <span><strong>Google로 로그인</strong><small>내 Google 계정으로 안전하게 계속해요.</small></span>
            </div>
            <GoogleSignInButton />
          </div>

          <div className="login-divider" role="separator"><span>또는</span></div>

          <div className="login-choice login-choice--demo">
            <div>
              <span className="login-choice__icon"><PlayCircle size={22} aria-hidden="true" /></span>
              <span><strong>데모 로그인</strong><small>가입 없이 비식별 샘플로 모든 흐름을 둘러봐요.</small></span>
            </div>
            <form action="/api/auth/demo" method="post">
              <button className="login-demo-button" type="submit">데모로 둘러보기 <ArrowRight size={17} aria-hidden="true" /></button>
            </form>
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
