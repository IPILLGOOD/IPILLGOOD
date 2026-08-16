# Care Atlas 기술 구조

## 설계 목표

1. 건강정보를 브라우저에서 Firestore로 직접 쓰지 않는다.
2. 복약 계획과 사용자의 실제 복용 응답을 분리한다.
3. 약 변경과 증상을 함께 보여주되 인과관계는 생성하지 않는다.
4. AI 제공자를 바꿔도 데이터·안전 경계는 유지한다.

## 요청 흐름

```text
Browser
  ├─ Server Component ── Firestore repository ── Firebase Admin ── Firestore
  ├─ Form ── Server Action ── Zod validation ── repository ── Firestore
  └─ Document Form ── /api/documents/analyze ── analyzer ─┬─ external AI API
                                                          └─ OpenAI vision

Diagnosis enrichment ── HIRA disease API ── exact match ── official code/name
                                    └─ unavailable/no match ── OpenAI web search

Document analysis ── Firestore metadata/result
                  └─ uploaded source file is discarded after the request
```

Firestore 보안 규칙은 클라이언트 읽기·쓰기를 모두 거부합니다. 서버 액션은 공개 POST 진입점이므로 1차 MVP에서는 `CARE_ATLAS_DEMO_MODE`로 쓰기를 제한합니다. 실제 서비스에서는 각 액션에서 인증·보호자 권한·돌봄 대상자 소유권을 다시 확인해야 합니다.

## Firestore 구조

```text
careRecipients/{recipientId}
  displayName
  ageBand
  heightCm / weightKg (선택)
  allergies[]
  conditions[]
  mobilityNote
  caregiverNote
  consentConfirmed
  lastConfirmedAt

  medicationPlans/{medicationId}
    productName / ingredientName
    purposePlain / descriptionPlain
    doseAmount / frequency / timing
    startDate / endDate
    status / isNew
    sourceLabel
    watchFor[]

  doseEvents/{eventId}
    medicationPlanId
    scheduledAt
    response
    answeredBy / answeredAt

  symptomEvents/{eventId}
    symptomType / occurredAt / severity
    dailyLifeImpact / reporterType / note

  dailyCheckIns/{yyyy-mm-dd}
    completedAt / completedBy
    medicationResponses[] / symptoms[] / note

  clinicalDocuments/{documentId}
    fileName / documentType / uploadedAt
    status / redacted / sourceLabel / size
    analysis
      summary
      findings[]
      carePoints[]
      questionsForProfessional[]
      diagnoses[]
      diseaseInformation[] / diseaseLookup
      disclaimer / source

  clinicianQuestions/{questionId}
    priority / question / reason

careReadModels/{recipientId}
  recipient / medications[] / clinicianQuestions[]
  doseEvents[] (최근 90개)
  symptomEvents[] (최근 45개)
  documents[] (최근 10개)
  todayCheckIn / updatedAt
```

화면 렌더링은 정규화된 하위 컬렉션을 매번 전부 조회하지 않고 `careReadModels/{recipientId}` 한 문서를 읽습니다. 프로필·체크인·문서 저장은 원본 하위 문서와 read model을 함께 갱신합니다. read model의 이벤트 수를 제한해 Firestore 문서 크기가 계속 커지는 것을 막고, 보고서에 필요한 최근 기록만 유지합니다. read model이 없는 기존 데이터는 최초 한 번 하위 컬렉션에서 재구성됩니다.

## 데이터 원칙

- 새 처방이 기존 약을 자동으로 덮어쓰지 않음
- 미응답과 미복용을 다른 값으로 저장
- 자기보고와 보호자 관찰을 `answeredBy`, `reporterType`으로 구분
- 생성 요약은 원본 이벤트를 바꾸지 않음
- 문서 파일은 현재 서버 메모리에서 메타데이터만 확인하고 폐기

## 문서 분석 API 연결

[medication-analyzer.ts](../backend/src/ai/medication-analyzer.ts)가 AI 제공자 경계입니다.

`front/.env.local`에 다음 값을 설정하면 외부 분석 API를 호출합니다.

```env
AI_ANALYSIS_ENDPOINT=https://example.com/analyze
AI_API_KEY=
```

외부 API 요청은 `documentType`, `fileName`, `contentType`, `contentBase64`를 JSON으로 전달합니다. 응답은 다음 구조를 사용합니다.

```json
{
  "analysis": {
    "summary": "보호자가 이해할 수 있는 전체 요약",
    "findings": [{ "label": "약 이름", "value": "원본에서 확인된 값" }],
    "carePoints": ["돌봄 중 살펴볼 점"],
    "questionsForProfessional": ["의사·약사에게 물어볼 점"],
    "disclaimer": "원본과 전문가 설명으로 확인해야 한다는 안내"
  }
}
```

외부 분석 API가 없으면 `OPENAI_API_KEY`로 OpenAI 이미지/PDF 분석을 사용합니다. 진단서 분석 응답에는 가능하면 다음 필드를 함께 반환합니다.

```json
{
  "diagnoses": [{ "name": "본태성 고혈압", "code": "I10" }]
}
```

진단명 또는 코드가 추출되면 `HIRA_DISEASE_API_KEY`로 건강보험심사평가원 질병정보서비스를 먼저 조회합니다. 정확한 코드·질병명 매칭이 없거나 API가 설정되지 않았거나 일시적으로 실패한 경우에만 OpenAI Responses API의 `web_search` 도구를 호출합니다. 웹 검색은 공공기관·대학병원·국제 보건기관 도메인으로 제한하고, 사용한 URL을 결과에 저장해 화면에서 클릭 가능한 출처로 표시합니다. OpenAI 요청은 `store: false`로 전송합니다.

모든 분석 키가 없으면 비식별 데모 분석을 반환하므로 업로드부터 결과 확인까지의 화면 흐름은 그대로 체험할 수 있습니다.

약물 검색은 `MFDS_PARMGEN_API_KEY`로 식약처 약물 유전 정보 원문을 먼저 가져옵니다. 결과가 있으면 환자 정보 없이 공개된 식약처 원문만 OpenAI Responses API에 전달하고, JSON Schema로 `overview`, `geneInfo`, `productInfo`, `caregiverNote`를 생성합니다. OpenAI 요청은 `store: false`이며, 생성 실패 시 쉬운 설명만 생략하고 식약처 원문은 그대로 표시합니다.

## AI 안전 고도화 계획

후속 구현 순서:

1. 이미지 내 이름·주민번호·주소 자동 가리기
2. OCR 후보와 신뢰도 추출
3. 보호자 원본 대조·확정
4. 식약처 품목·성분 ID 매칭
5. HIRA DUR 결정적 안전 확인
6. 근거가 연결된 쉬운 말 변환
7. 금지 지시와 과도한 단정 검사

AI 키 유무와 관계없이 복용 중단·용량 변경·대체 약 추천은 허용하지 않습니다.
