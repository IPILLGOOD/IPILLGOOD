# 팀 공통 알약 사진 평가 자료

`pill-photo-shared-2026-08-31-v1` · **과거 실험의 오프라인 비교용**. 사용자 업로드 기능·운영 최신 데이터가 아니다.

## 바로 실행

저장소 루트에서:

```sh
npm ci
npm run pill:verify --workspace @care-atlas/backend
npm run pill:replay --workspace @care-atlas/backend
npm run pill:regression --workspace @care-atlas/backend
```

`npm ci`는 의존성 설치를 위한 네트워크가 필요하다. 설치 후 위 세 `pill:*` 명령은 API 키·`.env.local`·별도 ZIP·기존 `verification-artifacts/` 자료 없이 실행한다. 로컬 웹 서버도 필요하지 않다.

- `pill:verify`: 사진·카탈로그·기준 결과의 무결성, 모의 통신, 과거 결과 재생을 검증한다. 전체 `npm test`에도 포함된다.
- `pill:replay`: **저장된 AI 특징을 현재 검색 코드로 다시 비교**한다. 사진을 AI로 새로 분석하지 않는다.
- `pill:regression`: 오프라인 재생 후 합의한 안전·검색 게이트 6개를 검사한다. 후보·보류 후보·거절 사유의 과거/현재 diff를 남기며 실패 시 exit 1이다.
- 실행 후 콘솔의 `directory` 안 `report.html`을 로컬 브라우저에서 열어 사진·추출 특징·공식 특징·후보/보류를 확인한다. 보고서용 이미지도 같은 폴더에 생성된다.
- 회귀 실행은 콘솔의 `replayDirectory`에 `report.html`과 `regression.json`을 함께 만든다. 모두 `verification-artifacts/` 아래의 Git 제외 산출물이다.
- 한 사례만 보려면 `npm run pill:replay --workspace @care-atlas/backend -- --case oval-tablet`.

## 포함한 것

| 파일 | 용도 |
| --- | --- |
| `images/`의 PNG 9개 | 검수된 공개 원본. 코드의 허용 목록과 크기·SHA256 일치 필요 |
| `catalog.json.gz` | 25,387개 레코드 전체. 약 17.1MB JSON을 약 1.47MB로 무손실 압축 |
| `baseline.json` | 최초 6건 실험의 추출 결과·검색 결과·평가. 실패 결과도 그대로 보존 |
| `manifest.json` | 버전·파일 크기·압축 전후 해시·수집 시각·출처 |
| `SOURCES.md` | 이용범위 확인·접수번호/품목코드 대응 근거·검수 한계 |

데이터 파일 합계 6,318,909 bytes(약 6.3MB). 원본 전체 압축파일, 나머지 사진, 다운로드한 인식 앱 소스, 키, 로그, 가공 미리보기 중복본은 포함하지 않는다. HTML/미리보기는 명령으로 재생성한다.

## 기준 결과의 의미

`baseline.json`에 보존한 최초 결과는 정상 4건의 기대 품목 후보 포함 **0/4**, 예외 2건의 결과상 재촬영 **2/2**, 기대 예외 원인 감지 **1/2**다. 최초 손상 사진은 손상을 감지한 것이 아니라 각인을 못 읽어 재촬영된 사례다.

2026-09-01 현재 규칙으로 재생하면 정상 후보 포함 **0/4**, 예외 재촬영 **2/2**, 기대 예외 원인 감지 **2/2**다. 검수된 투명 PNG의 알파 마스크 품질 게이트가 잘린 사진을 `image_artifact_or_uncertainty`로 차단한 결과다. 일반 휴대폰 사진의 손상 인식 성능을 의미하지 않는다. 회귀 게이트 6개가 모두 통과하더라도 실사진 정상 사례 0/4 한계는 그대로다.

새 검색 로직의 결과는 새 보고서에 기록한다. 개선됐다는 이유로 과거 `baseline.json`을 덮어쓰지 않는다. 새 사진·추출 실험은 별도 버전과 독립 평가 자료를 사용한다.

## 최신성·보안 경계

- `replay`와 이를 내부 호출하는 `regression`만 이 고정 카탈로그를 역사적 자료로 읽는다. 임의 카탈로그/최신성 옵션/외부 호출 플래그는 받을 수 없다.
- `review`와 `evaluate`의 기존 `snapshotSearchCatalog` 최신성 검사는 유지한다. 오래된 카탈로그의 날짜를 고치거나 시계를 과거로 돌려 통과시키지 않는다.
- 실제 사진 AI 분석에는 본인의 `OPENAI_API_KEY`와 최신성 정책을 통과하는 별도 JSON 카탈로그가 필요하다. 새 카탈로그 수집에는 식약처 API 키가 필요하다. 자세한 방법은 [팀원 안내](../../../docs/pill-photo-team-guide.md)를 참고한다.
- `manifest.json`의 해시는 사고로 인한 손상을 찾는 용도다. 서명이나 출처 인증, 정확도 보증은 아니다.
- 사용자 사진 전송은 #61/#88 완료 전 활성화하지 않는다. 공유 원본은 이 검수된 공개 9장뿐이다.

변경 절차·역할 분담은 [팀원 안내](../../../docs/pill-photo-team-guide.md)를 참고한다.
