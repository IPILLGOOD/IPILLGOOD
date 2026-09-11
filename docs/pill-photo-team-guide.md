# #123 팀원 시작 안내 — 같은 자료로 알약 식별 개발하기

## 직접 찍은 새 사진으로 로컬 테스트

저장소 루트의 `local-pill-photos/input/`에 **같은 온전한 알약의 앞면 `front.jpg`, 뒷면 `back.jpg`**를 저장한다. 서로 다른 JPG/JPEG 두 장이 필요하며 각각 최대 5MiB / 2,500만 화소다. 현재 휴대폰 전처리는 사진 중앙을 확대하므로 알약을 중앙에 두고 촬영한다. HEIC나 PNG는 이번 로컬 입력에서 지원하지 않는다.

```sh
# 파일과 전처리만 확인: API 키 불필요, 외부 호출 없음
npm run pill:local

# 실제 Vision 1회 + 앞뒤 OCR 각 1회를 병렬 요청 → 특징 통합 → 전체 카탈로그 검색
npm run pill:local -- --live

# 같은 사진으로 기존 순차 방식과 시간 비교
npm run pill:local -- --live --execution sequential

# OCR 한 면당 4장 입력으로 비교 (기존 기본값은 8장)
npm run pill:local -- --front local-pill-photos/input/front2.jpg --back local-pill-photos/input/back2.jpg --live --ocr-images 4

# 파일명을 바꾸어 반복 테스트 (상대 경로는 항상 저장소 루트 기준)
npm run pill:local -- --front local-pill-photos/input/a.jpg --back local-pill-photos/input/b.jpg --live
```

`--live`는 지정한 사진의 가공본을 AI API에 전송한다. `OPENAI_API_KEY` 환경 변수를 사용하며 없으면 `front/.env.local`에서 읽는다. API 호출은 자동 반복·재시도하지 않는다. 새 사진은 기존 평가 목록에 등록할 필요가 없으며, 기존 고정 평가·holdout에는 추가되지 않는다.

로컬 명령의 기본 요청 방식은 `--execution parallel`이다. 전처리한 동일한 사진에서 세 요청을 동시에 시작하고 `Promise.allSettled()`로 모두 수집한 뒤, 세 응답의 형식과 성공 여부를 확인해야 특징을 결합한다. 응답 도착 순서는 앞뒤 면 배정에 영향을 주지 않는다. 하나가 실패해도 이미 시작한 나머지 요청의 종료/시간 제한까지 기다리며 부분 결과로 후보를 만들지 않는다. 성공 시 요청 수는 두 방식 모두 3회이며, 실패 시에는 순차 방식보다 요청 수가 늘 수 있다. 기존 고정 평가 도구의 순차 실행 조건은 유지한다.

`--ocr-images 4|8`은 **OCR 요청 한 개당 첨부하는 이미지 수**다. 기본 8장은 컬러·대비 보정 각각 0·90·180·270도, 4장은 각각 0·180도이며 양면 OCR에는 총 8장을 첨부한다. 두 설정 모두 현재 전처리를 그대로 수행하고, OCR 첨부 이미지와 그 구성·순서 설명만 달라진다. Vision의 4장 입력과 모델·검색 규칙은 유지한다. 원래 비교 조건으로 실행하려면 `--ocr-images 8`을 사용한다. 결과의 `pipeline.ocrImageCount`와 터미널에 선택한 장수가 기록된다. 같은 사진으로 OCR·전체 시간과 상위 후보 유지 여부를 함께 비교하되, 정답쌍이 없으면 후보 일치를 정확도 유지로 표현하지 않는다.

새 결과는 `pill-photo-local.v2` 형식으로 실행 방식, 전처리·카탈로그·분석·검색 시간을 기록한다. `analysisWallMs`는 분석 함수 진입부터 모든 요청·기록·특징 결합이 끝날 때까지의 실제 경과 시간이다. 병렬 요청별 `elapsedMs`를 더해 사용자 대기 시간으로 해석하면 안 된다. `requestTrace`의 `offsetMs`로 시작/종료의 겹침을 확인할 수 있으며, 같은 로그 파일에 쓰는 작업만 순서대로 처리한다. 순차/병렬 비교 시 같은 사진·모델·프롬프트·카탈로그를 고정하고 실행 순서를 번갈아 배치한다. 별도 지시 없이 사진 여러 쌍을 한꺼번에 병렬 전송하지 않는다.

Node.js 24를 사용한다. 실행 명령은 현재 Node24 또는 Windows `C:/tools/node-v24.*-win-*/node.exe` 설치본을 찾아 실행한다. 다른 위치라면 `IPILLGOOD_NODE24` 환경 변수로 Node24 실행 파일의 절대 경로를 지정할 수 있다. 기본 Vision/OCR 모델은 최근 실험과 같은 `gpt-5.6-sol`, reasoning은 `low`다. 다른 모델은 `--model`, `--ocr-model`로 명시하며 프론트의 `OPENAI_MODEL` 설정은 기본값을 바꾸지 않는다.

실행마다 `local-pill-photos/results/run-*/result.json`에 원관찰값, OCR, 통합 특징, 후보·보류·재촬영 결과, 요청 수와 소요 시간 및 사용 버전을 저장한다. 터미널에는 상위 후보 5개를 표시하고 전체 반환 후보는 JSON에 남긴다. 사진 파일이나 이전 결과를 덮어쓰지 않으며, 이 폴더 전체는 Git에서 제외한다. API 요청 본문·사진의 base64·인증 키는 결과에 저장하지 않는다.

카탈로그는 Git에 있는 **2026-08-31 기준의 고정 로컬 테스트 스냅샷**이다. 실행마다 무결성을 검증하고 실제 날짜·버전을 표시하며, 최신 데이터라고 취급하거나 자동으로 새 카탈로그를 수집하지 않는다. 후보가 반환되는지 확인하는 도구이며, 알려진 정답이 없는 사진으로는 정답률을 계산하지 않는다. 서비스 배포 API와 UI를 추가하는 작업은 포함하지 않는다.

후속 #141의 첫 작업으로 [휴대폰 validation 단계별 오프라인 진단](pill-photo-diagnostics.md)을 추가했다. `pill:diagnose`는 비공개 v4 validation의 저장 원신호를 재생하며, 기존 공개 fixture `pill:replay`와 달리 개인별 자료가 필요하다. 새 API 호출이나 정확도 개선 완료를 뜻하지 않는다.

## 배포 연결을 위한 공통 분석 함수

`@care-atlas/backend/pill-photo`의 `analyzePillPhotos()`는 앞뒤 사진 바이트를 받아 **전처리 → Vision·앞뒤 OCR → 특징 결합 → 후보 검색**까지 처리한다. 모델·검색 규칙과 4장 옵션은 로컬 명령과 공유하며, 기본값은 병렬 요청·OCR 한 면당 8장이다. 다음은 이미 업로드를 받은 Node.js 서버에서 호출하는 예시다.

```ts
import { analyzePillPhotos, type PillCatalog } from "@care-atlas/backend/pill-photo";

async function analyzeUploadedPair(
  front: Uint8Array,
  back: Uint8Array,
  catalog: PillCatalog,
  apiKey: string,
) {
  return analyzePillPhotos({
    front, back, catalog, apiKey,
    model: "gpt-5.6-sol",
    ocrModel: "gpt-5.6-sol",
    allowExternalTransfer: true,
    ocrImageCount: 8, // 4도 선택 가능
    executionMode: "parallel",
  });
}
```

반환 형식은 `pill-photo-analysis.v1`이다. `ok: true`이면 `extraction`과 `comparison`을 확인한다. 분석 성공이 후보 존재나 약의 확정을 뜻하지 않으며, 재촬영 여부는 `comparison.status`, 검색 상태는 `comparison.search?.status`로 판단한다. 기존 후보·보류 후보(`heldCandidates`)·안내 문구를 그대로 보존한다. `ok: false`이면 `reason`으로 실패를 구분하고 후보 결과는 반환하지 않는다. `timings`에는 전처리·분석·검색 시간, `elapsedMs`에는 공통 함수 전체 시간이 들어가며 업로드·카탈로그 로딩 시간은 포함하지 않는다.

공통 함수는 파일을 읽거나 저장하지 않고 환경 변수도 조회하지 않는다. 입력 사진과 가공본을 결과에 포함하지 않으므로 호출 측에서도 저장하지 않으면 파일로 남기지 않고 처리할 수 있다. 이는 메모리의 즉시 완전 삭제나 외부 AI 제공자의 보관 정책까지 보장한다는 뜻은 아니다. API 키와 카탈로그는 호출 측에서 전달하며, 카탈로그 저장 위치·로딩·재사용·갱신 정책은 배포 통합 시 결정한다. Git의 고정 테스트 카탈로그를 자동으로 운영용 최신 데이터로 취급하지 않는다.

로컬 명령은 기존처럼 파일 읽기·고정 카탈로그 검증·결과 저장을 담당한다. 먼저 전처리와 저장 가능 여부를 확인한 뒤 `analyzePreparedPillPhotos()`로 동일한 분석·검색을 실행하므로 전처리를 두 번 하지 않는다. `--live` 없는 사전 확인도 유지한다. 테스트에는 `fetchImpl`, 요청 기록에는 `onRequestTrace`를 전달할 수 있으며 요청 기록은 이미지 본문 없이 단계별 메타데이터만 제공한다.

**현재 공통 함수는 Node.js 24와 Sharp가 필요한 실행 경로다.** Sharp 0.35.3을 기존 버전 그대로 런타임 의존성으로 선언했다. `@care-atlas/backend` 기본 진입점에서 재수출하지 않아 기존 서버 코드가 이 경로를 자동으로 가져오지 않는다. 이 변경만으로 Cloudflare Workers에서 Sharp 전처리가 실행되지는 않는다. 실행 환경 또는 전처리 연결 방식을 배포 담당자가 결정해야 하며, 이번 변경은 HTTP API 경로·화면·배포 설정을 추가하지 않는다.

## 1. 준비와 첫 실행

이 변경이 포함된 브랜치를 받은 뒤 **저장소 루트**에서 실행한다. PR 생성만으로 main에 들어가는 것은 아니므로, 머지 전에는 해당 작업 브랜치를 받아야 한다.

```sh
npm ci
npm run pill:verify --workspace @care-atlas/backend
npm run pill:replay --workspace @care-atlas/backend
npm run pill:regression --workspace @care-atlas/backend
```

의존성 설치 후 위 검증·재생·회귀 검사는 별도 다운로드/ZIP/API 키 없이 작동한다. `.env.local`을 복사해 공유하지 않는다. 전체 `npm test`에도 공유 자료 검증이 포함된다.

`pill:replay` 콘솔의 `directory`, 또는 `pill:regression` 콘솔의 `replayDirectory`에 생성된 `report.html`을 브라우저에서 직접 연다. 사진 A/B, 저장된 추출 특징, 로컬 마스크 점검, 공식 정답 참고 특징, 후보/보류와 이유가 보인다. 회귀 검사의 같은 폴더에는 `regression.json`도 생성된다. HTML과 이미지가 함께 생성되므로 별도로 사진을 복사할 필요가 없다. 웹 앱의 촬영 화면을 추가한 것은 아니다.

**`replay`는 새 사진 인식이 아니다.** 기록해 둔 AI 관찰값과 전체 고정 카탈로그를 현재 검색·예외 처리 코드로 비교한다. 새 프롬프트/전처리의 인식 성능은 이 명령으로 측정할 수 없다. 새 외부 호출은 0회이며 결과에 과거 자료라는 경고를 표시한다.

**`regression`은 실패 가능한 검사용 명령이다.** 내부에서 같은 오프라인 재생을 새 폴더에 만든 뒤, 합의한 안전·검색 조건 6개와 과거/현재 후보·보류·거절 사유 차이를 검사한다. 조건 하나라도 깨지면 exit 1이다. 반대로 통과하더라도 정상 실사진 식별 성능이 확보됐다는 뜻은 아니다.

## 2. 파일이 나뉜 방식

```text
backend/test-support/
  pill-photo-review.ts          사진 허용 목록·평가 사례·정답 대응 근거
  pill-photo-fixture.ts         고정 평가 자료 검증/읽기 (운영용 아님)
  pill-photo-fixtures/          Git에 포함할 최소 공통 자료
    images/                    공개 원본 9장
    catalog.json.gz            전체 카탈로그, 무손실 압축
    baseline.json              최초 6건의 기록된 결과
    manifest.json              버전·크기·해시
    README.md / SOURCES.md     실행·출처·이용범위·검수 한계
  pill-photo-phone-evaluation/ 휴대폰 평가의 비민감 해시·버전·점수 기록
verification-artifacts/        Git 제외 유지
  pill-photo/run-*/            각자 새로 생성한 보고서와 미리보기
  ...                         전체 다운로드·과거 실행 로그 등
```

선정 데이터 합계 약 6.3MB. 515MB 전체 이미지 압축파일, 나머지 사진, 다운로드한 과거 인식 앱 소스, 전체 이미지 미리보기 중복본은 포함하지 않는다. 현재 로컬의 원본 자료를 삭제하거나 옮기지는 않았다.

카탈로그는 정답 제품 4개만 추리지 않고 전체 검색 대상을 유지한다. 일부 정답 데이터만 남기면 후보 수와 오탐 조건이 달라지기 때문이다. 전체 메타데이터도 압축하면 약 1.47MB다.

`.gitattributes`가 fixture JSON을 LF로 유지하고 PNG/gzip을 바이너리로 취급한다. Windows/Linux에서 체크섬이 달라지지 않게 하며, 별도 Git LFS 다운로드는 필요하지 않다.

## 3. 최초 기준선과 현재 재생 결과

| 항목 | 최초 저장 결과 | 현재 규칙 재생 (2026-09-01) |
| --- | ---: | ---: |
| 정상 4건의 기대 품목 후보 포함 | 0/4 | 0/4 |
| 예외 사진 재촬영 반환 | 2/2 | 2/2 |
| 기대한 예외 원인까지 감지 | 1/2 | 2/2 |

잘린 사진은 최초 AI가 손상을 놓쳐 `missing_surface`로 거절했지만, 현재 재생에서는 검수된 투명 PNG의 알파 마스크 오목함을 별도 점검해 `image_artifact_or_uncertainty`로 차단한다. 이 규칙은 현재 공개 RGBA 자료의 안전 보조 신호이지 일반 휴대폰 사진의 손상 탐지 정확도가 아니다.

따라서 여전히 기능 완성이 아니라 성능 개선을 시작할 기준선이다. `pill:verify`나 `pill:regression` 통과는 무결성·안전·결정형 검색 계약을 검증한 것이지 약을 정확히 식별했다는 의미가 아니다. 검색 코드를 개선하면 새 재생 결과는 바뀔 수 있으며, 테스트는 과거 0/4를 강제하지 않고 저장 특징과 현재 검색기의 연결을 검증한다. [실험 기록](pill-photo-experiment.md)에 개별 실패 원인과 변경 전후 비교가 있다. 고정 사진에만 맞춰 수정한 뒤 그 수치를 독립 평가 정확도로 보고하지 않는다.

별도로 고정한 validation 4쌍은 2026-09-02에 Luna Vision + Sol OCR로 실제 재측정해 `recall@1·5·20` 4/4, 강한 오답 0건, 재촬영 대상 후보 노출 0건을 통과했다. 네 건 모두 후보 1위였지만 `needs_review`였으며 자동 확정 결과는 아니다. 이 수치는 캡처 수준 반복 재현 결과이고 최초 개발 세트 0/4를 덮어쓰거나 운영 정확도를 주장하지 않는다.

이후 같은 규칙을 `4e798ae`로 동결해 holdout 4쌍을 최종 1회 평가한 결과는 `recall@1` 2/4, `recall@5·20` 3/4로 필수 게이트 실패다. 강한 오답과 재촬영 후보 노출은 0건이었지만, 한 사례에서 `HM`을 `I-M / IM / 1-M`로 오독해 정답이 상위 20개에 들지 않았다. 결과를 본 뒤 규칙은 바꾸지 않았다. 이 holdout을 다시 최종 평가로 쓰지 말고, 후속 개선에는 새 평가 버전과 미사용 holdout을 준비한다.

실제 휴대폰 사진은 v4 validation 6제품·12사진과 v5 holdout 6제품·12사진으로 분리했다. validation 두 설정은 `recall@5` 6/6과 5/6이었고, 최종 holdout은 `recall@1·5·20` 모두 2/6으로 실패했다. 원본 사진과 API 원문은 Git에서 제외하지만, [`pill-photo-phone-evaluation/results-2026-09-02.json`](../backend/test-support/pill-photo-phone-evaluation/results-2026-09-02.json)에 이미지 해시·익명화 품목/공식 레코드 지문·실행 버전·점수를 고정했다. 원본이 없는 깨끗한 체크아웃은 `metadata-only`, 비공개 원본이 있는 환경은 전체 해시 대조로 명시적으로 구분되며 두 상태 모두 건너뜀 없이 테스트된다. 전체 재현 절차는 [스마트폰 사진 평가 기록](../backend/test-support/pill-photo-phone-evaluation/README.md)에 있다.

현재 필수 회귀 게이트는 다음 여섯 가지다.

1. 서로 다른 약의 앞·뒷면 조합은 후보 없이 재촬영 처리한다.
2. 잘린 공개 사진은 기대한 이미지 손상 게이트에서 재촬영 처리한다.
3. 정확한 각인이 있으면 색상 오분류 하나로 기대 후보를 제거하지 않고 `colors` conflict로 남긴다.
4. 여러 각인 후보 중 공식 각인과 일치하는 관찰 후보를 보존한다.
5. `I/1`, `O/0` 혼동 확장으로 찾은 후보와 변환 근거를 보존한다.
6. 카탈로그 입력 순서를 뒤집어도 표시 후보·보류 후보 순서가 같다.

## 4. 역할을 나눌 기준 (담당자는 팀 합의)

| 작업 영역 | 주요 파일 | 다음 산출물 |
| --- | --- | --- |
| 사진·정답 검수 | `backend/test-support/pill-photo-review.ts`, fixture `SOURCES.md` | 독립 제품/촬영 조건, 정답 근거, 실제 예외 사진 목록 |
| 특징 추출·전처리 | `backend/src/pill-photo-experiment.ts`, `pill-photo-features.ts` | 각인 판독·제형/색상/모양·손상 감지 개선 실험 |
| 후보 검색·예외·평가 | `backend/src/pill-identification.ts`, `pill-form-policy.ts`, `backend/scripts/pill-photo.ts`, `backend/scripts/pill-regression.ts` | 같은 입력의 후보/보류 근거와 잘못된 후보 제시 방지 회귀 검사 |
| 운영 UI·전송 경계 | #61/#88 및 후속 화면 작업 | 동의/마스킹/운영 조회 준비 후 사용자 연결 |

공통 연결 계약은 `PillObservation`이다. 추출기는 특징만 전달하고 검색기는 공식 후보·근거를 반환한다. 사진의 정답 약명/품목코드/검색 후보를 추출 프롬프트에 넣지 않는다. 각자 동일한 결과 파일을 고치지 말고 생성된 `run-*` 결과에서 비교한다. 현재 기준선은 덮어쓰지 않는다.

## 5. 사진을 AI로 새로 분석하려면

이 경로는 검수된 공개 사진만 허용하며 사용자 사진 업로드는 여전히 비활성이다. 기본 재생과 달리 명시적 외부 전송·과금이 발생한다. 별도로 수집한, 최신성 정책을 통과하는 `catalog.json`이 필요하다.

```sh
node --env-file=front/.env.local --experimental-strip-types backend/scripts/pill-photo.ts evaluate --catalog <실제-catalog.json-경로> --max-age-hours 24 --live --confirm-public-transfer --case oval-tablet
```

- 이 분석에 필요한 키는 **`OPENAI_API_KEY`**다. 기본 모델은 범용 Vision `OPENAI_MODEL=gpt-5.6-luna`, 각인 OCR `OPENAI_OCR_MODEL=gpt-5.6-sol`이며 환경 변수로 명시할 수 있다. 전체 6건은 사례당 Vision 1회와 면별 OCR 2회를 순차 실행하므로 최대 18요청이며 재시도는 없다.
- 새 카탈로그를 수집할 때는 별도로 **식약처 낱알 API 키**가 필요하다. [카탈로그 수집 안내](pill-catalog-local.md)를 따른다.
- Git의 `.gz` 고정 카탈로그는 오프라인 과거 비교용이다. `evaluate`에서 자동으로 이를 읽거나 만료 검사를 생략하는 fallback은 없다. 고정 자료의 시간/해시를 고쳐 현재 데이터처럼 사용하지 않는다.
- 이미 승인·수집한 최신 카탈로그가 있다면 공유된 9장과 자신의 AI 키로 실행할 수 있다. 새 카탈로그 버전을 썼다면 과거 기준선과 데이터 조건도 달라졌다는 점을 기록한다.
- 프롬프트·전처리 버전, Vision/OCR 모델 설정, 데이터 버전, 호출 수, 정상/예외 결과를 실험 기록에 함께 남긴다. 고정 validation은 `npm run pill:evaluate --workspace @care-atlas/backend -- validation --live --confirm-public-transfer`로 12요청을 사용하며, holdout은 규칙 동결 후 `--confirm-holdout-final`까지 명시할 때만 실행한다.
- 신규 품목 v3는 명령에 `--fixture v3`를 추가한다. 동결 결과는 Vision/OCR 모두 `gpt-5.6-sol`이었다. v3 holdout은 이미 최종 1회 사용했고 `recall@5` 1/3으로 실패했으므로 다시 튜닝용 최종 세트로 사용하지 않는다. 결과 재생은 진단으로만 표시하고, 다음 최종 평가는 새 fixture 버전과 새 미사용 사진으로 만든다.

## 6. 자료를 추가하거나 갱신할 때

1. 공개 이용범위·출처·개인정보·사진 품질·정답 근거를 먼저 검토한다. 실제 환자 사진, 키, 원문 요청 로그를 추가하지 않는다.
2. 새 사진은 허용 목록·해시·사례와 출처 문서를 함께 리뷰한다. `manifest.json`만 바꿔 임의 파일을 전송하도록 만들지 않는다.
3. 기준 카탈로그/사진/AI 결과를 갱신하려면 새 평가 버전과 변경 이유를 명시한다. 해시·버전·정규화·원본 검증을 모두 수행한다. 출처 없는 데이터로 테스트가 통과하도록 기대값만 바꾸지 않는다.
4. API를 새로 호출한 결과와 저장된 결과의 재생을 구분한다. 새로운 보고서는 `verification-artifacts/`에 생성한다.
5. PR에는 변경 범위·`pill:regression` 결과·기준 대비 diff·남은 한계·재현 명령을 적는다. `regression.json`은 실행 산출물이므로 커밋하지 않는다. #123의 사용자 기능은 아직 미완료이므로 완료/출시로 표현하지 않는다.
