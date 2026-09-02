# 신규 품목 알약 사진 평가 세트

`pill-photo-unseen-product-eval-2026-09-02-v3`는 기존 개발·v2 평가에 등장하지 않은 공개사진 7개 품목을 고정한 일반화 파일럿이다. 각 사례는 동일한 알약의 공식 앞·뒷면 사진 한 장씩으로 구성한다.

## 분할과 봉인

| 분할 | 품목 수 | 사용 목적 |
| --- | ---: | --- |
| `validation` | 4 | 각인 영역 보존·전처리·OCR·결합 규칙 개선 |
| `holdout` | 3 | 구현과 통과 기준을 동결한 뒤 마지막 한 번만 평가 |

두 분할은 품목기준코드가 겹치지 않으며, v2의 개발·검증·holdout 사진과도 파일 해시가 겹치지 않는다. 이 manifest와 분할은 새 사진에 대한 AI 호출 전에 고정했다. `holdout` 세 건은 현재 `sealed_unopened`이고 외부 AI에 전송하지 않았다.

## 정답 연결 원칙

- `sourceGroup`은 공개 압축파일 안의 5자리 자료 그룹 ID일 뿐, 품목기준코드로 간주하지 않는다.
- 사진에서 직접 확인한 제형·모양·색상·앞뒤 각인을 현재 식약처 고정 카탈로그와 대조한다.
- 각 품목은 health.kr 제품 페이지와 현재 공식 레코드의 고정 SHA256 지문을 함께 가진다.
- 정답과 원본 그룹명은 모델 입력에서 제거하고, 특징 추출이 끝난 뒤 오프라인 채점 단계에서만 결합한다.
- 공식 기록의 외형이 달라지거나 동일 품목코드가 복수 레코드가 되면 로더가 평가를 중단한다.

`40767` 자료의 파일명 날짜는 현재 품목 허가 시점보다 이르다. 파일명만으로 촬영·허가 이력을 단정하지 않으며, 이 사례의 정답은 현재 카탈로그에서 유일한 `KIM / 100`, 연두색 장방형 외형과 제조사 제품 페이지의 일치에 근거한다. 이 제한은 최종 결과 해석에 남긴다.

## Validation 결과와 동결

검색 규칙을 커밋 `f9a3d87`로 동결한 뒤, validation 네 품목을 범용 Vision `gpt-5.6-sol`과 면별 OCR `gpt-5.6-sol`로 실행했다. 총 12요청·재시도 0회였고 `recall@1·5·20`은 모두 4/4였다. 강한 후보·강한 오답·재촬영 대상 후보 노출은 모두 0건이다. 두 사례는 부분 판독 때문에 `needs_review`, 두 사례는 `candidates_found`였지만 어느 결과도 자동 확정 가능한 `strong` 등급은 아니었다.

이 결과는 모델과 검색 규칙 조정에 사용한 validation 통과일 뿐 최종 일반화 성능이 아니다. 요약은 [validation-result-2026-09-02.json](validation-result-2026-09-02.json)에 고정하며, holdout 세 품목은 이 결과와 규칙을 동결하기 전까지 열지 않았다.

## 범위 제한

이 자료는 검은 배경에 분리된 공개 알약 사진이다. 실제 사용자가 촬영한 휴대폰 사진, 손·포장·여러 알약이 함께 나온 사진, 파손·흐림·반사·복잡한 배경에 대한 성능을 입증하지 않는다. 표본도 7개뿐이므로 통과하더라도 운영 정확도나 자동 확정을 주장할 수 없다.

전체 원본 압축파일과 실행 산출물은 계속 `verification-artifacts/` 아래에 두고 Git에는 포함하지 않는다. Git에는 재현에 필요한 선택 사진 14장, 정답 manifest, 출처와 한계만 포함한다.

## 실행 명령

정답 연결과 validation 실행·채점은 v3를 명시한다. 첫 명령과 채점은 외부 요청이 없고, 두 번째 명령만 공개사진 8장을 OpenAI로 전송한다.

```sh
npm run pill:labels --workspace @care-atlas/backend -- --fixture v3
npm run pill:evaluate --workspace @care-atlas/backend -- validation --fixture v3 --live --confirm-public-transfer
npm run pill:score --workspace @care-atlas/backend -- --input <saved-features.json> --split validation --fixture v3
```

위 validation과 동일한 파이프라인을 재현하려면 실행 셸에서 `OPENAI_MODEL=gpt-5.6-sol`과 `OPENAI_OCR_MODEL=gpt-5.6-sol`을 명시한다. Windows PowerShell에서는 다음처럼 현재 터미널에만 설정할 수 있다.

```powershell
$env:OPENAI_MODEL = "gpt-5.6-sol"
$env:OPENAI_OCR_MODEL = "gpt-5.6-sol"
npm run pill:evaluate --workspace @care-atlas/backend -- validation --fixture v3 --live --confirm-public-transfer
```

holdout은 구현과 기준을 커밋으로 동결하기 전에는 실행하지 않는다. 동결 뒤 최종 실행 시에만 `holdout --fixture v3 --live --confirm-public-transfer --confirm-holdout-final`을 사용한다.
