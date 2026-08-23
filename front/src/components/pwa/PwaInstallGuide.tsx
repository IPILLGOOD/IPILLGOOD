import { MoreVertical, Share } from "lucide-react";

import type { InstallEnvironment, InstallGuideMode } from "./pwa-install-environment";

export type ActiveInstallMode = "native" | InstallGuideMode;

function StepNumber({ children }: { children: React.ReactNode }) {
  return (
    <span className="pwa-install__step-number" aria-hidden="true">
      {children}
    </span>
  );
}

function GuideNote({ children }: { children: React.ReactNode }) {
  return <p className="pwa-install__guide-note">{children}</p>;
}

export function PwaInstallGuide({ mode }: { mode: ActiveInstallMode }) {
  if (mode === "native") {
    return (
      <p className="pwa-install__native-hint">
        이 브라우저에서는 아래 버튼으로 안전하게 설치창을 바로 열 수 있어요.
      </p>
    );
  }

  if (mode === "ios") {
    return (
      <div className="pwa-install__guide">
        <ol className="pwa-install__steps" aria-label="iPhone과 iPad 설치 방법">
          <li>
            <span className="pwa-install__step-icon" aria-hidden="true">
              <Share size={17} />
            </span>
            <span>브라우저의 <strong>공유</strong> 메뉴를 여세요.</span>
          </li>
          <li>
            <StepNumber>2</StepNumber>
            <span><strong>홈 화면에 추가</strong>를 선택하세요.</span>
          </li>
          <li>
            <StepNumber>3</StepNumber>
            <span>이름을 확인한 뒤 <strong>추가</strong>를 누르세요.</span>
          </li>
        </ol>
        <GuideNote>
          메뉴가 보이지 않으면 Safari에서 이 페이지를 열어 같은 순서로 진행하세요.
        </GuideNote>
      </div>
    );
  }

  if (mode === "android-firefox") {
    return (
      <div className="pwa-install__guide">
        <ol className="pwa-install__steps" aria-label="Firefox Android 설치 방법">
          <li>
            <span className="pwa-install__step-icon" aria-hidden="true">
              <MoreVertical size={18} />
            </span>
            <span>Firefox의 <strong>사이트 메뉴</strong>를 여세요.</span>
          </li>
          <li>
            <StepNumber>2</StepNumber>
            <span><strong>설치</strong>를 누르세요.</span>
          </li>
        </ol>
        <GuideNote>
          설치가 없으면 더보기에서 <strong>홈 화면에 추가</strong>를 선택하세요.
        </GuideNote>
      </div>
    );
  }

  if (mode === "android-samsung") {
    return (
      <div className="pwa-install__guide">
        <ol className="pwa-install__steps" aria-label="Samsung Internet 설치 방법">
          <li>
            <span className="pwa-install__step-icon" aria-hidden="true">
              <MoreVertical size={18} />
            </span>
            <span>Samsung Internet의 <strong>도구 또는 메뉴</strong>를 여세요.</span>
          </li>
          <li>
            <StepNumber>2</StepNumber>
            <span><strong>앱 설치</strong> 또는 <strong>홈 화면에 추가</strong>를 선택하세요.</span>
          </li>
        </ol>
        <GuideNote>메뉴 이름은 브라우저 버전에 따라 조금 다를 수 있어요.</GuideNote>
      </div>
    );
  }

  return (
    <div className="pwa-install__guide">
      <ol
        className="pwa-install__steps"
        aria-label={
          mode === "android-manual" ? "Android 브라우저 설치 방법" : "모바일 브라우저 설치 방법"
        }
      >
        <li>
          <span className="pwa-install__step-icon" aria-hidden="true">
            <MoreVertical size={18} />
          </span>
          <span>브라우저의 <strong>메뉴</strong>를 여세요.</span>
        </li>
        <li>
          <StepNumber>2</StepNumber>
          <span><strong>앱 설치</strong> 또는 <strong>홈 화면에 추가</strong>를 선택하세요.</span>
        </li>
      </ol>
      <GuideNote>메뉴가 보이지 않으면 최신 Chrome에서 다시 열어보세요.</GuideNote>
    </div>
  );
}

export function InstallEnvironmentBadge({
  environment,
  canInstallDirectly,
}: {
  environment: InstallEnvironment;
  canInstallDirectly: boolean;
}) {
  return (
    <p className="pwa-install__environment">
      <span className="pwa-install__environment-dot" aria-hidden="true" />
      {environment.browserLabel} · {environment.platformLabel}
      {canInstallDirectly ? <strong>바로 설치 가능</strong> : null}
    </p>
  );
}
