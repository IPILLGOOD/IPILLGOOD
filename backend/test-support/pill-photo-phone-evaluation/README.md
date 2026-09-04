# 스마트폰 사진 평가 기록

이 폴더는 Git에서 제외된 휴대폰 원본 사진과 원본 AI 응답 대신, 리뷰에 필요한 비민감 메타데이터와 점수 요약을 고정한다. `results-2026-09-02.json`에는 fixture 버전, 이미지 SHA-256, 익명화한 품목 식별자 해시, 공식 레코드 지문, 제품·사례·사진 수, 모델·프롬프트·전처리·검색·카탈로그 버전과 점수가 들어 있다. API 키, 약 이름, 사용자의 문서와 원본 모델 응답은 포함하지 않는다.

깨끗한 체크아웃에서는 다음 명령으로 기록 스키마, validation/holdout의 정확한 6제품·6사례·12사진 조건, split 간 해시 비중복과 평가 계약을 검증한다.

```sh
npm run typecheck
npm run pill:verify --workspace @care-atlas/backend
```

이 상태는 `metadata_only_without_private_photos_or_raw_model_outputs`다. 즉 기록의 구조와 코드 계약은 재현할 수 있지만, 사진에서 특징을 다시 추출하거나 과거 OpenAI 응답을 재생하는 것은 아니다.

전체 대조가 필요하면 팀의 비공개 전달 경로에서 받은 검수 완료 자료를 아래 위치에 그대로 둔다. 파일을 이름 변경하거나 압축 해제 과정에서 다시 저장하면 SHA-256이 달라져 검증이 실패한다.

```text
verification-artifacts/pill-photo-v4-intake/
  validation/manifest.local.json + 12 JPG
  holdout/manifest.local.json + 12 JPG
```

자료가 있으면 같은 `pill:verify` 명령이 로컬 manifest·사진·공식 레코드를 Git의 비민감 기록과 해시 수준으로 추가 대조한다. 실제 특징 추출을 다시 실행하려면 저장소 루트에서 `front/.env.local`의 `OPENAI_API_KEY`를 사용하고 아래 명령을 실행한다. 외부 전송과 최대 18회의 유료 요청이 발생한다.

```sh
npm run pill:evaluate --workspace @care-atlas/backend -- validation --fixture v4 --live --confirm-reviewed-transfer
npm run pill:score --workspace @care-atlas/backend -- --input <validation-features.json> --split validation --fixture v4

npm run pill:evaluate --workspace @care-atlas/backend -- holdout --fixture v5 --live --confirm-reviewed-transfer --confirm-holdout-final
npm run pill:score --workspace @care-atlas/backend -- --input <holdout-features.json> --split holdout --fixture v5 --confirm-holdout-final
```

v5 holdout은 이미 열렸으므로 위 명령을 다시 실행한 결과를 새로운 블라인드 성능으로 주장하면 안 된다. 저장된 최종 결과는 `recall@1/5/20` 모두 2/6이며 사용자 대상 알약 식별 기능의 완료나 운영 준비를 의미하지 않는다.
