# #141 첫 작업 — 휴대폰 validation 기준선과 단계별 진단

2026-09-07 업데이트: 현재 진단은 v2-search-trace다. 반환 제한 전 실제 후보/보류 순위를 기록하며 정답 전용 축소 카탈로그 probe는 제거했다. 아래 실험 수치는 9/6 역사적 기록이고, 새 동작 보존 검사·오라클·v5 사후 진단은 [오프라인 실패 진단](pill-photo-failure-audit.md)을 따른다. `pill:diagnose` 자체의 validation-only 제한은 유지한다.

## 범위

2026-09-06, `feat/141-photo-accuracy`에서 추가한 **오프라인 진단 도구**다. 기존 모델·프롬프트·전처리·후보 검색 규칙은 변경하지 않았다. 새 AI 요청, 사용자 기능 연결, 운영 카탈로그 변경도 없다. 과거 휴대폰 holdout은 재추론/재채점/튜닝하지 않았다.

`pill:diagnose`는 저장된 **v4 validation**의 Vision / 각인 OCR / 결합 결과를 대조하고, 전체 고정 카탈로그를 현재 검색기로 다시 검색한다. 단순히 평가 방법을 적은 문서가 아니라 JSON/HTML 보고서를 생성하는 실행 코드와 회귀 테스트를 추가했다. 다만 **새 사진 인식이나 정확도 개선을 수행한 단계는 아니다.**

## 실행

Node 24 및 `npm ci`가 필요하다. `npm run dev`, Firebase 로그인, `.env.local`, OpenAI 키는 필요하지 않다.

저장소 루트에서 아래 명령을 실행한다. npm workspace 명령의 작업 디렉터리는 `backend`이므로 입력 경로는 **절대 경로**를 사용한다. 다른 컴퓨터에서는 경로를 실제 저장 위치로 바꾼다.

```sh
npm run pill:diagnose --workspace @care-atlas/backend -- --run C:/dev/IPILLGOOD/verification-artifacts/pill-photo-evaluation/run-8oPlat --compare C:/dev/IPILLGOOD/verification-artifacts/pill-photo-evaluation/run-fa53Ac
```

필요한 비공개 자료:

- `verification-artifacts/pill-photo-v4-intake/validation/manifest.local.json` 및 해시가 일치하는 validation 사진 12장.
- 각 실행 폴더의 `preflight.json`, `features.json`, `case-v4-v01.json`부터 `case-v4-v06.json`까지 6개 기록.
- 고정 전체 카탈로그는 기존 Git fixture를 사용한다. v5 holdout 자료는 이 명령에 필요하지 않다.

콘솔의 `directory` 아래 `report.html`을 브라우저로 열면 된다. 새 보고서는 Git 제외 경로 `verification-artifacts/pill-photo-diagnostics/diagnose-*`에만 저장하며 원본 실행 기록을 덮어쓰지 않는다. 사진 자체를 복제하거나 HTML에서 외부 이미지를 요청하지 않는다. **정답 참조와 판독 원문이 포함되므로 보고서를 공개 Git/외부 서비스에 올리지 않는다.**

종료 코드 0은 진단 보고서 생성 성공이다. 인식 성능의 합격은 별도 `reports[].score.passed`와 `gates`로 확인한다. 잘못된 파일, 누락 사례, holdout 입력, 원신호와 저장 특징 불일치는 exit 1이다. 자료가 없는 깨끗한 checkout은 실사진 재생이 불가능하며, 합성 자료 기반 단위 테스트만 실행할 수 있다. 이 상태를 실사진 검증 성공으로 대체하지 않는다.

```sh
node --experimental-strip-types --test backend/test-support/pill-photo-diagnostics.test.ts
npm run typecheck --workspace @care-atlas/backend
```

## 이번에 재현한 결과

두 실행 모두 같은 validation 6제품·12사진을 사용하고 Vision/OCR 모델도 `gpt-5.6-sol`이다. **전처리 버전은 다르므로 동일 조건 반복 실험이 아니다.** 당시 API 호출은 각 18회였고 이번 진단의 추가 외부 호출은 0회다.

| 저장 실행 | 전처리 | recall@1 | recall@5 | recall@20 | 강한 오답 | 재촬영 상태 후보 노출 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `run-8oPlat` | `pill-phone-centered-detail-contrast-v1` | 3/6 | 6/6 | 6/6 | 0 | 0 |
| `run-fa53Ac` | `pill-phone-centered-detail-contrast-v2` | 3/6 | 5/6 | 6/6 | 0 | 0 |

재생한 수치는 기존 Git의 [휴대폰 평가 기록](../backend/test-support/pill-photo-phone-evaluation/results-2026-09-02.json)과 모두 일치했다. 저장된 모델/프롬프트/전처리/결합/검색/카탈로그 버전도 해당 기록과 일치한다. 현재 최소 표본 수 게이트를 적용한 점수 정책은 `capture-candidate-recall-v2-minimum-sample`이며, 과거 `v1` 점수 기록과 당시 합격 여부는 수정하지 않았다.

기준 검색 규칙은 `pill-structured-v8-anchored-partial-imprint`다. 전체 카탈로그 버전, 원신호/특징/사전 점검 파일 SHA-256, 이미지 SHA-256은 생성된 JSON 보고서에 남는다. 과거 기록과의 연결은 fixture/시각/기록된 버전 대조이며, 당시 저장하지 않은 실행 코드나 이미지 변형까지 암호학적으로 증명하는 것은 아니다.

| 실행 | 저장 `features.json` SHA-256 |
| --- | --- |
| v1 | `e16efd7e96da809c7509fd091bc150c6d4a26ab2df6db0d9aac64ba6ef890b4b` |
| v2 | `236c65e2fa77c3672e900810e803cdcefcbf14af002d716c549ba4fa5a9d8162` |

## 단계별로 확인된 내용

숫자는 정답 품목의 전체 카탈로그 검색 순위다. Vision 단독 열도 같은 검색기로 재생한 **진단용 비교**이며 별도 AI 실행이 아니다.

| validation 사례 | v1 Vision → 결합 | v2 Vision → 결합 | 확인된 점 |
| --- | ---: | ---: | --- |
| `v4-v01` | 1 → 1 | 1 → 1 | 두 면 문자 관찰이 공식 각인과 일치 |
| `v4-v02` | 1 → 1 | 1 → 1 | 두 면 문자 관찰이 공식 각인과 일치 |
| `v4-v03` | 3 → 5 | 4 → 6 | 한 면은 양쪽 신호 모두 정확한 문자열을 얻지 못함. 결합 후 순위가 더 낮아짐 |
| `v4-v04` | 3 → 3 | 3 → 3 | 한 면의 문자/숫자 혼동이 남아 있음. 제한된 검색 확장으로 후보는 유지 |
| `v4-v05` | 1 → 1 | 1 → 1 | 한 면 공식 문자 필드가 비어 있어 그 면의 정확 문자 일치는 평가하지 않음 |
| `v4-v06` | 8 → 2 | 1 → 2 | v1은 OCR 대안 후보 추가가 도움. v2에서는 결합 후 순위 하락. 로고 면은 문자 exact 지표에서 제외 |

공식 각인 문자열이 있는 **10개 면만** 비교하면 Vision의 문자 exact는 v1 7/10, v2 8/10이며, OCR과 결합 후 값은 두 실행 모두 8/10이다. NFKC·공백·대소문자만 정규화한 문자열 지표이며 로고 판독, 무각인 판정, 검색의 혼동 문자 확장 성공률은 아니다. `imprint=null`을 ‘확인된 무각인’으로 바꾸지 않는다.

이 두 실행에서 결합 후보 상한 때문에 정확 문자열이 탈락한 사례는 없었고 `truncated`도 없었다. 따라서 **이번 결과의 원인을 후보 수 상한이라고 단정할 근거는 없다.** 모든 기대 품목은 상위 20개 안에 있어 ‘정답 완전 탈락’보다는 판독 오류/후보 순위 문제가 관찰된다. 이 결론을 holdout이나 전체 약품으로 일반화하지 않는다.

## 진단의 안전·해석 경계

- v4 validation의 정확히 6제품·6사례·12사진을 확인한다. 모든 요청 run의 preflight를 먼저 검증하고, holdout이면 특징/원신호/비공개 fixture 로딩 전에 중단한다.
- 원신호와 `features.json`의 특징/usage가 일치해야 한다. 원신호가 있으면 저장된 결합 특징·출처 기록을 현재 지원하는 결합 버전으로 다시 계산해 대조한다. 원신호가 없으면 `raw_signals_not_recorded`로 표시한다.
- 사례 ID와 사진 입력 순서를 검증하고 manifest의 공식 앞/뒷면 대응을 사용한다. 사진 첫 장을 무조건 공식 앞면이라고 가정하지 않는다.
- 판독/결합 문제, 안전 게이트, 정답 후보/보류/상위20 밖/검색 규칙상 탈락을 분리한다. 현재 v2 진단은 전체 카탈로그 검색에서 계산된 순위를 직접 기록한다. 정답은 검색 후 결과를 찾는 데만 사용하며 후보 생성/정렬에는 전달하지 않는다.
- 기존 기록에는 실제 전송 크롭 픽셀과 회전별 OCR 원문이 없다. `not_recorded`로 남기고 크롭 실패나 조명 문제를 자동 확정하지 않는다. Vision의 `quality`는 모델의 관찰이지 독립적인 픽셀 품질 검사 결과가 아니다.
- HTML은 모델 원문을 이스케이프하며 스크립트·외부 리소스 로딩을 금지한다. API 키를 읽는 실행 옵션과 모델 호출 코드를 추가하지 않았다.

## 다음 작업

1. 실험 조건·실행 버전을 고정하고 실제 전송 이미지 및 단계별 관찰을 재현할 기록 구조를 보완한다. 동일 조건 반복 측정과 전처리 변경 비교를 구분한다. → [두 번째 작업: `pill:trial` 준비·기록·반복 실행](pill-photo-trial.md) 구현 완료. 실제 반복 API 실험은 아직 실행하지 않았다.
2. 정답을 보여주지 않은 상태에서 **사진 품질 → 알약/면 위치 → 문자·로고/분할선 구분 → 문자 대안 후보 → 양면 일관성**으로 관찰을 구조화하는 실험을 한다. 먼저 모델을 고정하고 프롬프트 변경 하나의 효과를 비교한다.
3. OCR 결합의 순위 상승/하락을 동시에 측정한다. 한 사례만 잘 맞도록 특례나 후보 확대를 넣지 않는다. 동적 크롭·결합/검색 변경은 개별 원인 근거와 안전 회귀 검증 후 별도 단위로 진행한다.
4. 과거 holdout은 계속 동결한다. 새 블라인드 평가 세트와 합의한 통과 기준을 준비한 뒤 일반화를 검증한다. 이번 validation 진단만으로 사용자 UI/복약 계획/알림을 연결하지 않는다.

## 이번 작업 검증

- 백엔드 전체 단위 테스트 378개 통과(추가한 합성 진단 테스트 8개 포함). 로컬 자료가 있는 이번 환경의 skip은 0개이며, 깨끗한 checkout에서 같은 실사진 검증 범위를 보장한다는 뜻은 아니다.
- 후속 자체 점검 보완 후 진단 테스트 8개와 backend strict TypeScript 검사를 다시 통과했다.
- 기존 `pill:regression` 안전·검색 게이트 6/6 통과, 외부 요청 0회.
- 프로젝트 `npm run lint`, 새 백엔드 파일 대상 ESLint, `git diff --check` 통과. 새 파일 대상 검사에는 Next 페이지 경로 규칙만 제외했다(앱/공유 설정 변경 없음).
- 최종 코드로 문서의 `pill:diagnose` 명령을 다시 실행해 두 validation 기록과의 수치/버전 일치를 확인했다. 원본/키/보고서는 Git에 추가하지 않았다.
- 운영 빌드·사용자 UI 풀사이클·원격 CI는 이 오프라인 도구 단위에서 새로 실행하지 않았다.
