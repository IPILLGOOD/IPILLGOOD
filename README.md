# IPILLGOOD

> 처방전 한 장을, 오늘의 돌봄으로.

IPILLGOOD는 어려운 처방 정보를 쉬운 말로 정리하고, 매일의 복약과 몸 상태를 가족이 함께 살펴 다음 진료에 가져갈 기록으로 연결하는 고령자 복약·웰니스 서비스입니다.

**[서비스 둘러보기](https://ipillgood.wkddudgk4869.workers.dev/)** · [제품 기획](md/IPILLGOOD_제품_기획안.md) · [개발·운영 안내](docs/development-guide.md)

## 팀 소개

| <a href="https://github.com/hongjiyeon56"><img src="https://avatars.githubusercontent.com/u/237960924?s=120&v=4" width="80" height="80" alt="홍지연 GitHub 프로필 사진"></a> | <a href="https://github.com/dkim1112"><img src="https://avatars.githubusercontent.com/u/74619981?s=120&v=4" width="80" height="80" alt="김동은 GitHub 프로필 사진"></a> | <a href="https://github.com/kanade012"><img src="https://avatars.githubusercontent.com/u/87456609?s=120&v=4" width="80" height="80" alt="장영하 GitHub 프로필 사진"></a> | <a href="https://github.com/stringnine"><img src="https://avatars.githubusercontent.com/u/179396940?s=120&v=4" width="80" height="80" alt="지현구 GitHub 프로필 사진"></a> |
|:---:|:---:|:---:|:---:|
| **[홍지연](https://github.com/hongjiyeon56)** | **[김동은](https://github.com/dkim1112)** | **[장영하](https://github.com/kanade012)** | **[지현구](https://github.com/stringnine)** |
| 팀장 · Insight | Insight | Build | Build |

![IPILLGOOD 랜딩페이지](design/screenshots/landing-desktop.png)

## 어떤 문제를 해결하나요?

여러 약을 복용하다 보면 약마다 다른 복용 방법을 기억하고, 빠뜨린 약이나 몸 상태의 변화를 꾸준히 기록하기 어렵습니다. 떨어져 사는 가족은 오늘 약을 챙겼는지 확인하기 어렵고, 다음 진료에서는 그동안의 변화를 기억에 의존해 설명하게 됩니다.

IPILLGOOD는 처방전·약봉투에 적힌 정보, 식약처 공식 약 정보, 실제 복약·증상 기록을 연결합니다. 보호자는 오늘 확인할 일을 파악하고, 어르신과 함께 남긴 기록을 의료진에게 보여줄 수 있습니다. [문제 정의와 근거 자료](md/IPILLGOOD_근거자료.md)

## 무엇을 할 수 있나요?

| 기능 | 이용 방법 |
|---|---|
| 오늘 할 일 | 예정된 복약과 완료 여부를 보고, 복용 여부와 오늘 몸 상태를 기록합니다. |
| 맞춤 안부 확인 | 최근 기록을 바탕으로 구성한 질문에 답합니다. 본인 응답과 보호자의 관찰을 구분해 남깁니다. |
| 처방전·약봉투·진단서 등록 | 이미지나 PDF에서 내용을 정리합니다. 약과 복용 일정을 원본과 대조해 수정·확정하고, 진단서에서 확인한 질환도 검토해 프로필에 반영합니다. |
| 복용약과 공식 정보 검색 | 복용약을 확인하고 제품명·성분명으로 식약처 정보를 찾습니다. 효능·용법·주의사항과 쉬운 설명, 공식 출처를 함께 봅니다. |
| 사진으로 약 검색 | 같은 알약의 앞뒤 사진을 올려 외형·각인이 비슷한 공식 품목을 비교합니다. 후보, 판단 보류, 재촬영 안내를 구분해 보여줍니다. |
| 식사/영양 자료 탐색 | 확인받은 질환을 선택해 관련 한국어 병원·학회 자료, 블로그와 영상의 요약·원문 링크를 확인합니다. |
| 돌봄 대시보드와 Care Report | 복용약·최근 기록·의료진에게 물어볼 질문을 모아 보고, 최근 7일 보고서를 출력합니다. |
| 프로필 관리 | 돌봄 대상자의 기본 정보, 알레르기, 확인받은 질환, 보호자 메모와 건강정보 처리 동의를 관리합니다. |
| 연결 코드 로그인 | 계정 소유자가 발급한 코드로 다른 기기에서 로그인해 같은 돌봄 공간을 이용합니다. |
| PWA 복약 알림 | 홈 화면에 앱을 설치하고 프로필에서 기기 알림을 켜면 예정된 복약 시각에 알림을 받습니다. |
| 데이터·계정 관리 | 건강정보 삭제, 연결 해제, 회원 탈퇴를 선택할 수 있습니다. 탈퇴 후 3개월 안에는 같은 Google 계정으로 복구를 확인할 수 있습니다. |

사진 검색 결과는 약을 확정하거나 복용약에 자동 등록하지 않습니다. 문서에서 추출한 약도 사용자가 원본과 확인하고 확정한 뒤 복약 일정에 반영됩니다.

## 이렇게 시작하세요

1. **둘러보기 또는 로그인** — 가입 없이 비식별 샘플로 체험하거나 Google 계정으로 나만의 돌봄 공간을 만듭니다. 연결 코드를 받았다면 코드로 로그인합니다.
2. **돌봄 정보 확인** — 대상자 프로필과 건강정보 처리 동의를 확인하고 처방전·약봉투를 등록합니다.
3. **매일 기록** — 오늘 할 일에서 복약을 확인하고 몸 상태를 남깁니다. 필요한 기록·문서 등록·사진 검색은 가운데 **빠른 이동**에서 엽니다.
4. **함께 확인하고 진료 준비** — 연결된 기기에서 같은 기록을 확인하고, 대시보드와 Care Report로 다음 진료를 준비합니다.

모바일 하단 메뉴는 **오늘 할 일 · 복용약 · 빠른 이동 · 식사/영양 · 프로필**입니다. 화면 맨 위에서 아래로 당겨 새로고침할 수 있고, 알림과 계정 설정은 프로필에 모여 있습니다. 로그인에 실패하면 다시 시도하거나 로그인 화면을 새로 열 수 있습니다.

데모는 방문자마다 별도 샘플을 사용하므로 변경한 내용이 다른 방문자에게 보이지 않습니다. iPhone·iPad의 복약 알림은 홈 화면에 설치한 PWA에서 권한을 허용해 사용합니다.

## 서비스 아키텍처

Next.js가 화면과 서버 요청을 처리하고, 백엔드가 돌봄 기록·문서 분석·공식 정보 조회·알림·계정 관리를 담당합니다. Google 로그인과 연결 코드 로그인은 같은 돌봄 공간으로 연결될 수 있으며, 데모는 별도 공간으로 분리됩니다. 건강 데이터는 서버의 인증·권한·동의 검사를 거쳐 접근합니다.

### 전체 구조

```mermaid
flowchart TB
  USER["보호자 · 어르신"] --> CLIENT

  subgraph CLIENT["사용자 화면 · 기기"]
    direction LR
    APP["웹 · 설치형 PWA<br/>오늘 할 일 · 복용약 · 식사/영양 · 프로필<br/>빠른 이동 → 기록·문서·사진 검색"]
    SAMPLE["로그인 없는 화면 체험<br/>샘플 상태만 메모리에서 변경"]
    DEVICE["PWA 서비스 워커<br/>계정·구독 확인 · 알림 표시<br/>표시 receipt · 알림 클릭 이동"]
  end

  CLIENT --> AUTH
  subgraph AUTH["인증 · 돌봄 공간 연결"]
    direction LR
    GOOGLE["Google 로그인<br/>Firebase 사용자·토큰 확인"] --> SESSION
    CODE["연결 코드 로그인<br/>소유자의 돌봄 공간 연결<br/>추가 기기 한 대 · 세션 교체"] --> SESSION
    DEMO["둘러보기 로그인<br/>방문자별 임시 데모 공간"] --> SESSION
    SESSION["서버 세션<br/>소유자 · 연결 사용자 · 데모<br/>계정·연결 유효성 확인"]
  end

  AUTH --> GATE["Cloudflare Workers · Next.js / OpenNext<br/>Server Components · Server Actions · API<br/>요청별 세션·돌봄 범위·권한·동의·입력 검증"]
  GATE --> CARE_FLOW & DOCUMENT_FLOW & SEARCH_FLOW & ACCOUNT_FLOW & PUSH_FLOW

  subgraph CARE_FLOW["매일의 돌봄 · backend"]
    direction TB
    RECORD["복약·안부 기록<br/>예정 회차와 실제 복용 구분<br/>본인 응답 · 보호자 관찰<br/>증상·메모 · 지난 기록 수정"]
    AGENT["Care Agent<br/>최근 14일 기록·근거 검증<br/>템플릿 질문 · 저장 세트 재사용<br/>실패 시 규칙 기반 질문"]
    VIEW["돌봄 현황 조회<br/>오늘 일정 · 복약 달력<br/>대시보드 · 의료진 질문<br/>최근 7일 Care Report"]
    RECORD --> AGENT --> VIEW
  end

  subgraph DOCUMENT_FLOW["문서 분석 · 검토"]
    direction TB
    DOCUMENT["처방전·약봉투·진단서<br/>이미지/PDF 검사 · 진행 상태<br/>중복 검토 · 약·일정·진단 추출"]
    ENRICH["공식 정보 보강<br/>식약처 품목 확인<br/>HIRA 정확 일치 우선<br/>미일치·실패 시 웹 출처 보강"]
    REVIEW["사용자 원본 대조·수정·확정<br/>복약 계획 · 확정 질환 반영<br/>문서·연결 복약 계획 삭제<br/>알림 일정 동기화"]
    DOCUMENT --> ENRICH --> REVIEW
  end

  subgraph SEARCH_FLOW["약 · 식사/영양 탐색"]
    direction TB
    DRUG["제품명·성분명 검색<br/>식약처 품목별 원문 결합<br/>쉬운 설명 · 공식 링크<br/>개인 복약 계획과 분리"]
    PHOTO["사진으로 약 검색<br/>기기 전처리·메타데이터 제거<br/>전송 동의 → Vision·앞뒤 OCR<br/>공식 후보 · 보류 · 재촬영"]
    NUTRITION["확정 질환별 자료 탐색<br/>질환명·코드로 한국어 검색<br/>출처·언어·접근 상태 검사<br/>요약·원문 링크 최대 8개"]
    DRUG ~~~ PHOTO ~~~ NUTRITION
  end

  subgraph ACCOUNT_FLOW["프로필 · 계정 관리"]
    direction TB
    PROFILE["프로필·동의<br/>기본 정보 · 알레르기·메모<br/>문서·직접 입력의 확정 질환"]
    CONNECTION["돌봄 연결<br/>소유자 코드 발급 · 상태 확인<br/>기기 연결·해제 · 만료 처리"]
    LIFECYCLE["본인 확인 후 데이터 관리<br/>건강정보 삭제 · 탈퇴 즉시 차단<br/>3개월 내 명시적 복구<br/>기한 후 계정·기록 영구 삭제"]
    PROFILE ~~~ CONNECTION ~~~ LIFECYCLE
  end

  subgraph PUSH_FLOW["PWA 복약 알림"]
    direction TB
    SUBSCRIBE["프로필의 기기 알림 설정<br/>권한 요청 · 구독 준비·활성화<br/>계정·기기 연결 · 해제<br/>로그아웃 후 잔여 구독 정리"]
    REMINDER["일정 동기화<br/>확정 계획·활성 구독 기준<br/>서울 시간 다음 알림 계산<br/>누락 복구 · 변경 반영"]
    DISPATCH["예약 발송<br/>회차·작업 중복 제한<br/>실패 재시도 · 만료 구독 해제<br/>접수·표시 상태 구분"]
    SUBSCRIBE --> REMINDER --> DISPATCH
  end

  CARE_FLOW & DOCUMENT_FLOW & ACCOUNT_FLOW & PUSH_FLOW -->|"범위별 조회·저장"| FIRESTORE
  subgraph FIRESTORE["Cloud Firestore · 사용자 데이터"]
    direction LR
    CARE_DB[("돌봄 원본<br/>프로필·동의·질환 · 복약 계획<br/>복용·증상·안부 · 문서 분석·출처")]
    READ_DB[("화면 조회 모델<br/>최근 복약·증상·문서 요약<br/>원본과 함께 revision 갱신")]
    AGENT_DB[("Care Agent 기록<br/>분석 · 질문 세트 · 답변<br/>버전·근거·처리 상태")]
    AUTH_DB[("계정·연결 상태<br/>연결 코드·세션 · 데모 만료<br/>탈퇴·복구·삭제 상태")]
    PUSH_DB[("알림 상태<br/>기기 구독 · 다음 일정<br/>동기화 · 전송·표시 기록")]
  end
  AUTH -->|"연결·데모·계정 상태 확인"| FIRESTORE

  SEARCH_FLOW --> REFERENCE
  subgraph REFERENCE["공개 참조 데이터 · 사용자 기록과 분리"]
    direction LR
    CATALOG["Workers 정적 카탈로그<br/>식약처 전체 목록 두 번 수집·검증<br/>분할 청크 · 최신성·해시 검사"]
    CACHE["공개 질환별 검색 캐시<br/>24시간 · 검색·검증 버전 구분"]
  end

  CARE_FLOW & DOCUMENT_FLOW & SEARCH_FLOW -->|"기능별 최소 입력으로 분석·조회"| EXTERNAL
  subgraph EXTERNAL["외부 분석 · 공식 정보"]
    direction LR
    OPENAI["OpenAI Responses API<br/>구조화 분석 · 쉬운 설명<br/>Vision · OCR · 웹 검색"]
    ANALYZER["선택형 외부 문서 분석기<br/>설정 시 우선 사용<br/>미설정 시 OpenAI 분석"]
    MFDS["식약처<br/>제품 허가 · e약은요<br/>약물유전 · 낱알식별 정보"]
    HIRA["HIRA<br/>진단명·KCD/ICD<br/>정확 일치 조회"]
  end

  CRON["Cloudflare 예약 작업<br/>복약 발송·일정 대조<br/>탈퇴 기한·데모·연결 만료 정리"] --> PUSH_FLOW & ACCOUNT_FLOW
  PUSH_FLOW --> DELIVERY["Web Push 공급자 → 기기 서비스 워커<br/>현재 계정·구독 재확인 → 시스템 알림 표시<br/>표시 receipt 전송 · 클릭 전 권한 확인"]
```

전체 구조의 화살표는 기능 사이의 데이터·처리 관계를 나타냅니다. 앱 요청은 서버에서 계정과 돌봄 공간을 확인한 뒤 처리하며, 브라우저의 Firestore 직접 접근은 차단합니다. 로그인 없는 화면 체험은 로컬 샘플 상태만 사용하고, 둘러보기 로그인은 방문자별로 분리된 서버 데모 공간을 사용합니다.

| 처리 흐름 | 동작과 데이터 연결 |
|---|---|
| 매일의 돌봄 | 확정 복약 계획으로 예정 회차를 계산하고 실제 복용·증상·안부를 따로 기록합니다. 원본과 조회 모델을 함께 갱신해 오늘 화면·달력·대시보드·보고서에서 같은 기록을 확인합니다. |
| 맞춤 안부 | 목표일 이전 최근 14일 기록을 분석하고, 실제 이벤트 근거를 확인해 코드의 템플릿으로 질문을 만듭니다. 질문·답변·생성 상태를 보존하며 저장된 질문은 재사용합니다. AI 실패 시 규칙 기반 질문으로 이어갑니다. |
| 문서 등록 | 업로드 분석은 검토할 초안을 만듭니다. 사용자가 원본과 대조해 약·일정을 확정해야 복약 계획과 알림에 반영됩니다. 진단서는 HIRA 정확 일치를 우선 확인하고, 없거나 실패한 항목을 출처가 있는 웹 검색으로 보강합니다. |
| 공식 약 검색 | 제품명·성분명으로 식약처 품목을 찾고 동일 품목의 공식 정보를 연결합니다. 쉬운 설명은 원문을 바탕으로 만들며 개인 복약 계획을 자동 변경하지 않습니다. |
| 사진 검색 | 브라우저에서 가공한 앞뒤 사진을 Vision·면별 OCR로 읽고, 관찰 특징을 공식 카탈로그 전체와 비교합니다. 사진 품질·쌍·목록 최신성을 확인한 뒤 후보·보류·재촬영·무결과를 구분합니다. |
| 영양 탐색 | 사용자가 확인한 질환의 ID를 서버에서 검증하고 질환명·코드로 자료를 검색합니다. 본문·자막을 확인한 결과와 검색 미리보기를 구분하며 공개 질환별 결과만 캐시합니다. |
| 복약 알림 | 프로필에서 기기 구독을 활성화하면 확정 복약 계획으로 다음 시각을 계산합니다. 예약 작업이 발송하고 서비스 워커는 현재 계정·구독을 다시 확인합니다. 공급자 접수와 실제 표시 receipt를 별도로 기록합니다. |
| 계정 관리 | 연결 코드는 소유자의 돌봄 공간을 추가 기기 한 대에 연결합니다. 탈퇴 시 접근·알림을 차단하고 3개월 안에 명시적으로 복구할 수 있으며 기한 후에는 영구 삭제합니다. 건강정보만 삭제하는 흐름은 별도의 본인 확인을 거칩니다. |

복약·증상·프로필과 문서 분석 결과는 돌봄 공간별로 저장합니다. 문서 원본 이미지·PDF와 사진 검색의 사진·결과는 앱에 영구 보관하지 않습니다. 외부 AI 요청의 `store:false`와 앱의 원본 미저장이 외부 제공자의 모든 보관 정책까지 없애는 것은 아닙니다.

공식 카탈로그는 사용자 데이터와 분리한 정적 참조 데이터이며 168시간 이내의 검증 자료만 사용합니다. 자동 갱신은 지원하지 않아 목록 갱신과 재배포가 필요합니다. 사진 검색·영양 탐색 결과는 복약 계획을 자동 변경하지 않고, 알림의 공급자 접수는 기기의 즉시 표시나 정확히 한 번 도착을 보장하지 않습니다. 저장 구조와 실패·복구 계약은 [기술 구조](md/architecture.md), [저장·알림 안정성](docs/backend-reliability.md)에 있습니다.

### Google 로그인과 연결 코드 로그인

연결 코드는 계정 소유자의 돌봄 공간을 다른 기기에서 이용하는 수단입니다. 두 Google 계정의 데이터를 합치는 기능은 아닙니다. 현재 추가 연결은 한 대만 유지하며, 소유자가 프로필에서 연결을 해제할 수 있습니다.

```mermaid
flowchart TB
  GOOGLE["Google 로그인"] --> FIREBASE["Firebase 사용자 확인"]
  FIREBASE --> VERIFY["서버 토큰 검증<br/>계정 상태 확인"]
  VERIFY -->|"이용 중인 계정"| OWNER["소유자 세션"]
  VERIFY -->|"탈퇴 후 보관 중"| RECOVERY["복구 전용 화면<br/>같은 계정으로 복구 확인"]
  RECOVERY -->|"3개월 내 복구"| OWNER
  OWNER --> PROFILE["프로필·동의 확인"]
  PROFILE --> SPACE[("소유자의 돌봄 공간")]
  OWNER --> ISSUE["프로필에서 연결 코드 발급"]
  ISSUE --> CODE["다른 기기에서 코드 입력"]
  CODE --> CHECK["코드·계정 상태 확인<br/>연결 세션 발급<br/>이전 기기 세션 교체"]
  CHECK --> CONNECTED["연결 사용자 세션"]
  CONNECTED -->|"연결 상태·세션 버전 확인"| SPACE
  OWNER --> REVOKE["연결 해제"]
  REVOKE --> BLOCK["연결 세션 접근 차단"]
  DEMO["둘러보기"] --> TEMP["방문자별 데모 세션"]
  TEMP --> SAMPLE[("분리된 비식별 샘플 공간")]
```

최초 연결 코드는 발급 후 10분 안에 입력합니다. 연결 후에는 같은 코드로 다시 로그인할 수 있고, 새 기기로 로그인하면 이전 연결 기기의 세션을 교체합니다. 연결은 30일 미사용, 소유자의 해제 또는 탈퇴 시 종료됩니다. 연결 사용자는 계정 소유자의 연결 발급·탈퇴·건강정보 삭제 권한을 갖지 않습니다.

### 사진으로 약을 찾는 흐름

사진에서 관찰한 특징을 공식 목록과 비교합니다. AI가 약 이름을 직접 결정하지 않으며, 사진이 흐리거나 앞뒤를 판별하기 어려우면 재촬영을 안내합니다.

```mermaid
flowchart TB
  INPUT["빠른 이동 → 사진으로 약 검색<br/>같은 알약의 앞면·뒷면 사진"] --> PREP["브라우저 전처리<br/>방향·크기 보정 · 확대·회전<br/>메타데이터 제거"]
  PREP --> CONSENT["사진 전송 동의"]
  CONSENT --> VALIDATE["서버 검사<br/>세션·동의 · 형식·용량<br/>중복 사진 확인"]
  VALIDATE --> VISION["Vision<br/>모양·색·분할선·사진 품질"]
  VALIDATE --> FRONT["앞면 OCR<br/>각인 읽기"]
  VALIDATE --> BACK["뒷면 OCR<br/>각인 읽기"]
  VISION --> FEATURES["구조화 결과 검증·결합<br/>앞뒤 일치 · 판독 가능 여부"]
  FRONT --> FEATURES
  BACK --> FEATURES
  FEATURES -->|"비교 가능한 특징"| COMPARE["공식 목록 전체 비교<br/>각인·외형별 후보 정렬"]
  OFFICIAL["식약처 낱알식별 정보"] --> PREPARE["전체 목록 수집·무결성 확인"]
  PREPARE --> ASSETS["정적 카탈로그<br/>최신성·청크 해시 검증"]
  ASSETS --> COMPARE
  COMPARE --> RESULT["비교 후보 · 판단 보류<br/>결과 없음"]
  FEATURES -->|"사진 품질·쌍 확인 부족"| RETAKE["재촬영 안내"]
  ASSETS -->|"오래되거나 불완전한 목록"| STOP["검색 중단·갱신 안내"]
```

## 개인정보와 결과 해석

- 건강정보 처리 동의를 확인하고, 로그인한 사용자가 접근할 수 있는 돌봄 공간만 조회·수정합니다.
- 사진과 문서는 분석을 위해 외부 제공자에게 전달될 수 있습니다. 앱의 원본 미저장이 외부 제공자의 모든 보관 정책까지 없애는 것은 아닙니다.
- 복약 계획과 실제 복용 기록을 구분합니다. 미응답을 복용 완료나 정상 상태로 해석하지 않습니다.
- 탈퇴하면 이용과 알림을 중단하고 기록을 3개월간 복구용으로 보관한 뒤 영구 삭제합니다. 별도의 건강정보 삭제는 본인 확인과 삭제 범위 확인을 거쳐 진행합니다.
- 서비스는 진단, 복용 중단·용량 변경·대체 약 추천을 하지 않습니다. 사진 후보와 AI 설명을 의료진·약사의 확인을 대신하는 근거로 사용하지 마세요. 데모에는 비식별 정보만 사용합니다.

## 기술과 관련 문서

화면은 **Next.js · React · TypeScript**, 인증·데이터는 **Firebase Authentication · Cloud Firestore**, 앱 실행과 예약 작업은 **Cloudflare Workers**, 분석은 **OpenAI**와 **식약처·HIRA 공식 정보**를 사용합니다.

- [문서 색인](docs/README.md) · [개발·운영 안내](docs/development-guide.md) — 로컬 실행, 외부 연동 설정, 검증과 배포
- [PWA 탐색과 로그인 복구](docs/pwa-navigation.md) · [사진 검색 상세 구조](docs/pill-photo-web.md)
- [식사/영양 자료 탐색](docs/nutrition-exploration.md) · [탈퇴·복구 정책](docs/account-deletion.md)
- [제품 기획안](md/IPILLGOOD_제품_기획안.md) · [문제 정의와 근거](md/IPILLGOOD_근거자료.md) · [사업성](md/value-and-viability.md)
