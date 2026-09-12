# 알약 사진 검색 개발

사용자 기능은 [웹 사진 검색](pill-photo-web.md)에 구현되어 있다. 로컬 도구는 Node 24·Sharp로 전처리하고 웹은 브라우저 Canvas에서 전처리한다. Vision·양면 OCR·특징 결합·결정적 후보 검색 계약은 공유하지만 두 전처리가 픽셀 단위로 같지는 않다.

## 로컬 사진 분석

저장소 루트에서 앞면·뒷면 사진 경로를 지정한다. 상대경로는 루트 기준이며 원본과 결과는 Git에서 제외한 `local-pill-photos/`에 둔다.

```sh
npm ci
npm run pill:local -- --front local-pill-photos/input/front.jpg --back local-pill-photos/input/back.jpg
npm run pill:local -- --front local-pill-photos/input/front.jpg --back local-pill-photos/input/back.jpg --live
```

`--live` 없는 실행은 사전 확인이며 새 외부 추론을 하지 않는다. `--live`는 지정한 사진의 가공본을 OpenAI에 전송한다. 키는 프로세스 `OPENAI_API_KEY`, 없으면 `front/.env.local`에서 읽는다. Node 24를 별도 위치에 설치했다면 `IPILLGOOD_NODE24`로 실행 파일을 지정할 수 있다.

| 옵션 | 동작 |
|---|---|
| `--execution parallel` | 기본값. Vision·앞면 OCR·뒷면 OCR을 동시에 시작하고 모두의 결과를 수집 |
| `--execution sequential` | 같은 요청을 순서대로 처리해 비교 |
| `--ocr-images 8` | 기본값. OCR 한 면당 컬러·대비 이미지의 0/90/180/270도 8장 |
| `--ocr-images 4` | OCR 한 면당 컬러·대비 이미지의 0/180도 4장 |
| `--model`, `--ocr-model` | 모델을 명시. 로컬 기본값은 Vision/OCR 모두 `gpt-5.6-sol`, reasoning `low` |

성공 경로는 세 요청이며 자동 재시도하지 않는다. 병렬 요청 하나가 실패해도 이미 시작한 다른 요청은 끝나거나 제한 시간에 도달할 때까지 수집한다. 부분 응답으로 후보를 만들지 않는다. 반복·병렬 요청 시간의 합을 실제 사용자 대기 시간으로 해석하지 않는다.

실행마다 `local-pill-photos/results/run-*/result.json`에 관찰·OCR·결합 특징·후보·보류·재촬영·버전·시간을 저장한다. 원본 사진·이전 결과를 덮어쓰지 않으며 API 키·요청 이미지 본문은 결과에 저장하지 않는다. 로컬 결과는 개인 사진의 특징을 포함할 수 있으므로 공개 fixture와 구분한다.

이 명령은 2026-08-31의 고정 테스트 카탈로그를 검증해서 사용한다. 현재 운영 목록으로 간주하거나 자동 갱신하지 않는다. 알려진 정답이 없는 사진은 후보 반환과 대기 시간을 확인할 수 있지만 정확도를 계산할 수 없다.

## 공통 함수와 웹 경계

`@care-atlas/backend/pill-photo`의 `analyzePillPhotos()`는 앞뒤 바이트·카탈로그·API 키를 받아 전처리부터 비교까지 실행한다. Node 24와 Sharp가 필요한 경로이며 파일·환경 변수 접근과 결과 저장은 호출자가 담당한다. 이미 전처리한 입력은 `analyzePreparedPillPhotos()`를 사용한다. `fetchImpl`로 외부 응답을 주입하고 `onRequestTrace`로 이미지 본문을 제외한 요청 메타데이터를 관찰할 수 있다.

반환은 `pill-photo-analysis.v1`이다. `ok: true`도 약 확정이나 후보 존재를 뜻하지 않는다. `comparison.status`, `comparison.search?.status`와 `heldCandidates`를 확인한다. `ok: false`는 `reason`으로 실패를 구분하고 후보를 반환하지 않는다.

Cloudflare 경로는 [`pill-photo-web.ts`](../backend/src/pill-photo-web.ts)와 브라우저 JPEG 계약을 사용하며 Sharp를 Worker에서 실행하지 않는다. 원본 미저장은 외부 제공자의 보관 정책이나 메모리 즉시 완전 삭제를 보장하지 않는다.

## 공개 자료 재생과 회귀 검사

```sh
npm run pill:verify --workspace @care-atlas/backend
npm run pill:replay --workspace @care-atlas/backend
npm run pill:regression --workspace @care-atlas/backend
```

공개 최소 fixture는 별도 다운로드나 키 없이 실행된다. `replay`는 저장된 AI 관찰과 전체 고정 카탈로그를 현재 검색기로 재생하고 새 사진 인식은 하지 않는다. `regression`은 새 재생 결과를 만들고 안전·검색 조건을 검사하며 실패하면 종료 코드 1을 반환한다. 결과 디렉터리의 `report.html`과 `regression.json`에서 확인할 수 있다.

필수 회귀는 다른 약의 앞뒤 조합, 잘린 사진, 색상 충돌에도 각인 근거 보존, 여러 판독 후보, 혼동 확장 근거, 카탈로그 순서 불변성을 포함한다. 통과가 실사진 식별 정확도를 뜻하지 않는다.

## 자료 관리

사진·정답·공식 레코드·출처·이용범위와 해시는 함께 관리한다. 고정 fixture와 과거 AI 결과를 새 코드에 맞춰 덮어쓰지 않는다. 평가 조건 변경은 새 버전으로 기록하고 이미 확인한 holdout을 새로운 최종 평가에 다시 쓰지 않는다. 공개 이미지 라이선스는 [SOURCES](../backend/test-support/pill-photo-fixtures/SOURCES.md), 실제 성능과 재현 범위는 [평가 안내](pill-photo-evaluation.md)를 따른다.
