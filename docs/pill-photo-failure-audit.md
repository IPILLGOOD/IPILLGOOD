# #141 오프라인 실패 진단과 각인 문자열 오라클

2026-09-07. 정확도 개선을 적용한 작업이 아니라, 기존 동작을 보존하면서 다음 실험의 근거를 확보한 작업이다. 새 Vision/OCR 요청, 사진 전송, 모델·프롬프트·전처리·검색 순위·등급·안전 정책 변경은 없다.

## 구현과 검증

| 항목 | 구현 / 확인 결과 |
| --- | --- |
| 실제 전체 순위 | 기존 검색 루프가 계산한 후보/보류 품목 순서를 반환 제한 전에 기록. 정답 전용 축소 카탈로그 probe 제거 |
| 품목·variant 구분 | 후보에만 / 보류에만 / 양쪽 / 없음, 각 pool의 전체·반환 순위. variant별 digest·양면 방향·근거·conflict 보존 |
| 경쟁 근거 | 기존 comparator 재사용. evidence 차이와 품목코드 동률 정렬 구분. 개별 차이를 독립적인 인과 효과로 주장하지 않음 |
| 안전 지표 | 공식 scorer와 같은 정의: 내부 search의 needs_retake, 후보뿐 아니라 보류 노출도 포함 |
| 실패 계약 | 공급자·전송 사전 점검의 16종 실패 코드를 공유. invalid_request도 실패로 집계. 실패는 6사례 분모에 남고 pass로 변환하지 않음 |
| 재생 요구 조건 | 저장 특징 재생에는 API 키 불필요. 새 추론은 키·사진·별도 전송 승인 필요 |
| 사용자 응답 | 기존 반환 계약에 trace·정답 순위·경쟁 진단 정보를 추가하지 않음. backend 공개 index에도 진단 함수를 노출하지 않음 |
| 동작 보존 | 수정 전 고정한 공개 응답 84/84 일치. 저장 72조합 재결합 특징도 일치 |
| 원본 보존 | 기존 사진·관찰·평가·카탈로그 등 317파일 SHA-256 일치. 새 산출물만 Git 제외 경로에 생성 |
| 검사 | backend strict TypeScript 통과, backend 단위 테스트 431/431 (skip 0), pill:regression 6/6 |

84건은 validation 교차 조합 72건 + 공개 고정 관찰 6건 + v5 최종 관찰 6건이다. 이는 독립 사진 84건이 아니다. 전체 공개 응답의 후보·순서·등급·variant·보류·상태·metrics를 대조했다. 원본 API 호출/결합 코드를 새로 실행한 것이 아니라 저장된 관찰을 재사용했다.

이번 코드 수정 전후 대조와 과거 v5 코드 버전 대조는 별개다. 과거와 현재가 다르다고 이번 instrumentation의 회귀라고 단정하지 않는다.

### 변경 파일

| 파일 (저장소 기준 경로) | 내용 |
| --- | --- |
| backend/src/pill-identification.ts | 공통 검색 실행 경로·반환 제한 전 trace·기존 comparator 설명 |
| backend/src/pill-photo-features.ts | 공개 응답과 분리한 trace adapter·공유 안전 지표 |
| backend/src/pill-photo-failures.ts (신규) | 공통 실패 코드 타입/목록 |
| backend/src/pill-photo-experiment.ts | 공통 실패 타입 사용, 추론 실행 로직 불변 |
| backend/scripts/pill-photo-evaluate.ts | 기록 가능한 실패 코드 집합 일치 |
| backend/test-support/pill-photo-score.ts | 공유 실패 계약·안전 지표 사용 |
| backend/test-support/pill-photo-search-diagnostics.ts (신규) | 실제 전체 순위·pool·variant·경쟁 근거·역사적 필드 diff |
| backend/test-support/pill-photo-diagnostics.ts | 기존 probe 제거, 새 진단 재사용 |
| backend/test-support/pill-photo-vision-fields.ts | 안전 지표 일치·양쪽 pool의 variant 유지 |
| backend/test-support/pill-photo-oracle.ts (신규) | 고정 variant 공식 문자열 주입·6/5/1 집계·사람 판독 빈 양식 |
| backend/scripts/pill-photo-audit-baseline.ts (신규) | 수정 전 기준 응답·입력 해시 고정 |
| backend/scripts/pill-photo-failure-audit.ts (신규) | 범위가 고정된 오프라인 대조·오라클·역사적 v5 보고서 |
| backend/test-support/pill-photo-diagnostics.test.ts | 기존 진단 테스트를 실제 전체 순위 계약으로 변경 |
| backend/test-support/pill-photo-search-diagnostics.test.ts (신규) | Top20 밖·양쪽 pool·비혼합·안전·실패·과거 결측 테스트 |
| backend/test-support/pill-photo-oracle.test.ts (신규) | 문자열만 주입·상태 충돌·그룹 집계·variant 매핑·holdout 거절 테스트 |
| backend/test-support/pill-photo-phone-evaluation-record.ts | replay/새 추론 요구 조건의 별도 상수 |
| backend/test-support/pill-photo-phone-evaluation/README.md | 과거 ledger와 현재 실행 요구 조건의 차이 명시 |
| backend/package.json | 새 audit 명령과 테스트 등록, 의존성 변경 없음 |
| docs/pill-photo-diagnostics.md | 역사적 문서의 새 trace 경로 안내 |
| docs/pill-photo-failure-audit.md (신규) | 이번 변경·검증·진단 결과와 다음 제안 |

추가 확인: 변경 TypeScript 파일의 ESLint는 `--max-warnings 0`으로 exit 0, `git diff --check`도 통과했다. 저장소 루트에서 front 설정을 재사용했을 때 Next의 pages 경로 안내 메시지는 있었지만 lint 오류/경고 건수는 0이었다. 프론트 lint 설정은 변경하지 않았다.

## Validation: 하나의 고정 실행에 짝지은 비교

기준은 `run-9EINEQ/repeat-1`, `repeat-2`, `repeat-3` 전체다. 사례별로 유리한 회차를 고르지 않았다. 모든 주입 위치는 **최종 결합 특징의 뒤**다. `observation.front/back.imprintCandidates`만 교체하며 visibility, noImprintObserved, quality, pairConsistency 등은 그대로다.

공식 문자열은 manifest에 고정된 한 공식 variant의 양면을 사진 A/B 매핑대로 사용한다. 공식 null은 미확보이며 무각인이 아니다. 결측 면은 기존 관찰을 유지하고 별도 표시한다. 주입 문자열이 기존 unreadable/무각인 상태와 충돌하면 조건 전체를 미실행 처리한다. 이번 실제 18조건에서는 충돌이 없었다.

| 집계 | 독립 품목 / 반복 관측 | 원래 관찰 @1 / @5 / @20 | 공식 문자열 주입 @1 / @5 / @20 |
| --- | --- | --- | --- |
| 전체 | 6 / 18 | 11/18 · 16/18 · 17/18 | 16/18 · 18/18 · 18/18 |
| v4-v05 제외 | 5 / 15 | 8/15 · 13/15 · 14/15 | 13/15 · 15/15 · 15/15 |
| v4-v05 별도 | 1 / 3 | 3/3 · 3/3 · 3/3 | 3/3 · 3/3 · 3/3 |

이 수치는 **실제 인식 정확도 개선이 아니라 문자열을 바꾼 반사실적 진단**이다. 특히 공식 문자열 주입은 올바른 후보 이외의 관찰 대안을 제거하는 효과도 포함하므로 모델이 실제 사진을 그렇게 읽을 수 있다는 보장이 아니다. 공식 문자열이 없는 로고 면은 교정한 것이 아니다.

| 사례 | 원래 전체 품목 순위 (1/2/3회) | 공식 문자열 주입 후 | 확인된 내용 |
| --- | --- | --- | --- |
| v4-v01 | 1 / 1 / 1 | 1 / 1 / 1 | 공백 차이만으로 정답 순위 변화 없음 |
| v4-v02 | 1 / 1 / 1 | 1 / 1 / 1 | 주입할 문자열이 이미 같음 |
| v4-v03 | 1 / 5 / 1 | 1 / 1 / 1 | 2회차는 공식 각인 문자열 주입 시 회복. 기존 1위였던 회차도 모든 문자를 올바르게 읽었다는 뜻은 아님 |
| v4-v04 | 3 / 3 / 3 | 1 / 1 / 1 | 문자/숫자 문자열 차이가 현재 정렬의 원문 exact/확장 근거에 영향을 줌. 사진에서 구별 가능한지는 사람 검수 필요 |
| v4-v05 | 1 / 1 / 1 | 1 / 1 / 1 | 과거 외형. 현재 공식 문자를 실제 사진 판독 정답으로 해석하지 않음 |
| v4-v06 | 2 / **45** / 11 | 2 / 2 / 1 | 2회차 정답은 미생성이 아니라 45위로 반환 제한 밖. 주입 후에도 일부 회차 2위로 남음 |

원래/공식 조건 모두 정답의 membership은 candidate_only였다. 45위는 반환 순위가 없으며, 이를 21위로 대체하거나 평가 분모에서 빼지 않는다. 실제 문자열, 주입 필드, 경쟁 품목의 근거, 보류 순위는 비공개 로컬 보고서에 있다.

사람 판독은 **확보·실행 0사례/0면**이다. 모든 18조건을 미실행으로 표시하고 비율은 null로 남겼다(0% 정확도 아님). `human-readings.template.json`에 검수자·시각·원본 사진 해시와 면별 `not_reviewed`, `reviewed_unreadable`, `reviewed_partial`, `reviewed_readable`, `reviewed_no_imprint`를 기록할 수 있다. 로고/표식 관찰은 notes에 함께 적는다. 공식 문자열이나 AI 문자열로 채우면 사람 오라클이 아니다.

5제품·1제품 표는 보조 진단일 뿐이다. 공식 최소 6사례 gate와 기존 점수/합격 기준을 완화하거나 대체하지 않았다.

## v5: 당시 기록 A와 현재 재구성 B

입력은 `run-zEpDgX/features.json` 및 6개 case 파일, 당시 점수는 `score-E06wJf/report.json`이다. validation으로 변환하거나 validation-only 제한을 해제하지 않았다. 저장된 **최종 결합 특징만 고정**해 순수 검색/채점 함수를 사용했다. 저장 Vision/OCR 신호는 참고 기록으로 보존했지만 재결합하거나 오라클을 주입하지 않았다.

| 사례 | A 당시 반환 순위 | B 현재 전체 → 반환 순위 | B 정답 후보/보류 | B 확인한 처리 단계 |
| --- | --- | --- | --- | --- |
| v4-h01 | 1 | 1 → 1 | 후보만 | 각인 근거로 생성·반환, possible |
| v4-h02 | 없음 | 없음 → 없음 | 양쪽 없음 | 각인 호환성 단계에서 미생성 |
| v4-h03 | 없음 | 없음 → 없음 | 양쪽 없음 | 각인 호환성 단계에서 미생성 |
| v4-h04 | 1 | 1 → 1 | 후보만 | 각인 근거로 생성·반환, possible |
| v4-h05 | 없음 | 없음 → 없음 | 양쪽 없음 | 각인 호환성 단계에서 미생성 |
| v4-h06 | 없음 | 없음 → 없음 | 양쪽 없음 | 각인 호환성 단계에서 미생성 |

당시에 실제 기록된 후보/보류 순서, strong 후보 목록, 상태, 반환 순위 등은 **6/6 모두 현재와 일치**했다. 당시 전체 variant 등급·내부 순위·상세 탈락 사유는 기록되지 않았으므로 현재 값으로 채우지 않았다. possible 표시는 B의 결과다. 성공 2건도 분석에 포함했다.

원래 recall@1/5/20 = **2/6**, strong wrong 0, retake candidate exposure 0을 보존했다. 현재 재구성도 동일하지만 새로운 블라인드 성능이나 합격 판정이 아니다.

- 당시/현재 카탈로그 version 일치, 현재 gzip 해시와 manifest의 공식 레코드·원본 이미지 해시 대조 완료.
- 당시 scorer는 `capture-candidate-recall-v1`, 현재는 `capture-candidate-recall-v2-minimum-sample`. 원본 정책/보고서 그대로 보존.
- 당시 ledger의 검색 규칙 버전은 확인 가능하지만 실행 코드 commit/파일 해시가 해당 run에 묶여 기록되지는 않았다. 현재 HEAD와 변경 파일 해시는 새 보고서에 별도 기록.
- **C 확인 불가:** 원본 HTTP 응답 envelope, 실제 전송한 전처리 이미지 bytes/hash/해상도, 회전별 판독값, 당시 내부 trace. 원본 사진의 해시/해상도는 전송 이미지 증명이 아니다.
- 크롭·조명·모델 환각을 확정적인 실패 원인으로 단정하지 않는다.

v5의 실패 분석을 개발 판단에 활용했음을 기록했다. 새 개선의 최종 성능 확인은 새로운 미사용 자료가 필요하다.

## 다음 실험 제안 — 아직 적용하지 않음

한 가지 우선 검증 후보는 **각인 OCR에서 `noImprintObserved`를 ‘문자가 없음’과 ‘로고/표식까지 없는 빈 면’으로 혼동하지 않게 하는 출력 지침의 명확화**다.

근거는 현재 추출 지침이 letters/digits의 부재를 기준으로 이 값을 설정하지만, 검색은 공식 mark가 있으면 noImprintObserved=true를 불일치로 처리한다는 의미 차이다. v4-h05는 반대 면의 정확한 문자 근거가 있어도 이런 상태로 미생성됐고, v4-h03도 공식 mark와 관찰 무각인이 충돌한다. 이는 저장 값/현재 코드로 확인한 계약 문제이며, 실제 사진에서 로고가 보였는지까지 증명하지는 않는다. 문자 문자열 누락/혼동인 h02·h06, v03·v04·v06을 이 실험 하나로 해결한다고 주장하지 않는다.

실험 전 먼저 validation 사진을 사람이 검수하여 텍스트·로고·진짜 무각인·판독불가를 구분한다. 이 근거가 없으면 지침의 효과를 판정할 수 없으므로 변경/새 API 실험을 시작하지 않는다. 검수된 validation에 필요한 표식/무각인 사례가 부족하면 해당 개발 자료를 보충한다. v5를 개선 평가용으로 재사용하지 않는다.

검수 후 실험에서는 OCR 지침 한 요인만 바꾸고 모델·Vision·전처리·카탈로그·검색/안전 정책을 고정한다. 성공 기준은 사람 검수로 표식이 확인된 면을 빈 면으로 확정하는 오류 감소, 판독불가 면의 가짜 문자/확정 증가 없음, 강한 오답·재촬영 후보 노출 0 유지다. 기존 전체 6제품 × 3회 기준 recall@5 16/18 및 최저 회차 5/6을 악화시키지 않는지도 함께 본다. 이는 validation 실험 기준이며 운영 합격 기준이 아니다.

## 실행·보관

Node 24. 개발 서버/Firebase 로그인/.env.local/API 키가 필요 없다.

```sh
npm run typecheck --workspace @care-atlas/backend
npm test --workspace @care-atlas/backend
npm run pill:regression --workspace @care-atlas/backend
npm run pill:audit --workspace @care-atlas/backend -- --baseline C:/dev/IPILLGOOD/verification-artifacts/pill-photo-audit/baseline-zIf2Sd/baseline.json
```

`pill:audit`는 이 작업의 고정 실행/입력에 한정된 도구다. 비공개 manifest·사진·저장 관찰과 **수정 전** baseline이 모두 있어야 한다. 입력이 없거나 해시가 다르면 중단하며 API로 대체하지 않는다. 현재 코드로 baseline을 다시 만들어 전후 검사를 통과시키지 않는다.

`pill:audit:capture`는 수정 전에만 실행하는 도구다. 기존 두 trial의 코드·데이터 바인딩을 검증하므로, 이미 코드가 달라진 현재 상태에서 다시 실행해도 원래 기준선을 대신 만들 수 없다. 예전 `pill:signal:cross`의 코드 해시 guard도 그대로이며 현재 코드 변경을 이유로 실패할 수 있다. 이를 풀어서 과거 실행으로 위장하지 않았다.

출력은 `verification-artifacts/pill-photo-audit/analysis-*`의 report.json, report.html, 빈 사람 판독 양식이다. 새 디렉터리/파일만 생성하며 원본을 덮어쓰지 않는다. 이 폴더와 filled 양식은 비공개이며 Git에 추가하지 않는다. 종료 코드 0은 진단 성공이지 인식 합격이 아니다.

기존 불변 ledger의 `fullReplayRequirement: team_private_fixture_plus_openai_api_key` 문구는 역사적 자료로 보존한다. 실제 요구 조건은 별도 `PILL_PHOTO_REPRODUCTION_REQUIREMENTS` 및 아래 구분을 따른다.

| 모드 | 키 | 로컬 자료 |
| --- | --- | --- |
| 비민감 메타데이터 검사 | 불필요 | Git fixture/ledger |
| 해시 검증을 포함한 저장 특징 재생 | 불필요 | 비공개 fixture·저장 특징·카탈로그 (이 audit에는 수정 전 baseline 추가) |
| 새로운 Vision/OCR 추론 | 필요 | 사진·키·명시적 외부 전송 승인; 이번에는 미실행 |

이번 검증은 backend 범위다. 프론트 빌드, Firebase 풀사이클, 원격 CI를 새로 실행한 결과는 아니다. 단위 테스트 로그의 requests/requestIntents는 mock 전송 횟수이며 이번 작업의 실제 API 사용량이 아니다.

## 후속: 사람 판독 확보 후 비교

위 보고서의 사람 조건 미실행 표시는 당시 자료 미확보 사실로 보존한다. 이후 사용자가 원본 사진만 보고 작성했다고 확인한 12면 판독을 연결한 별도 결과는 [사람 판독 문자열 비교](pill-photo-human-oracle.md)에 기록했다. 기존 보고서·baseline은 수정하지 않았고 새 API 호출 없이 같은 저장 validation 3회에서 original/official/human 조건을 비교했다.
