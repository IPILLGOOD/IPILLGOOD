# 접근성 구현과 검증

본문과 컨트롤은 한국어 레이블, 키보드 포커스, 오류 연결과 상태 안내를 제공한다. 터치 영역은 44 CSS px를 제품 목표로 삼으며, 상태를 색만으로 구분하지 않는다. 오류는 `alert`, 성공은 `status`를 사용하고 불필요한 live region 중첩을 피한다. 움직임은 `prefers-reduced-motion`을 존중한다.

## 자동 검사

[접근성 E2E](../front/e2e/accessibility.spec.ts)와 기능별 브라우저 검사는 로그인·프로필 동의·문서 대기/실패/재시도·안부·알림·로그아웃을 다룬다. Chromium/WebKit, 320·768·1024·1440 CSS px, 320px에서 루트 글꼴 200% 조건으로 가로 넘침·컨트롤·axe WCAG 규칙을 검사한다. PWA 셸 검사는 390px도 포함한다.

Tab으로 컨트롤에 도달해 표시되는 포커스를 확인한다. macOS headless Chromium의 native select는 방향키 동작 제약 때문에 Tab 도달 후 `selectOption`을 사용하고, Linux에서는 방향키와 실제 값 변경을 검사한다. 실행 환경과 사용한 보조 동작을 첨부 결과에 남긴다.

```sh
npm ci
npx playwright install --with-deps chromium webkit
npm run verify -- --account-full-cycle
```

Node 24와 Java 21이 필요하며 실제 서비스 설정이 없는 checkout에서 실행한다. 결과는 `verification-artifacts/`, `test-results/`, `playwright-report/`에 생성한다. 컨트롤 측정은 실제 클릭하는 label을 포함하고, disabled 항목을 구분한다. 24px 미달은 간격·예외 조건을 검토해야 하며 axe의 `incomplete`는 통과로 처리하지 않는다.

## 수동 확인이 필요한 범위

- iOS Safari·설치형 PWA의 VoiceOver와 Android Chrome·PWA의 TalkBack: 이름·역할·값, 읽기 순서, 비동기 오류·완료 안내, 포커스 복귀.
- OS 파일 선택기, Google 인증, Push 권한창과 시스템 알림: 진입·취소·재시도·로그아웃.
- 실제 브라우저 확대와 OS 글자 크기: 고정 내비게이션에 가려지는 항목과 읽기·터치 가능 여부.
- 자동 대비 검사에서 판정하지 못한 요소와 실제 고령 사용자의 과업 수행.

브라우저 모사와 axe 위반 0건만으로 접근성 준수 인증이나 실기기 검증 완료를 주장하지 않는다.
