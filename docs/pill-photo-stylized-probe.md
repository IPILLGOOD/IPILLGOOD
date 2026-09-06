# #141 여섯 번째 작업 — 스타일화된 문자 지시의 단일 변경 실험

## 실행 전 고정한 조건

2026-09-06. [필드별 진단](pill-photo-vision-fields.md)을 바탕으로 스타일화된 글자를 비문자 로고로 처리해 후보를 비우는 현상을 줄일 수 있는지 검사한다. 지시 한 문단만 추가하며 제품별 특례나 정답 문자를 넣지 않는다. 가설이지 이미 확인된 개선이 아니다.

| 항목 | 고정 조건 |
| --- | --- |
| 비교 | 기존 structured 지시 vs 같은 지시에 스타일화된 문자 관찰 한 문단 추가 |
| 입력 | 기존 휴대폰 validation 6제품·12사진의 해시 검증된 전처리 PNG. 제품마다 A/B context/detail 4이미지 |
| 모델·추론 | 양쪽 모두 `gpt-5.6-sol`, `low` |
| 나머지 요청 | 이미지 바이트·순서·detail·출력 스키마·최대 토큰·`store: false` 모두 동일 |
| 실행 | 6제품 × 3회 × 2조건 = 최대 36회. 쌍마다 선행 조건을 교차. 오류 시 중단, 자동 재시도 없음 |
| OCR | 새 호출 0회. 각 제품·회차에 대응하는 기존 OCR 원문 두 세트를 각각 고정하여 두 조건에 똑같이 결합 |
| 비교기 | 기존 검색·Vision/OCR 결합 규칙과 고정 공식 카탈로그 유지 |
| 제외 | holdout, 사용자 UI, 운영 경로, 벡터 DB, 기본 프롬프트 변경 |

정답 품목은 전체 카탈로그 검색 **후** 로컬 점수 계산에만 사용한다. 프롬프트에는 약명·품목코드·공식 각인·기대 후보를 보내지 않는다. 두 OCR 세트는 독립 OCR 기술 비교가 아니라 과거 응답 변동에 대한 민감도 확인용이다.

기존 실험의 최고 결과와 비교하지 않는다. 같은 이번 실행에서 새로 호출한 대조군과 변경군을 비교한다. [OpenAI 지침](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6)의 단일 지시 그룹 변경 원칙을 따르되, [작은 글자·회전·정확도 한계](https://developers.openai.com/api/docs/guides/images-vision#limitations)가 프롬프트만으로 해소된다고 가정하지 않는다.

## 사전 판정 기준

36개 결과가 모두 있고 순서·조건이 일치해야만 요약한다. 각 조건은 독립 18제품이 아니라 **6제품을 세 번 반복**한 것이다.

다음 조건을 모두 만족하면 `promising_requires_fresh_full_pipeline`으로만 판정한다.

- 고정 OCR 0과 1 **각각** recall@1/5 총합이 대조군보다 낮아지지 않는다.
- 두 OCR 조건 각각 회차별 recall@5의 최솟값이 낮아지지 않는다.
- 주 평가 OCR 0에서 recall@1 또는 recall@5 총합이 증가한다.
- 변경군의 strong wrong과 retake candidate exposure는 두 OCR 조건 모두 0이다.

그 외에는 `no_clear_gain`이다. 좋은 회차·제품·OCR 세트만 선택하거나 판정 기준을 사후 완화하지 않는다. 통과해도 새 Vision에 **저장된 OCR을 결합한 조건부 실험**이므로 새로운 전체 인식 정확도나 운영 준비 완료를 뜻하지 않는다. 기본값 승격에는 별도 전체 파이프라인 검증이 필요하며 새로운 블라인드 평가는 별도로 남는다. 정상 사진 6제품만으로 비지원·위험 사진 전체의 안전성을 인증하지 않는다.

## 실행·보관 경계

`prepare`는 원본 실험 조건·코드·결과·사진 해시를 검증하고 계획을 남기며 외부 호출하지 않는다. `run`은 다시 같은 검증을 수행하고 계획과 완전히 일치해야 진행한다. 계획은 첫 요청 전에 단독 소비 처리하여 중복 실행을 막는다. 각 응답 원문·usage·요청 해시를 점수보다 먼저 보관하며 중간 오류 시 성공 요약을 만들지 않는다.

```sh
# 저장소 루트에서 Node 24 사용. 아래 준비 명령에는 API 키가 필요 없다.
node --experimental-strip-types backend/scripts/pill-photo-stylized-probe.ts prepare --baseline verification-artifacts/pill-photo-trials/run-9EINEQ --candidate verification-artifacts/pill-photo-trials/run-Ao0hXp --image-root verification-artifacts/pill-photo-trials/plan-o2sKLW

# 승인된 validation만 실제 전송한다. PLAN_DIR은 위 prepare 출력 경로다.
node --env-file=front/.env.local --experimental-strip-types backend/scripts/pill-photo-stylized-probe.ts run --baseline verification-artifacts/pill-photo-trials/run-9EINEQ --candidate verification-artifacts/pill-photo-trials/run-Ao0hXp --image-root verification-artifacts/pill-photo-trials/plan-o2sKLW --plan PLAN_DIR --live --confirm-validation-transfer
```

외부 전송은 기존에 승인된 validation 전처리 이미지와 관찰 지시만 OpenAI Responses API로 보낸다. 새 OCR 요청이나 식약처 API 요청은 없다. 원사진·상세 관찰·응답 원문·정답 연결 자료는 기존 Git 제외 경로를 유지한다. 실행 결과는 `verification-artifacts/pill-photo-stylized-probe/`의 새 폴더에 보관하며 이전 기록을 덮어쓰지 않는다.

## 실행 결과

**판정: `no_clear_gain`. 변경 지시를 기본값으로 채택하지 않았다.** 계획 고정 후 실제 Responses API 36회가 모두 완료됐으며 추가 OCR·식약처 요청과 재시도는 0회다. 성공한 회차만 추리거나 추가 실행으로 유리한 결과를 고르지 않았다.

아래 분모 18은 **validation 6제품 × 3회**이며 독립 18제품이 아니다. 대조군도 이번에 새로 추론했다. OCR은 과거 두 세트를 각각 고정했다.

| 고정 OCR | Vision 조건 | recall@1 | recall@5 | recall@20 | 회차별 recall@5 (각 /6) |
| --- | --- | --- | --- | --- | --- |
| 0 — 주 평가 | structured 대조군 | 11/18 | 17/18 | 17/18 | 5, 6, 6 |
| 0 — 주 평가 | 스타일화 문자 지시 추가 | 11/18 | 16/18 | 16/18 | 6, 5, 5 |
| 1 — 민감도 확인 | structured 대조군 | 11/18 | 16/18 | 18/18 | 4, 6, 6 |
| 1 — 민감도 확인 | 스타일화 문자 지시 추가 | 11/18 | 16/18 | 16/18 | 6, 5, 5 |

모든 조건의 strong wrong과 retake candidate exposure는 0이었다. 하지만 주 평가 recall@5가 낮아지고 recall@1 증가도 없어 사전 기준을 만족하지 못했다. 보조 OCR의 상위20 포함도 낮아졌다. 이 0건은 정상 6제품에서의 관측이지 비지원 사진 안전성 인증이 아니다.

### 원문에서 확인한 변화

- 18쌍 중 13쌍의 Vision 전체 특징은 같았다. 다른 5쌍은 두 제품의 각인 후보·판독 상태 차이였다.
- `v4-v03`: 공식 앞면 문자 포함은 양쪽 조건 모두 3회 중 2회였다. 지시 추가가 이 문자 판독을 더 잘하게 했다는 근거는 없었다. 과거 structured 실행의 0/3과 이번 대조군의 2/3 차이도 있으므로, 같은 프롬프트의 자연 변동을 개선 효과로 계산하면 안 된다.
- `v4-v06`: 변경군은 1회에 모호한 뒷면 문자 대안을 함께 남겨 주 평가 정답이 상위20 밖→2위로 바뀌었지만, 2·3회에는 대안을 빠뜨려 대조군 2위→상위20 밖으로 바뀌었다. 좋은 1회만 보고 개선으로 결론 내릴 수 없다. 지시 한 문단으로 모호한 문자 대안의 보존이 안정화되지는 않았다.
- 변경군의 낮은 결과를 복구하려고 정답 문자를 삽입하거나 검색·결합·안전 게이트를 변경하지 않았다. 이번 시행으로 대조군이 통계적으로 우수하다고 확정하는 것도 아니다. 작은 개발 세트에서 **변경안을 채택할 근거가 부족하다**는 판정이다.

### 실행 지문·재현 범위

| 항목 | 기록 |
| --- | --- |
| 준비 / 실행 | `plan-5Pmf4Z` / `run-wBn1sD` |
| 시작 UTC | `2026-09-06T11:26:45.766Z` |
| 마지막 요청 시작 UTC | `2026-09-06T11:31:40.377Z` (응답 소요 9,961ms) |
| 모델 응답 | 36/36 `gpt-5.6-sol`, `completed`; 요청 ID·원문 보관 |
| usage 합계 | input 243,702 / output 6,426 tokens — 청구액 계산값 아님 |
| plan SHA-256 | `172725d86412271aa6848ed69c9bb6c0dc8c73c02ce39b3b977ab3156ede2e66` |
| summary SHA-256 | `1c487bd3111f479adeb6a54b7eb0fbb7388af37334ca8b71230281258ab07406` |
| fixture | `pill-photo-phone-validation-local-2026-09-02-v4` |
| fixture 지문 | `b7cabe376c04e46ff0c061c5bae424f46a45108d2cab3b6a5ab62b614bc130b7` |
| catalogue | `mfds-pill-v1-7111bd2ae7787719ae454b6f3acccf42fedcaaabf08d65c9e2fd94b1404d2119` |
| 런타임 | Node `v24.20.0`, Windows x64; 기존 전처리 PNG 재사용 |

실행 폴더에는 `plan.json`, `1..36-started.json`, `1..36-response.json`, `1..36-score.json`, `summary.json`을 보관했다. plan은 원본 조건·OCR 결과·전처리 이미지·두 요청 본문·코드 25개 파일의 해시에 연결된다. 주/보조 OCR은 각각 `run-9EINEQ`, `run-Ao0hXp`의 같은 사례·회차다. 원사진 해시와 기존 비민감 평가 기록은 [스마트폰 평가 자료 안내](../backend/test-support/pill-photo-phone-evaluation/README.md)를 따른다.

Git에는 코드·합성 테스트·이 집계/지문/명령만 포함한다. 깨끗한 체크아웃은 코드 계약을 검사할 수 있지만, 비공개 사진과 원신호 없이 이 휴대폰 결과를 다시 추론하거나 재생한 것은 아니다. API를 재호출하면 같은 수치를 보장하지 않는다. 기존 plan을 재소비하거나 해시 검사를 해제하지 않는다.

**줄바꿈 재현 제약:** 현재 바이트 단위 코드 해시는 CRLF/LF 차이에도 달라진다. 이 작업 폴더에는 두 형식이 혼재한 파일도 있어 같은 Git 커밋의 새 체크아웃만으로 과거 raw hash가 재현된다고 보장할 수 없다. 이번 실행에서는 25개 지문이 끝까지 일치했고, 실제 실행 바이트를 같은 결과 폴더의 `code-byte-snapshot.zip`에 추가 보존한 후 압축 내부 25개 지문도 전부 대조했다. 아카이브는 코드 25개와 plan만 포함하며 사진·키·의존성 전체를 포함하지 않는다. SHA-256은 `57be65d06348c844ddb4f95a88d42aacedfc82bb508960e00a3e987cc4a375bc`이다. 과거 재현에는 해당 커밋의 별도 작업 폴더에서 이 바이트 자료와 기존 비공개 자료가 필요하다. 현재 작업 파일 위에 덮어쓰지 않는다. 정규화된 소스 해시를 도입한다면 후속 프로토콜 버전으로 다루고, 이번 원본 해시를 사후 변경하지 않는다.

## 검증 및 다음 단위

- 백엔드 전체 **421개 통과, 실패 0, skip 0**. 이 환경에는 비공개 fixture가 있다. 깨끗한 체크아웃에서도 같은 비공개 검증을 수행했다고 주장하지 않는다.
- 새 필드별 진단 4개, 단일 변경 실험 6개 합성 테스트 포함. 모의 전송·완결성·순서·사전 지표·안전 실패·변경하지 않은 요청 계약을 검사했다.
- 백엔드 strict 타입 검사, 변경 TypeScript ESLint 통과. 린트는 저장소 루트에 설정이 없어 처음 경로 오류가 발생했으며 `--config front/eslint.config.mjs`를 지정해 통과했다.
- `pill:regression` 6/6 통과, 해당 명령의 외부 요청 0회. 이것은 기존 저장 관찰의 안전/검색 회귀이지 새 지시의 독립 사진 인식 인증이 아니다.
- 실행 후 별도 오프라인 대조에서 코드 25개와 기존 OCR 원본 해시를 재확인하고, 실제 응답 36개를 다시 파싱해 두 고정 OCR 조건의 검색 72건을 재계산했다. 저장한 모든 사례 점수와 전체 summary가 완전히 일치했으며 외부 요청은 0회였다.
- 사용자 UI·운영 빌드·Firebase 풀사이클·원격 CI는 이번 단위에서 실행하지 않았다. 기본 프롬프트·검색·결합·서비스 코드도 변경하지 않았다.

추가 유료 전체 파이프라인 실행이나 기본값 승격은 하지 않는다. 다음 단위는 모호한 각인의 **면별·회전별 판독 원문을 분리해 확인하는 실험**으로 잡는다. 현재 여러 회전 이미지를 한 OCR 응답에 합치는 구조에서 어떤 이미지가 어느 판독을 뒷받침하는지 먼저 분리하고, 그 근거로 하나의 입력/판독 개선을 선택한다. 변경안이나 모델을 무작정 늘리지 않으며 holdout은 계속 동결한다.
