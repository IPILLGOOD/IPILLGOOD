# 공식 낱알 카탈로그

식약처의 전체 공개 메타데이터를 두 번 수집·검증해 JSON 스냅샷을 만들고 수동 특징 검색과 웹 사진 검색에 사용한다. 웹에서는 정적 청크로 배포하며 사용자 요청 중 전체 원천 API를 수집하지 않는다. [웹 처리·배포](pill-photo-web.md), [후보 검색 계약](pill-identification.md)

## 1. 전체 데이터 수집

저장소 루트에서 실행한다. 이미 설정한 `front/.env.local`의 `MFDS_PILL_API_KEY`를 사용하며, 없으면 `MFDS_MEDICATION_API_KEY`를 사용한다. 키를 명령어에 직접 붙이지 않는다.

```powershell
node --env-file=front/.env.local --experimental-strip-types backend/scripts/pill-catalog.ts collect --live --max-requests 600
```

- 한 페이지에 100건씩 두 차례 순차 조회한다. 페이지 번호·건수·전체 수가 맞고, 순서와 조회 시각을 제외한 보존 필드의 내용이 두 차례 모두 같아야 한다.
- 정확히 같은 행이 중복되면 검토가 필요한 상태로 중단한다. 같은 품목코드에 서로 다른 공식 레코드가 있는 경우는 보존한다.
- 전체 행 수만 같다고 성공시키지 않는다. 누락·중간 변경·접근 거절·호출 제한·통신/파싱 오류는 `incomplete`이며 검색용 파일을 만들지 않는다.
- 기본 상한은 600요청·10분·50,000행·64MiB 파일이다. 두 차례 조회가 요청 예산을 넘는 데이터 규모면 첫 페이지 이후 중단한다. 개별 API 응답의 기존 8초/1MiB 제한도 유지한다.
- 요청 사이에 250ms 간격을 두며 자동 재시도하지 않는다. 중간 재개는 지원하지 않는다. 실패 원인을 확인한 뒤 새 실행으로 시작한다.
- 공식 페이지의 신청 가능 트래픽과 실제 계정의 잔여 한도는 다를 수 있다. 무한 반복 실행하지 않으며 `rate_limited`이면 활용 계정 한도를 확인한다.
- 이미지 파일·원본 API 응답은 저장하지 않는다. 정규화된 공개 필드와 공식 이미지 URL만 저장한다.

성공하면 `verification-artifacts/pill-catalog/run-<실행별 ID>/`에 다음 파일이 생긴다. 이 경로는 기존 `.gitignore`의 `verification-artifacts/` 규칙으로 제외된다.

| 파일 | 용도 |
| --- | --- |
| `catalog.json` | 전체 레코드, 출처, 정규화 버전, 두 순회 검증 정보가 들어 있는 카탈로그 |
| `summary.json` | 건수·수집 당시 제형·중복 품목코드·이미지 URL 수와 예제 파일 경로. 새 실행에는 현재 검색 정책의 지원/비지원/미상 집계인 `searchFormPolicy`도 포함 |
| `example-1.json` 등 | 공식 필드에서 만든 정제/캡슐/설명 포함 사례의 특징 입력. 가능한 사례만 생성 |

기존 실행 파일은 덮어쓰지 않는다. 새 디렉터리에서 `catalog.pending` 쓰기가 끝나면 `catalog.json`으로 이름을 바꾼다. 디스크 쓰기 오류나 프로세스 중단으로 남은 임시 파일은 성공한 결과로 안내하지 않는다. 설정된 비밀값이 공식 필드에 반사되면 데이터를 변형해서 저장하지 않고 저장 자체를 거절한다.

## 2. 저장한 데이터로 검색

수집 출력의 **`catalogPath`와 `examples[].observationPath` 실제 값**을 사용한다. 아래 `run-<실행별 ID>`는 그 경로로 바꿔야 하며 그대로 실행하는 값이 아니다.

```powershell
node --experimental-strip-types backend/scripts/pill-catalog.ts search --catalog "verification-artifacts/pill-catalog/run-<실행별 ID>/catalog.json" --observation "verification-artifacts/pill-catalog/run-<실행별 ID>/example-1.json" --max-age-hours 24
```

이 명령은 **오프라인 검색**이다. `.env.local` 로딩이나 API 키가 필요하지 않고 식약처/AI/이미지 서버를 호출하지 않는다.

- 파일 크기·JSON 구조·정규화 버전·행 수·내용 해시·검증 정보·공식 이미지 호스트를 다시 확인한다. 일부 페이지나 표본 보고서를 전체 카탈로그로 변환하지 않는다.
- `--max-age-hours`는 반드시 명시한다(정수 1~168). 예제의 24는 로컬 검증 시 사용할 경과 시간 한도이며, 의료적 안전성이나 운영 갱신 주기의 확정값이 아니다.
- 한도를 넘기거나 검증 시각이 미래인 파일은 `snapshot_expired_or_future`로 거절한다. 파일 시각이나 해시를 수동으로 바꾸지 않는다.
- `--limit 20`은 비교 후보와 보류 항목에 **각각** 적용하며 1~100을 허용한다. `candidateCount`/`returnedCount`/`truncated`와 `heldCandidateCount`/`heldReturnedCount`/`heldTruncated`를 따로 유지한다. 같은 품목의 다른 외형이 양쪽에 있을 수 있으므로 합집합은 `matchedItemCount`로 확인한다.
- 지원 제형이며 최소 한 면에 비어 있지 않은 문자 각인 일치 근거가 있는 레코드만 `candidates`로 제시한다. 관찰 원문 각인과 제한된 서버 혼동 확장 근거를 시각 특징보다 우선하고 품목코드/레코드로 안정적으로 정렬한다. 확정이나 의료적 확률을 만들지 않는다.
- 문자 각인 근거 부족·공식 제형 미상은 `heldCandidates`와 각 외형의 `reviewReasons`로 분리한다. 보류만 있으면 `needs_review`이며 정상 실행 결과(exit 0)다. 보류 영역의 약명은 식별 결과가 아니다.
- `formName` 기반 검색 정책이 비지원으로 분류한 레코드는 양쪽에서 제외한다. 기존 v1 파일의 수집 당시 `form`, 정규화 버전·해시는 바꾸지 않는다. 현재 정책은 `formPolicyVersion`, 검색 규칙은 `searchRulesVersion`으로 결과에 기록한다.

결과는 `verification-artifacts/pill-catalog/search-<실행별 ID>/`의 `result.json`, `result.md`에 저장된다. 콘솔에 나오는 **`reportPath`의 MD 파일을 열면** 비교 후보와 보류 영역, 품목코드·공식 이미지 링크·특징별 근거·보류 이유·공식 변경일을 읽을 수 있다. 링크를 직접 열 때는 외부 공식 이미지 사이트에 접속한다.

## 3. 직접 관찰한 특징으로 바꾸기

생성된 `example-*.json`을 참고해 별도 JSON 파일에 관찰값을 작성하고 `--observation`에 그 파일을 지정한다. 이 수동 검색 CLI는 원본 사진을 받지 않는다. 사진 입력은 별도의 로컬 분석 명령과 웹 화면에서 지원한다.

- `form`: 온전한 `tablet`/`capsule`이 지원 범위다. 가루/과립/액상, 반쪽/훼손은 별도 상태로 처리한다.
- `schemaVersion`: 현재 입력은 `pill-observation.v2`다. 새 수동 입력에 과거 v1의 단일 `imprint` 필드를 사용하지 않는다.
- `front.imprintCandidates`, `back.imprintCandidates`: 각 면에서 가능한 원문 판독 후보를 강한 순서대로 최대 5개 기록한다. 서버가 제한된 혼동 문자를 별도 확장하므로 원문을 임의 교정하지 않는다.
- `noImprintObserved`: 해당 면에 글자가 없음을 직접 확인한 경우에만 `true`다. 판독 실패를 무각인으로 바꾸지 않는다.
- `imprintVisibility`: `clear`, `partial`, `unreadable`을 구분한다. 부분 판독 면이 하나라도 있으면 결과가 정확히 일치해도 `strong`이 아닌 최대 `possible`이다.
- `scoreLine`: `none`, `single`, `cross`, `other`, `unknown`. 보이지 않는 분할선을 없다고 추정하지 않는다.
- `shape`, `colors`: 관찰한 모양·색상. 알려진 불일치는 후보를 삭제하지 않고 `conflicts`에 남겨 각인 근거 뒤에서 재정렬한다. 이는 조명·촬영 오차를 자동 보정하거나 색상 오류를 무시한다는 뜻은 아니다.
- `source: manual`과 명시적 상태 값으로 검색을 검증한다. `image_features`로 바꾸어도 실제 사진 추출기가 실행되는 것은 아니다.

**자동 생성된 예제의 의미:** 공식 레코드에서 입력 특징을 복사했기 때문에 그 품목이 후보에 남는지 확인하는 자기 일관성 점검이다. 독립적인 정답 이미지 세트가 아니며, top-1/top-3 정확도나 실제 사진 식별 성능으로 보고하지 않는다. 실제 촬영·관찰 입력 평가는 별도 단계다.

## 4. 안전 경계와 구현 범위

- 조회 실패·잘린 파일·미완성 수집을 약을 못 찾은 정상 결과로 바꾸지 않는다. 합성 예시를 운영 실패의 대체 데이터로 사용하지 않는다.
- 두 순회의 내용 일치는 원천 API가 시점 고정 스냅샷을 제공했다는 증명이 아니다. 로컬 해시도 서명이 아니므로 출처 인증이나 의도적인 파일 조작 방지를 보장하지 않는다.
- API 키·원문 오류·사용자 사진은 로그에 남기지 않는다. 사용자가 지정한 특징의 검색 결과는 로컬 결과 파일에 저장되므로 공개 업로드 전에 내용을 확인한다.
- 품목이 하나만 남아도 약의 확정·복용 허용으로 처리하지 않는다. 복약 계획·일정·알림·복용 완료 기록을 변경하지 않는다.
- 양면 글자 없음이나 공식 각인 누락만으로는 후보를 찾았다고 하지 않는다. `needs_review`를 오류·정상 무결과·확정 식별과 혼동하지 않는다. 한 면 문자 근거가 있어도 나머지 정보가 부족하면 `incomplete`이며, 현재 정책이 실제 사진 오인 방지를 보장하지 않는다. 정책 기준은 [후보 검색 규칙](pill-identification.md), 성능과 한계는 [평가 안내](pill-photo-evaluation.md)에 있다.
- 수집·수동 검색 CLI는 Node 로컬 개발용이다. 배포 준비기는 검증된 목록을 청크로 나눠 Workers 정적 에셋에 포함하고 웹 API가 무결성과 최신성을 검사하며 읽는다.
- SQLite/D1 저장, 자동 갱신, 중간 재개와 동시 수집 잠금은 지원하지 않는다. 카탈로그는 사용자 건강정보 Firestore와 분리한다.

## 5. 회귀 검사

```powershell
node --experimental-strip-types --test --test-reporter=spec backend/src/pill-catalog-snapshot.test.ts backend/src/pill-catalog-files.test.ts backend/src/official-pill-catalog.test.ts backend/src/pill-identification.test.ts backend/src/pill-catalog-profile.test.ts backend/src/pill-form-policy.test.ts
```

테스트는 합성 데이터와 가짜 페이지 읽기를 사용한다. 파일 테스트의 임시 디렉터리는 해당 테스트가 만든 경로만 정리한다. 오프라인 CLI 테스트는 `fetch` 호출을 실패하도록 막은 상태에서 검색까지 검증한다.

## 웹 배포와 갱신

`npm run cf:deploy --workspace @care-atlas/front`는 배포 전에 목록을 준비한다. 검증한 최신 파일을 재사용하려면 `PILL_CATALOG_FILE`에 절대경로를 지정한다. 준비기는 1,000개씩 청크를 만들고 manifest에 길이·SHA-256·건수를 기록한다. `front/public/pill-catalog/`는 생성물이므로 직접 편집하지 않는다.

배포·검색 모두 168시간 이내의 검증 자료를 요구한다. 자동 갱신은 없어 7일 이내에 목록을 갱신해 재배포해야 한다. 오래되거나 손상된 자료를 과거 테스트 카탈로그나 일부 표본으로 대체하지 않는다. 고정 평가 카탈로그는 원래 날짜를 보존하고 테스트 전용 시계로만 재생한다.
