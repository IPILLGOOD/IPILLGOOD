# 핵심 흐름 접근성 감사 — #64

## 상태와 환경

2026-08-28, `codex/issue-64-accessibility-audit`. 기반 커밋은 `61b2f978`이다.
이 문서는 **자동 감사와 재현 가능한 결함 수정 기록**이며, 접근성 준수 인증이나 #64의 전체 완료 판정이 아니다.

- macOS, Node 23.3.0, Java 21, Playwright Chromium, axe-core 4.11.0, Next.js production build. CI는 Node 24로 설정되어 있다.
- 로컬 Firestore/Auth Emulator의 매 실행마다 새로운 `demo-` 프로젝트와 비식별 데이터만 사용한다. 외부 OAuth·AI·실제 Push 요청은 차단한다.
- 320·768·1024·1440 CSS px 화면을 확인한다. 320px에서 루트 글꼴을 200%로 키워 텍스트 확대 스트레스 검사를 한다. 실제 브라우저 확대, OS 글자 크기 설정 또는 실제 Android/iOS 검사를 대신하지 않는다.
- Android 사용자 에이전트는 Push 영역의 렌더링 조건을 확인하기 위한 모사에만 사용한다. 실제 Android 기기나 TalkBack이 아니다.

## 발견 사항과 수정

| 발견 사항 | 재현·영향 | 관련 기준 | 판정·수정 |
| --- | --- | --- | --- |
| 오늘 화면의 compact 질문 선택창 높이 28px | 데스크톱·320px에서 3개 선택창. 작은 터치 영역이 어려운 사용자 | WCAG 2.5.8, 별도 44px 제품 목표 | 24px 크기는 충족하므로 이 사실만으로 AA 위반은 아니다. 최소 높이 44px, 너비·테두리·여백을 명시했다. |
| 200% 텍스트에서 오늘 화면 가로 넘침 | 320px, 진행 카드·복약 목록·확인한 사람 선택창의 최소 콘텐츠 너비 | WCAG 1.4.4·1.4.10 | grid 최소 너비와 native fieldset/select 크기를 제한하고 헤더·복약 행·질문 레이아웃이 줄바꿈하도록 수정했다. 가로 넘침을 숨기는 방식은 사용하지 않았다. |
| 프로필 오류의 상태·연결 부족 | 이름/나이 서버 검증 오류, 동의 오류 | WCAG 3.3.1·4.1.2 | `aria-invalid` 및 동의 오류의 `aria-describedby` 연결을 추가했다. 이름/나이의 기존 설명 연결은 유지한다. |
| 오류 live region의 중첩·우선순위 혼재 | Push 오류의 polite 부모 + alert 자식, FormMessage의 alert + polite | WCAG 4.1.3 | 중첩 live region을 제거하고 성공은 status, 오류는 alert의 기본 우선순위를 사용한다. 실제 낭독 횟수와 순서는 기기 검사에서 확인해야 한다. |

모두 P2로 분류하며 [후속 이슈 #105](https://github.com/IPILLGOOD/IPILLGOOD/issues/105)에서 수정 상태를 추적한다. 전체 화면 구조, 큰 글씨 설정, 자체 TTS, 사용자 데이터 정책은 변경하지 않는다.

## 자동 검증의 범위

| 흐름 | 검사한 상태·상호작용 | 아직 확인하지 않은 범위 |
| --- | --- | --- |
| 로그인 | 진입, 오류 쿼리 안내, Tab/Enter로 데모 로그인 | 실제 Google 계정 선택·팝업·리디렉션·복구, VoiceOver/TalkBack |
| 프로필·동의 | 컨트롤 inventory, Tab/Space로 동의 변경, 키보드로 이름·나이 입력, 서버 검증 오류와 수정 후 저장 성공 | 다른 필드의 모든 오류 조합, 실제 낭독 순서 |
| 문서 | 종류·파일 입력 inventory, 샘플 분석의 대기·주입한 503 오류·재시도·실제 데모 분석 성공 | OS 파일 선택창, 실파일 업로드, 외부 분석기의 부분 성공, 네이티브 대화상자 낭독 |
| 오늘·안부 | 키보드로 메모·질문 답변·오늘 안부 저장, 성공 안내. 상세 체크인 폼의 기본 상태와 확대 검사 | 상세 체크인의 모든 오류/복구 상태에 대한 보조기술 검사 |
| Push | 모사한 모바일 환경의 로딩·주입한 설정 실패·실제 미설정 안내, 오류의 중첩 live region 부재 | 실제 기기 권한창, 활성화·발송·해제, OS 알림, 설치 PWA 상태 |
| 로그아웃 | 키보드로 실행 후 홈 복귀 | 실제 모바일 보조기술과 함께 실행 |

`tabTo`는 DOM focus 호출 대신 Tab 키로 목표 컨트롤에 도달하고, `:focus-visible`과 기존 outline/그림자 표시를 검사한다. 이를 실제 사용자에 의한 키보드·화면 낭독기 감사 전체의 대체로 해석하지 않는다.

macOS headless Chromium에서는 단순 HTML select에서도 방향키가 값을 바꾸지 않는 실행 환경 제한이 재현됐다. 로컬 테스트에서는 Tab 도달을 확인한 뒤 selectOption으로 질문 값을 선택한다. Linux CI에서는 방향키로 선택하고 실제 값 변경을 검사한다. 실행 플랫폼과 보조 함수 사용 여부를 `native-select-keyboard` 첨부에 남긴다. 따라서 로컬 결과를 완전한 키보드 단독 과업 성공으로 표현하지 않는다.

## 재현과 산출물

로컬 전체 검증에서 단위 테스트 122개, Emulator 계약 테스트 6개, 브라우저/API 시나리오 5개가 통과했고 typecheck·lint·production build도 통과했다. 자동 감사의 세부 결과는 다음과 같다. 컨트롤 수는 화면·상태 간 중복을 포함한다.

| 화면·상태 묶음 | 검사 상태 수 | 컨트롤 측정 수 | 44px 미달 | 24px 미달 | axe 위반 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 데스크톱 기본·오류·대기·성공 | 13 | 233 | 0 | 0 | 0 |
| 320px 기본 | 5 | 97 | 0 | 0 | 0 |
| 320px/200% 텍스트 | 4 | 94 | 0 | 0 | 0 |
| 768·1024·1440px 오늘 화면 | 3 | 74 | 0 | 0 | 0 |
| Push 상태 | 3 | 72 | 0 | 0 | 0 |
| 합계 | 28 | 570 | 0 | 0 | 0 |

일부 `color-contrast` 노드는 axe가 `incomplete`로 분류했다. 예외로 제외하거나 통과 처리하지 않았으며 원본 JSON에 남겼다. 이 노드의 수동 대비 판정과 실제 보조기술 검증은 아직 필요하다. 현재 측정한 컨트롤에서는 44px 미달 예외가 없지만 측정하지 않은 OS·OAuth·Push UI까지 같은 판정을 적용하지 않는다.

깨끗한 worktree에서 Node 24, Java 21, Playwright Chromium을 설치하고 `npm ci` 후 `npm run verify`를 실행한다. `.env`와 실제 서비스 자격 증명은 사용하지 않는다.

- 테스트: `front/e2e/accessibility.spec.ts`
- 단계별 결과: `verification-artifacts/verification.json`
- 화면별 컨트롤 목록·44px/24px 판정·axe violations/incomplete: `verification-artifacts/accessibility/*.json`
- 화면 캡처: 같은 폴더의 PNG. 실제 페이지를 캡처한 것이며 디자인 시안이 아니다.
- Playwright trace·첨부 결과: `test-results/`, `playwright-report/`
- GitHub Actions는 위 산출물을 `verification-results`로 7일 보관한다.

inventory는 label 전체가 실제 클릭 영역인 checkbox/radio/file input에서 해당 label의 크기를 측정한다. 숨겨진 컨트롤은 제외하며 disabled 항목은 별도 표시한다. 24px 미달은 spacing/exception을 확인하기 전 자동으로 위반으로 단정하지 않는다. axe `incomplete`는 사람이 검토해야 하며 violations 0만으로 AA 준수를 선언하지 않는다.

## #64 종료 전 필수 수동 검사

다음 환경을 사용할 수 없어 검증하지 않았다. **이 항목이 남아 있는 동안 #64를 닫지 않는다.**

| 환경 | 기록할 정보 | 대표 과업 |
| --- | --- | --- |
| iOS Safari + VoiceOver | 기기·OS·브라우저 버전, 200% 설정, 실제 읽은 순서·문구, focus 위치 | 프로필·동의, 파일 선택·분석 성공/실패/재시도, 안부 저장, Google 로그인 복구, PWA Push 활성화·발송·해제, 로그아웃 |
| Android Chrome + TalkBack | 같은 정보, 브라우저/PWA 구분 | 동일 과업, 모든 이름·역할·값·오류 및 중복/누락 안내 확인 |
| 데스크톱 키보드 실제 조작 | OS·브라우저·확대 설정, Tab 순서, 모달/비동기 완료 후 focus | 파일 선택·OAuth·Push 권한창을 포함한 전체 과업 |

색만으로 상태를 구분하는지, 컨트롤이 고정 내비게이션에 가려지는지, 44px 미달 영역의 간격·예외, 실시간 안내의 중복/누락도 함께 기록한다. 추가 결함은 환경·재현 단계·영향 사용자·WCAG 항목·우선순위를 갖춘 후속 이슈로 등록한다. 실제 고령 사용자 사용성 연구는 #90의 범위다.
