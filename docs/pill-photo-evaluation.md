# 알약 사진 평가와 진단 도구

사진에서 특징을 추출하는 성능, 저장 특징의 후보 검색, 화면·API 동작 검증을 구분한다. 단위·브라우저 테스트 통과나 과거 관찰 재생을 실제 약물 식별 정확도로 해석하지 않는다.

## 고정 평가 자료와 성능 한계

아래 수치는 각 자료를 동결한 당시의 결과다. 현재 웹 전처리·모델·검색 규칙 전체를 새로 평가한 결과가 아니다.

| 자료 | 당시 결과 | 재현 자료 |
|---|---|---|
| 초기 공개 개발 4정상·2예외 | 정상 기대 품목 포함 0/4; 현재 규칙의 예외 재촬영 2/2 | [공개 fixture](../backend/test-support/pill-photo-fixtures/README.md) |
| 공개 v2 validation / holdout | validation recall@1·5·20 4/4; holdout recall@1 2/4, recall@5·20 3/4로 필수 게이트 실패 | [v2 평가](../backend/test-support/pill-photo-evaluation/README.md) |
| 신규 품목 v3 | validation 4/4; holdout recall@1·5·20 1/3로 필수 게이트 실패 | [신규 품목 평가](../backend/test-support/pill-photo-unseen-evaluation/README.md) |
| 휴대폰 v4 validation / v5 holdout | validation 설정별 recall@5 6/6 및 5/6; holdout recall@1·5·20 2/6 | [휴대폰 평가](../backend/test-support/pill-photo-phone-evaluation/README.md) |

개발 세트에 맞춘 결과, 반복 촬영·같은 사진의 반복 추론을 독립 제품 수로 세지 않는다. 실패와 판단 보류도 분모에 포함한다. 후보 상위권 포함은 확정 식별과 다르며 `strong` 오답·재촬영 대상 후보 노출도 별도로 본다. 이미 결과를 본 holdout은 진단 자료로만 사용하고 새 성능 확인에는 미사용 제품·촬영 조건의 새 분할을 만든다.

공개 사진은 제한된 배경·촬영 조건의 소규모 자료다. 실제 손·포장·반사·여러 알약·파손·흐린 사진 전반의 성능을 증명하지 않는다. 공개 fixture의 라이선스와 정답 연결 제약을 함께 읽어야 한다.

## 재현 수준

| 보유 자료 | 가능한 검사 |
|---|---|
| 깨끗한 checkout | 공개 fixture 무결성, 합성 테스트, 저장 공개 관찰 재생, 휴대폰 평가 메타데이터 계약 |
| 검수한 비공개 원본·manifest | 휴대폰 사진·정답·공식 레코드의 고정 해시 대조 |
| 저장 `features.json`·원신호·실행 조건 | 오프라인 채점·단계별 재생; OpenAI 키 불필요 |
| 원본과 외부 전송 옵션·API 키 | 새 특징 추론; 과거 응답 재생과 구분 |

비공개 입력이 없으면 해당 진단 도구는 준비 불가로 종료한다. 고정 경로·해시·코드 버전을 확인하는 도구에서 `prior_calculation_code_changed` 같은 오류가 나면 보호 검사를 풀어 과거 실행처럼 만들지 않는다. 과거 조건을 갖춘 checkout을 사용하거나 새로운 평가 버전을 준비한다. 원본과 API 응답은 Git에 추가하지 않는다.

## 기본 실행

Node 24를 사용하고 저장소 루트에서 실행한다. `<...>`는 실제 입력 경로로 바꾼다.

```sh
npm run pill:verify --workspace @care-atlas/backend
npm run pill:replay --workspace @care-atlas/backend
npm run pill:regression --workspace @care-atlas/backend
npm run pill:labels --workspace @care-atlas/backend -- --fixture v3
npm run pill:score --workspace @care-atlas/backend -- --input <features.json> --split validation --fixture v3
```

새 공개사진 추론은 다음과 같다. `pill:evaluate`는 `front/.env.local`을 읽으며 `OPENAI_API_KEY`와 명시적 전송 옵션이 필요하다. 모델 조건은 해당 fixture README대로 고정한다.

```sh
npm run pill:evaluate --workspace @care-atlas/backend -- validation --fixture v3 --live --confirm-public-transfer
```

휴대폰 검수 자료는 `--fixture v4 --confirm-reviewed-transfer`를 사용한다. holdout에는 `--confirm-holdout-final`도 요구하지만 이미 사용한 v2·v3·v5를 다시 실행한 결과는 새로운 블라인드 성능이 아니다. 최신 카탈로그를 지정하는 공개 평가 CLI는 [카탈로그 안내](pill-catalog.md)를 따른다.

## 오프라인 진단 명령

다음 명령은 저장된 조건을 비교하는 개발 도구이며 기본 사용자 검색 경로에 적용되지 않는다. `npm run <명령> --workspace @care-atlas/backend -- <인수>` 형식으로 실행한다. 필요한 파일은 각 스크립트의 입력 검사를 통과해야 한다.

| 명령 | 인수·기능 |
|---|---|
| `pill:diagnose` | `--run <run> --compare <run>`: 저장 Vision/OCR·결합·검색 단계 비교 |
| `pill:audit:capture` | [`기준선 캡처`](../backend/scripts/pill-photo-audit-baseline.ts): 고정 입력·검색 결과·코드 지문 보존 |
| `pill:audit` | `--baseline <baseline.json>`: 실패 원인과 공식 각인 오라클 비교 |
| `pill:human:oracle` | `--readings <readings.json>`: 검수된 사람 판독 문자열의 영향 비교 |
| `pill:trial:compare` | `--baseline <run> --candidate <run>`: 조건별 반복 관측 비교 |
| `pill:signal:cross` | 같은 두 경로: 저장 Vision/OCR 네 교차 조합 비교 |
| `pill:vision:fields` | 같은 두 경로: Vision 필드별 영향 비교 |
| `pill:lexicon` | 고정 각인 사전 필터와 크롭 보존 진단 |

사람 판독이나 공식 정답 각인을 주입한 오라클은 병목을 찾는 진단이며 모델이 해당 글자를 읽었다는 증거가 아니다. 사전에서 문자열을 고르는 방식의 개선도 독립 판독 성능과 구분한다.

## 선택형 추론 실험

`prepare`는 입력·이미지·요청·코드 해시와 로컬 미리보기를 만든다. 실제 전송은 별도 `run`과 전송 옵션을 요구한다. 고정 실험은 비공개 validation 자료와 이전 실행 조건에 의존하며 임의 사진을 받는 사용자 API가 아니다.

```sh
npm run pill:trial --workspace @care-atlas/backend -- prepare
npm run pill:trial --workspace @care-atlas/backend -- prepare --protocol validation-structured-observation-v1
node --env-file=front/.env.local --experimental-strip-types backend/scripts/pill-photo-trial.ts run --plan <plan> --live --confirm-reviewed-transfer
```

다른 프로토콜로 준비했다면 `run`에도 같은 `--protocol`을 명시한다. 원본·전처리·모델·카탈로그를 고정하고 실패를 제외하거나 유리한 사례만 재실행하지 않는다. 결과의 요청 수·실제 경과 시간·사용 버전·실패와 보류를 함께 해석한다.

- `pill:vision:stylized`: `prepare`에 `--baseline <run> --candidate <run> --image-root <plan>`을 전달한다. `run`에는 같은 경로와 `--plan <prepared-plan> --live --confirm-validation-transfer`를 추가한다. 스타일화된 문자 지침만 비교한다.
- `pill:ocr:ab -- prepare`: 저장 Vision을 고정한 OCR 지침 비교 계획이다. CLI는 **prepare만 지원**하며 키를 읽거나 새 API 호출을 하지 않는다. 합성 실행기 검증을 실제 OCR 비교 결과로 취급하지 않는다.
- `pill:candidate:review -- prepare`: 실제 검색 상위 50품목에서 최대 100개의 완전한 공식 외형과 사진을 준비한다. `run --plan <plan> --allow-validation-transfer`는 추가 재판독 요청을 한다. 약명·품목코드·정답은 전달하지 않으며 모델의 후보 선택을 검색 순위로 직접 사용하지 않는다. 적용한 각인 가시성은 최대 partial로 제한하고 원래 품질 게이트를 유지한다.

후보 참고 재판독은 기본 사진 분석과 별도 실험이다. 저장 1차 관찰 뒤의 추가 요청 효과를 보는 것이므로 처음부터 새 사진을 처리한 성능이나 후보 힌트 없는 재판독 대비 우위를 증명하지 않는다. 실험 보고서의 로컬 함수 진입·fetch 시도·HTTP 응답·제공자 사용량도 구분한다. 과거 전송 전 로컬 차단 실행의 0점은 모델 판독 결과가 아니다.

생성물은 `verification-artifacts/` 아래 새 폴더에 저장하며 이전 보고서를 덮어쓰지 않는다. 검증·출처·한계를 보존한 fixture 메타데이터와 개인 사진·원문 실행 로그를 구분한다.
