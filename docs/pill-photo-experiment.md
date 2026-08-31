# 공개 알약 사진 검수·특징 추출 실험 (#123)

팀원은 [공통 자료로 시작하기](pill-photo-team-guide.md)를 먼저 참고한다. 검수된 사진 9장·압축 카탈로그·기준 JSON을 `backend/test-support/pill-photo-fixtures/`에 선별했으며, `pill:replay`로 API 키 없이 과거 결과를 비교할 수 있다. 아래 최초 실험 기록은 그대로 보존한다.

## 현재 결론 — 2026-08-31

**검수한 공개 사진을 특징 추출기에 넣고 전체 식약처 카탈로그와 비교하는 로컬 실험을 구현했다. 사용자 사진 식별 기능의 출시 완료가 아니다.**

첫 실제 실행은 6건 모두 API 응답·구조 검증에 성공했지만, 기대 품목 후보 포함은 **0/4**였다. 예외 2건은 모두 재촬영으로 반환됐으나, 의도한 예외 원인까지 감지한 것은 **1/2**였다. 안전한 결과 상태가 나왔다는 사실과 올바른 특징을 읽었다는 사실을 구분한다.

따라서 현재 추출 설정을 사용자 기능에 연결하면 안 된다. 다음 우선순위는 각인 판독·제형/모양 분류·이미지 손상 감지를 개선하고 더 다양한 독립 사진으로 평가하는 것이다. 벡터 DB 도입이나 후보 기준 완화를 먼저 할 근거는 아직 없다.

## 구현 흐름과 범위

```text
검수 명세의 공개 사진 앞·뒷면
  → 원본 크기·SHA256 허용 목록 확인
  → 알파 경계 자르기·흰 배경 합성·최대 1024px·메타데이터 제거
  → OpenAI에 사진 두 장 + 관찰 특징 계약만 전달
  → 엄격한 출력 구조 검증
  → 사진 손상 / 앞뒤 불일치 / 동일 면 의심 시 재촬영
  → 기존 searchPillCandidates (전체 카탈로그)
  → 비교 후보 / 정보 부족 보류 / 재촬영 / 비지원 / 미식별
  → 정답 품목코드와 사후 비교하여 JSON·HTML 보고서 저장
```

- 약명·품목코드·정답 특징·파일명·폴더명·검색 후보는 AI에 보내지 않는다. 사진 속 특징만 읽도록 한다. 기대 품목은 검색 후 평가와 보고서에서만 사용한다.
- 사용자에게 수동 특징 입력을 시키는 제품 흐름을 추가한 것이 아니다. 기존 검색기에 `source: image_features` 관찰값을 넣는 어댑터다.
- 전체 25,387개 레코드를 검색한다. 정답 4개만으로 카탈로그를 줄이지 않는다.
- 후보는 약 확정·복용 가능 판정·확률이 아니다. 복약 계획·알림·약품 등록으로 자동 연결하지 않는다.
- 서버 라우트·사용자 업로드 UI·외부 이미지 URL 입력·운영 배포·벡터 DB는 추가하지 않았다.
- Node 전용 실험 모듈은 backend 공개 export나 운영 앱에 연결하지 않았다. 기존 개발 의존성 `sharp`를 사용하며 패키지/lockfile 변경은 없다.

### 전송 경계

#123에서 선행조건으로 연결한 #61(민감정보 확인·마스킹)과 #88(외부 AI 전송 고지·동의)은 확인 시점에 미완료였다. 일반 사용자 사진 전송을 활성화하지 않는다.

현재 실험은 코드에 고정한 **9개 공개 파일의 크기와 SHA256이 정확히 일치할 때만** 전송된다. 파일은 Git 공통 fixture의 `images/`에서 읽는다. CLI에서 임의 사진·URL·허용 목록을 받을 수 없다. 허용 목록 확대도 출처·이용조건·개인정보·사진 내용 검토 후 코드 리뷰 대상이다. 해시는 모델 정확도 인증이나 동의 체계의 대체물이 아니다.

실제 호출에는 `--live --confirm-public-transfer` 둘 다 필요하다. 최대 6건을 순차 실행하며 재시도하지 않는다. 인증 실패·429·통신 장애 등은 다음 호출을 중단한다. 개별 응답 거절·구조 오류는 성공이나 식별 무결과와 구분한다.

공식 `https://api.openai.com/v1/responses`만 호출하고 리다이렉트를 금지한다. `store: false`, 최대 출력 2,400토큰, 요청당 45초 제한, 응답 256KiB 제한을 사용한다. 이는 외부 전송 자체가 없거나 제공자가 아무 데이터도 보존하지 않는다는 보장은 아니다. 실제 사용자 적용 시 데이터 처리 조건을 별도 검토해야 한다.

## 사진 검수 자료

출처는 [약학정보원 공개 공지](https://health.kr/notice/notice_view.asp?show_idx=1001)의 `sample_img.Egg`다. 이전 출처/코드 대응 조사 기록은 로컬 `verification-artifacts/pill-source-review/REVIEW.md`에 있다. 다운로드한 인식 앱 소스·내장 키·서버·학습 코드를 실행하거나 가져다 쓰지 않았다.

- 전체 내려받은 자료: PNG 920개, 접수번호 폴더 22개.
- 이번 대상: 웹 메타데이터와 현재 카탈로그의 대응 근거가 있는 4개 폴더의 **160장 컨택트시트 검토**.
- 실제 선정·개별 확인: **원본 9장**, 정상 후보 평가 4쌍 + 예외 평가 2쌍(사진 재사용 포함).
- 접수번호는 식약처 품목기준코드와 다른 코드다. 아래 연결은 제품명·제조사·외형·각인·등록 이력을 비교한 개발 검수 결과이며 약사 검증은 아니다.
- 배경이 이미 제거된 RGBA 사진이다. 일반 휴대폰 원본 사진을 대표하지 않는다. 160장 모두를 원본 해상도로 검수하거나 920장 전체 정답을 확정한 것이 아니다.

| 접수번호 | 평가용 품목기준코드 | 정답 연결의 공개 근거 | 선택 사진 A / B | 관찰 메모 |
| --- | --- | --- | --- | --- |
| 29002 | 201505259 | [오피큐탄연질캡슐](https://www.pharm.or.kr/search/drugidfy/show.asp?idx=36176) | `IMG_20201202_163857.png` / `IMG_20201202_163933.png` | OPQ 표시 면 / 문자 없는 면, 캡슐 접합선을 정제 분할선과 혼동하지 않기 |
| 40792 | 201800300 | [디아셀캡슐](https://pharm.or.kr/search/drugidfy/show.asp?idx=48009) | `IMG_20201201_202814.png` / `IMG_20201201_202849.png` | CLP DE1 표시 면 / 문자 없는 면, 사진 색감과 공식 색상 대조 필요 |
| 41107 | 201906970 | [아나콕스캡슐](https://www.pharm.or.kr/search/drugidfy/show.asp?idx=48324) | `IMG_20201117_204859.png` / `IMG_20201117_204943.png` | AJU100, 흰 몸체의 파란 인쇄 띠를 몸체 색상과 구분할 필요 |
| 41344 | 200801352 | [토바스트정](https://pharm.or.kr/search/drugidfy/show.asp?idx=48561) | `IMG_20201120_002134.png` / `IMG_20201120_002100.png` | HM / 10, 타원형 노란 정제 |

예외 사례:

1. `image-cutout`: `41107/IMG_20201117_204901.png`와 같은 그룹의 뒷면. 이미지 일부가 잘려 보인다. **실제로 쪼개진 약이라고 라벨링하지 않는다.** 이미지 손상/판단 불확실로 후보를 내지 않는지 확인한다.
2. `different-pills`: 29002 앞면과 41344 뒷면을 조합. 동일 약의 앞뒤라고 가정하지 않고 불일치/불확실 처리를 해야 한다.

다른 미대응 폴더·과거 외형인 41327은 이번 정답 평가에 섞지 않았다. 가루약·시럽·실제 반쪽 약·여러 약이 한 사진에 담긴 경우는 이번 실사진 평가에 없다. 해당 분기의 합성 입력 테스트 통과를 사진 인식 성능으로 해석하면 안 된다.

### 전처리 범위

원본은 변경하지 않는다. 완전히 투명한 외곽만 자르고 흰 배경에 합성한 뒤 비율을 유지해 최대 1024px로 축소한다. 확대·색상 보정·대비 강화·회전·손상 복원은 하지 않았다. 알파 영역 안에 이미 지워진 부분은 복구하지 않는다. 원시 픽셀에서 새 PNG를 만들어 EXIF/XMP 등 메타데이터와 완전 투명 영역의 숨겨진 RGB를 제거한다. 이 처리는 **임의 사용자 사진의 개인정보 마스킹 구현이 아니다.**

## 실제 실행 결과

- 모델: 기존 로컬 설정 `gpt-5.6-luna`, reasoning `low` (모델/환경 파일 변경 없음).
- 프롬프트: `pill-photo-observation-v1`.
- 전처리: `public-rgba-alpha-bounds-white-1024-v1`.
- 검수 목록: `healthkr-pilot-2026-08-31-v1`.
- 카탈로그: `mfds-pill-v1-7111bd2ae7787719ae454b6f3acccf42fedcaaabf08d65c9e2fd94b1404d2119`, 기존 파일·해시·수집 시각 유지.
- 실제 요청 6회, 모두 구조화 응답 성공. 응답 usage 합계 입력 12,730 / 출력 2,350토큰. 비용은 별도 확인하지 않았다.

| 사례 | 추출에서 관찰된 문제 | 최종 상태 | 평가 |
| --- | --- | --- | --- |
| soft-capsule | 연질캡슐을 tablet, OPQ를 OPC, 분홍을 주황으로 추출하고 blurred로 판단 | `needs_retake` | 기대 후보 누락 |
| two-color-capsule | CLP DE1을 `DE / CP`로 읽음 | `needs_review` | 기대 후보 누락; 공식 각인 정보가 부족한 다른 항목은 정상 후보와 분리해 보류 |
| printed-band-capsule | 앞면 각인 null, 하양/파랑, blurred | `needs_retake` | 기대 후보 누락 |
| oval-tablet | HM을 읽지 못함, 타원형을 장방형으로 추출, blurred | `needs_retake` | 기대 후보 누락 |
| image-cutout | `imageArtifact: none`으로 **손상 감지 실패**, 앞면 각인 null | `needs_retake` / `missing_surface` | 결과상 거절했으나 의도한 예외 원인은 감지 못함 |
| different-pills | `pairConsistency: uncertain` | `needs_retake` / `unverified_photo_pair` | 의도한 불일치 경계에서 거절 |

이는 **4개 제품에서 선정한 고정 개발 표본의 최초 실행 결과**다. 임상 검증이나 일반화된 정확도가 아니다. 이후 같은 표본으로 프롬프트를 조정하면 개발 세트이므로 별도 미사용 평가 사진을 확보해야 한다. 정답 특징을 추출기에 넣거나 결과를 수동 수정하지 않았고, 후보 필터도 완화하지 않았다.

로컬 산출물(모두 Git 제외):

- 오프라인 검수 시트: `verification-artifacts/pill-photo/run-lzmHpz/report.html`
- 원본 실행 결과: `verification-artifacts/pill-photo/run-kaDesq/report.json`, `report.html`, `case-*.json`
- 사후 검토 보고서: `verification-artifacts/pill-photo/run-kaDesq/reviewed-report.html` 및 `.json`
- 사후 검토본은 기대 예외 원인 감지 여부·정답 제품의 공식 특징 표시만 추가했다. 원본 추출 결과와 검색 결과를 바꾸거나 재호출하지 않았다.
- 컨택트시트 8개·원본 해시 목록: `verification-artifacts/pill-source-review/photo-review/`

HTML 파일을 로컬 브라우저에서 직접 열면 사진 A/B, 추출 특징, 공식 정답 참고 특징, 검색 단계·근거·보류 항목을 볼 수 있다. 공식 이미지는 클릭하는 링크이며 자동 다운로드하지 않는다. 생성 HTML의 스크립트 차단·텍스트 이스케이프·외부 이미지 자동 요청 금지는 테스트했다. Codex Browser의 로컬 파일 URL 보안 정책으로 실제 브라우저 렌더링/레이아웃 검증은 수행하지 못했다.

## 실행 방법

API 키 없이 팀 공통 기준선을 보려면 저장소 루트에서 다음을 실행한다. `replay`는 저장된 AI 특징과 고정 카탈로그의 비교일 뿐 새 사진 인식이나 현재 데이터 조회가 아니다.

```sh
npm ci
npm run pill:verify --workspace @care-atlas/backend
npm run pill:replay --workspace @care-atlas/backend
```

이 두 명령은 `verification-artifacts/`의 과거 다운로드나 보고서에 의존하지 않는다. 새 HTML/미리보기만 그 폴더 아래 생성하며 계속 Git에서 제외한다. 고정 JSON·gzip·사진은 검증 후 읽고 기존 수집 시각을 수정하지 않는다. `review`/`evaluate`의 최신성 검사에는 이 오프라인 예외를 적용하지 않는다.

저장소 루트에서 실행한다. 아래 기존 카탈로그 경로는 이 로컬 환경의 예시다. 다른 환경에서는 정상 수집·검증한 스냅샷 경로를 사용한다. 최신성 범위(1~168시간)는 명시적으로 정하며, 오래된 파일의 시각/해시를 고쳐 통과시키지 않는다.

```powershell
# 외부 전송 없음. Git에 포함된 사진을 사용하되 별도 최신 카탈로그가 필요하다.
node --experimental-strip-types backend/scripts/pill-photo.ts review --catalog verification-artifacts/pill-catalog/run-MLjAAj/catalog.json --max-age-hours 24

# 실제 외부 AI 호출/과금 발생. 검수된 공개 사진만, 최대 6건.
node --env-file=front/.env.local --experimental-strip-types backend/scripts/pill-photo.ts evaluate --catalog verification-artifacts/pill-catalog/run-MLjAAj/catalog.json --max-age-hours 24 --live --confirm-public-transfer

# 한 사례만 시험하려면 마지막에 --case oval-tablet 등 고정 ID 추가
node --experimental-strip-types backend/scripts/pill-photo.ts --help

# 기본 회귀 테스트: 네트워크·로컬 사진 자료 불필요
node --experimental-strip-types --test backend/src/pill-photo.test.ts

# Git 공통 공개 샘플 검증. 전송은 모두 모의 응답, 외부 호출 없음.
node --experimental-strip-types --test backend/test-support/pill-photo-local.test.ts
```

`review`는 API 키 없이 실행한다. `evaluate`만 `front/.env.local`의 `OPENAI_API_KEY`/`OPENAI_MODEL`을 로드한다. 키·원문 오류·전체 API 응답을 출력하지 않고 실패 코드만 남긴다. 각 실행은 새 `run-*` 폴더를 만들고 이전 결과를 덮어쓰지 않는다. 식별 누락/보류는 실행 장애와 다른 정상 도메인 결과라 exit 0일 수 있다. **exit 0은 정확하게 식별했다는 뜻이 아니다.**

## 검증과 다음 작업

최초 사진 연결 단계에는 기본 14개 + 로컬 공개 자료 테스트 4개를 추가했다. 팀 공통 자료 단계에서 고정 카탈로그·기록 결과·오프라인 재생·만료 경계 검증 5개를 더했고, 공개 자료 검증 9개도 전체 `npm test`에 포함했다. 입력 스키마·안전 분기·정답 누출 방지·파싱·검수 해시·원본 보존·디코딩·모의 HTTP 실패·크기 제한을 점검한다.

다음 단계:

1. 원본 사진 품질과 잘린/흐린 부분을 재분류하고, 회전 각인·연질캡슐·인쇄 띠 색상·타원/장방 구분을 포함한 특징 추출 오류 목록을 만든다. 현재 표본에 정답을 맞춰 주는 보정은 금지한다.
2. 외부 전송 경계 안에서 전처리/OCR 또는 추출 설정 후보를 통제된 실험으로 비교한다. 추가 호출 수·모델 변경을 기록하고 새로운 미사용 제품·촬영 환경에서 재평가한다.
3. 실제 비지원 제형·손상·복수 약·흐린 휴대폰 사진과 '카탈로그에 없는 약'을 포함해 잘못된 후보 제시율, 정답 후보 포함, 재촬영, 예외 원인 감지를 각각 평가한다. 성능이 부족하면 반환을 보류한다.
4. #61/#88과 운영 카탈로그 조회 경계가 준비된 뒤 사용자 촬영 UI·전송 전 확인·후보/공식 이미지 비교 화면을 연결한다.
5. 구조화 특징 검색의 잔여 문제를 측정한 후에만 벡터 검색의 필요성을 판단한다.

구현 참고: OpenAI Docs 스킬을 사용해 [이미지 입력](https://developers.openai.com/api/docs/guides/images-vision)과 [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)를 확인했다. 스키마 준수는 특징의 사실 정확도를 보증하지 않으므로 기존 검색과 보류 규칙을 유지했다.
