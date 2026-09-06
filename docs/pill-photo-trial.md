# #141 두 번째 작업 — 전송 이미지 기록과 조건 고정 반복 실험

이 문서는 `c6ade2a`에서 완료한 두 번째 작업의 기록이다. 이후 진행한 실제 API 반복 측정과 새 Vision 프롬프트 비교는 [세 번째 작업 결과](pill-photo-prompt-experiment.md)에 별도로 기록한다. 아래의 “이번 작업에서는 호출하지 않았다”는 두 번째 작업 범위에 한정된다.

## 완료 범위

`pill:trial`은 기존 사진 추출기를 사용하는 **v4 validation 전용 실험 실행기**다. 실제 API 요청에 들어갈 전처리 이미지를 먼저 저장하고, 같은 조건으로 6제품을 3회 평가할 수 있게 했다. 이번 작업에서는 준비와 모의 응답 검증만 실행했다. **새로운 유료 API 요청과 정확도 개선 결과는 없다.**

기존 모델·프롬프트·전처리·결합·검색 규칙은 바꾸지 않았다. 사용자 UI, 복약 계획·알림, 운영 카탈로그에도 연결하지 않았다. 과거 holdout은 재추론·재채점·튜닝하지 않으며 이 명령에서 선택할 수도 없다.

## 고정 기준 조건

| 항목 | `validation-baseline-v1` |
| --- | --- |
| 자료 | v4 validation, 정확히 6제품·6사례·12사진 |
| 반복 | 전체 6사례를 순서대로 3회, 최대 54요청 |
| Vision / 각인 OCR | `gpt-5.6-sol` / `gpt-5.6-sol` |
| 전처리 | `pill-phone-centered-detail-contrast-v1` |
| Vision 프롬프트 | `pill-photo-observation-v3-multiview` |
| OCR 프롬프트 | `pill-photo-imprint-ocr-per-side-dual-view-v2` |
| 결합 / 검색 | `pill-photo-vision-ocr-consensus-v1` / `pill-structured-v8-anchored-partial-imprint` |
| 요청 설정 | reasoning `low`, image detail `high`, `store: false` |
| 출력 토큰 상한 | Vision 2,400 / 면별 OCR 1,400 |
| 실패 처리 | 자동 재시도 없음. 추출 실패나 기록 실패 시 후속 요청 중단 |

이는 지난 `run-8oPlat`의 모델·전처리를 기준으로 삼은 **앞으로의 비교 조건**이다. 새 요청/코드 해시로 과거 실행까지 소급 증명하지 않는다. 3회 실행해도 독립 제품은 6종이며, 18종 평가라고 표현하지 않는다. 성공한 회차만 선택하거나 평균으로 실패를 숨기지 않고 회차별 recall@1/5/20, 강한 오답, 재촬영 상태 후보 노출 및 사례별 순위·후보·보류·사유 변화를 함께 기록한다.

모델 이름은 고정하지만 불변 모델 스냅샷을 지정한 것은 아니다(`modelSnapshotPinned: false`). 같은 요청이어도 답이 같다고 보장하지 않는다. 응답의 모델 태그와 `x-request-id`를 함께 기록한다. 요청 ID 기록과 모델 버전별 평가의 필요성은 [OpenAI 공식 API 안내](https://developers.openai.com/api/reference/overview)에 따른다. 응답의 모델 태그만으로 가중치가 같음을 증명할 수도 없다.

## 1. API 전송 없이 준비하기

Node 24와 설치된 의존성, 검수된 로컬 v4 매니페스트 및 사진 12장이 필요하다. `npm run dev`, Firebase 로그인, OpenAI 키는 필요하지 않다. 루트에서 실행한다.

```sh
npm run pill:trial --workspace @care-atlas/backend -- prepare
```

콘솔의 `directory` 아래에 다음이 생긴다.

| 파일 | 용도 |
| --- | --- |
| `plan.json` | 자료·카탈로그·코드·런타임·프롬프트·요청 본문 해시와 크롭 좌표 |
| `images/<SHA-256>.png` | 실제 요청 본문에서 추출한 전송 예정 이미지 바이트 |
| `preview.html` | 전체/세부 크롭과 회전·대비 이미지를 확인하는 로컬 미리보기 |

`preview.html`을 브라우저로 열고 사례를 펼쳐서 본다. 외부 리소스나 JavaScript를 사용하지 않는다. 기존 중앙 크롭이 각인을 자르는지 **눈으로 확인할 근거**이지, 알약 검출이나 품질 검사를 새로 구현한 것은 아니다.

1사례의 요청 이미지 배치는 Vision 4개 + 앞면 OCR 8개 + 뒷면 OCR 8개다. 같은 바이트의 중복 파일은 해시로 하나만 저장한다. 이번 실제 12사진 준비에서는 120개 배치에 고유 PNG 108개가 생성됐다. 이는 사진 108장이나 독립 표본 108개가 아니다. OCR 회전 8개는 한 면에 대한 한 요청의 입력이며, **회전별 독립 OCR 출력은 아직 없다.**

`plan.json`에는 이미지의 원본 base64 대신 해시·크기·경로가 들어간 설명을 저장한다. 이 설명을 그대로 API에 보내지 않는다. 실제 실행은 원본에서 요청을 다시 준비해 전체 본문 해시와 PNG 바이트를 대조한다. 정답 약명·품목코드는 모델 요청에 추가하지 않는다.

## 2. 준비한 조건으로 실제 반복 실행하기

**아래는 실행 방법 안내이며 이번 작업에서 실행하지 않았다. OpenAI 과금이 발생한다.**

준비한 이미지와 범위를 확인한 뒤 루트에서 실행한다. `--plan`은 콘솔에 나온 실제 절대 경로로 바꾼다. 키는 기존 `front/.env.local`에서 읽으며 명령줄에 값을 쓰지 않는다.

```sh
node --env-file=front/.env.local --experimental-strip-types backend/scripts/pill-photo-trial.ts run --plan C:/dev/IPILLGOOD/verification-artifacts/pill-photo-trials/plan-XXXXXX --live --confirm-reviewed-transfer
```

- 전체 성공 시 6사례 × 3요청 × 3회 = 54요청이다. 임의 모델·fixture·반복 횟수 변경 옵션은 없으며 `OPENAI_MODEL`도 이 프로토콜을 덮어쓰지 않는다.
- 저장한 계획과 현재의 지정 코드 파일·lockfile·Node/Sharp 런타임·카탈로그·사진·요청이 다르면 첫 전송 전에 실패한다. 변경 후에는 새로운 조건 버전을 정하고 다시 준비한다. 이전 계획·결과는 덮어쓰지 않는다.
- 각 사례에서도 준비 결과와 전송 직전 본문 해시를 확인한다. 전송 전 기록에 실패하면 보내지 않고, 전송 후 기록에 실패하면 그 뒤의 요청을 중단한다.
- `requestIntents`는 전송 직전 기록을 시작한 횟수다. 중단 시 실제 과금 요청 수와 같다고 단정하지 않는다. HTTP 요청 성공과 특징 스키마 검증 성공도 별도로 취급한다.
- 실패하면 일부 사례만으로 recall이나 합격을 계산하지 않는다. 자동 이어하기·실패 사례만 재시도하는 기능은 없다. 수동 재실행도 새로운 실험으로 기록하고 중단된 실행을 보고에서 숨기지 않는다.

## 결과 위치와 해석

새 `run-*` 폴더에 `condition.json`, `trial-start.json`, `summary.json` 및 `repeat-1`부터 `repeat-3`이 생긴다. 예외 중단은 `incomplete.json`에 남을 수 있다. 각 반복에는 다음을 저장한다.

- `preflight.json`: split, 사례 수와 파이프라인 버전.
- `v4-vNN-<stage>-started.json` / `finished.json`: 요청 해시, 시각, 경과 시간, 안전하게 제한한 요청/응답 ID·모델 태그, HTTP 상태, usage. 키·Authorization 헤더·HTTP 오류 원문은 저장하지 않는다.
- `case-v4-vNN.json`: 기존 구조의 Vision/OCR/결합 결과 또는 추출 실패 이유.
- `features.json`, `score.json`: **전체 6사례의 추출이 완료된 반복만** 저장하는 특징·점수.

정상 종료 코드 0은 실행 완료이지 성능 합격이나 운영 가능 판정이 아니다. `summary.comparison.allRepetitionsPassed`, 회차별 수치 및 안전 지표를 함께 확인한다. 중단은 exit 1이며 `comparison`을 만들지 않는다. 새 원신호는 기존 [단계별 진단 명령](pill-photo-diagnostics.md)에 각 `repeat-N` 디렉터리를 전달해 추가 분석할 수 있다. 전송 이미지·요청 추적은 이번 계획/추적 파일에서 별도로 확인한다.

이미지는 계획 디렉터리에 있으므로 `plan-*`와 `run-*`를 함께 보존한다. 모든 파일은 Git 제외된 `verification-artifacts/pill-photo-trials/` 안에 생성한다. 변형 이미지에도 원본과 같은 비공개 취급을 적용하고 공개 Git이나 외부 서비스에 올리지 않는다. `store: false`는 공급자의 모든 보관 정책이 0일임을 의미하지 않는다.

## 검증과 남은 일

- 백엔드 전체 테스트 387개 통과, skip 0(이 컴퓨터에는 기존 비공개 fixture가 있음). 새 테스트 9개는 공개 fixture와 합성 응답만 사용하므로 비공개 휴대폰 자료 없이도 실행된다.
- 미리보기 추가 후 새 9개 테스트, backend strict TypeScript, 변경 파일 ESLint를 재검증했다. 요청 해시 일치, 기록 실패 시 중단, 최대 요청 수, 전체 3회 저장 및 불완전 반복 채점 금지를 검사한다.
- 기존 `pill:regression` 6개 안전·검색 게이트 통과, 외부 요청 0회. 이 통과는 실사진 인식 정확도 합격이 아니다.
- 실제 v4 사진의 오프라인 준비와 저장 PNG 해시를 확인했다. 라이브 반복 호출과 새 정확도 측정, 원격 CI·UI 풀사이클·운영 빌드는 이번 단위에서 실행하지 않았다.

다음 작업은 기준 조건과 비교할 **구조화된 사진 관찰 프롬프트 실험**이다. 사진 품질 → 면 위치 → 문자·로고·분할선 구분 → 모호한 문자 대안 → 양면 일관성을 다루되 정답을 입력하지 않는다. 기준 프로토콜을 덮어쓰지 않고 새 버전으로 추가하고, validation에서 변경 하나의 효과와 반복 편차를 비교한다. 기존 holdout을 다시 튜닝에 쓰거나 이 준비 작업을 정확도 개선 완료로 표현하지 않는다.
