# 저장·알림 안정성 변경 및 검증

## 범위

작업 브랜치: `codex/backend-reliability-issues`. UI 컴포넌트, 스타일, 복약 시간 계산, 질문 내용과 사용자 입력 흐름은 변경하지 않는다.

| 이슈 | 구현 범위 | 남은 조건 |
| --- | --- | --- |
| #69 | REST 단일 원자적 commit, 서버 merge field mask, create precondition, 충돌 재시도 트랜잭션; 구독 해제 덮어쓰기 방지 | 운영 배포 |
| #70 | 읽기 실패를 빈 계정으로 취급하지 않음; 최신 read model을 읽는 원자적 변경; canonical 복구 도구 | 운영 데이터 복구는 별도 승인 후 실행 |
| #51 | 안정적인 생성 키, 분산 lease, 결과 checkpoint, 결정적인 질문·분석·실행 ID, 시도 이력 | 외부 서비스 접수 직후 프로세스 종료의 불확실성은 아래 참조 |
| #68 | `status=active`를 limit 전에 조회; 복합 인덱스 | 인덱스 READY 확인 후 배포 |
| #80 | 원본+read model+복구 작업 동시 commit; canonical 재조회; backoff·격리·주기적 대조·수동 재시도 | 운영 cron·관측 확인 |
| #66 | claim lease 만료 회수, 기기별 결과, 429/5xx/timeout 재시도, 최대 5회/30분 제한, Retry-After | DoseOccurrence 모델·지표 통합은 범위 밖. 전체 이슈는 닫지 않음 |
| #77 | 조회 시 구독 POST 제거, 미구독 계정 일정 생성 금지, 동일 입력 no-op, lastSeen 6시간 제한 | 운영 쓰기량 관찰 |
| #65 | 한 명령 실행기, 계정·clock·실패 fixture, Admin/REST 계약, production 브라우저·API smoke, CI artifact | 원격 PR CI 결과는 별도 확인 |
| #54 | 생성 결과의 sourceDocumentIds 연결, 삭제된 근거의 늦은 게시 차단만 준비 | 삭제·보존·익명화 정책 미확정. 연쇄 삭제 미구현, 이슈 유지 |

#54 확인 요청: 문서에서 파생된 AI 분석·질문·실행 기록은 삭제하고 사용자가 작성한 복약·증상·체크인 기록은 보존할지 결정해야 한다. 기존 답변이 참조하는 질문과 여러 문서에 걸친 분석, 기존 데이터의 연결 정보가 없는 경우도 정책에 포함해야 한다. 이 문서는 승인된 개인정보 보존 정책을 대신하지 않는다.

## ADR: 원자적 저장과 복구 작업

### 선택

문서·복약·체크인 등 canonical 변경과 read model revision 증가를 같은 Firestore 트랜잭션에 넣는다. 복약 관련 변경에 활성 구독이 있으면 `medicationReminderSync/{recipientId}`의 pending 작업도 함께 쓴다. 변경을 저장한 직후 동기화를 시도하되 실패했다고 저장된 문서를 되돌려 삭제하지 않는다.

동기화는 전달된 오래된 medications 배열을 사용하지 않고 canonical 계획·구독·기존 일정·revision을 같은 트랜잭션에서 읽는다. 따라서 작업 순서가 뒤집혀도 과거 계획을 재적용할 수 없다. 일정의 의미가 같은 경우 `nextDueAt`을 보존하고 DB 필드 순서나 `updatedAt` 차이만으로 쓰지 않는다. 마지막 복약일에 아직 유효한 회차도 유지한다.

### 대안

- 모든 알림 일정까지 요청 트랜잭션에 포함: 단순하지만 문서 등록에 알림 처리 비용과 500-write 한도가 직접 결합한다.
- 별도 DB 쓰기 후 동기화만 재호출: 프로세스 중단 시 변경 의도가 사라져 선택하지 않았다.
- 별도 큐 서비스: 확장성은 좋지만 새로운 운영 의존성이 필요하다. 현재는 Firestore 작업 문서와 기존 cron을 사용한다.

### 복구 및 관측

Cron은 pending 작업을 최대 25개 처리하고 활성 구독을 커서로 순환 대조한다. 기존 누락 일정과 작업이 없던 레거시 데이터도 점진적으로 복구한다. 실패는 60초 지수 backoff(최대 1시간), 5회 후 `quarantined`가 된다. 상태·시도 수·desired/applied revision·일반화된 오류 코드만 기록한다. 새 계획 변경 또는 운영자 재시도로 격리를 해제할 수 있다. 대조는 건강 데이터가 아닌 처리 요약만 응답한다.

단일 계정의 변경이 500 writes를 넘으면 부분 저장 없이 실패한다. 대규모 계정은 별도 분할 모델이 필요하다. 삭제된 계정의 데이터는 이 복구 도구가 재생성하도록 승인된 범위가 아니다.

### 외부 호출 보장 범위

발송 조회는 활성 일정만 대상으로 `(nextDueAt, id)` 커서를 사용한다. 재시도·lease 대기 건이 첫 페이지를 채워도 뒤의 일정으로 진행한다. 한 번에 최대 1,000건을 조회하고 기본 100건을 claim하므로 대규모 적체는 여러 cron 실행에 걸쳐 처리한다.

AI/Push는 DB 트랜잭션 안에서 호출하지 않는다. 저장된 결과가 있으면 다시 호출하지 않는다. 다만 외부 서비스가 요청을 접수한 직후 checkpoint 전에 프로세스가 죽으면 결과가 불명확하다. 공급자가 멱등 키나 결과 조회를 보장하지 않는 한 이 구간에서 정확히 한 번 호출을 보장할 수 없다. Push는 같은 tag/topic과 회차 ID를 사용하나 운영체제 표시 중복까지 보장하지 않는다. 사용자가 해제하기 직전에 이미 전송된 알림은 회수할 수 없다.

## 로컬·CI 검증

Node 24, Java 21, npm이 필요하다. 운영 `.env*`·`.dev.vars`가 없는 새 checkout/worktree에서:

```sh
npm ci
npx playwright install --with-deps chromium
npm run verify
```

마지막 명령은 unit → typecheck → lint → production build → Firestore/Auth emulator → Admin/REST 계약 → production standalone 서버 → Playwright 순으로 실행하고 프로세스를 정리한다. 자동 생성한 demo 프로젝트, 임의 포트·세션 비밀값과 합성 데이터만 사용한다. 기존 로그인·클라우드 비밀값을 전달하지 않는다. 빌드 시 Google Fonts 다운로드는 허용하며, 실행 중인 앱과 테스트의 외부 fetch/TCP 연결은 preload로 차단한다. 실제 Google 로그인·유료 OpenAI·실제 Push 공급자 접수는 이 검증에 포함하지 않는다.

테스트 전용 로그인 API나 운영 인증 우회 플래그를 추가하지 않았다. 일반 계정 테스트는 실행기만 아는 임의 키로 정상 세션 포맷을 발급하고, production Google 인증 API가 Auth emulator의 unsigned 토큰을 거부하는지 검사한다.

실패 자료: `test-results/`의 screenshot·trace, `playwright-report/`, `verification-artifacts/run.log` 및 `verification.json`. CI는 이를 7일 보관한다. 실제 환자 데이터로 실행하지 않는다.

테스트용 Firebase CLI에 한정하여 취약 전이 의존성을 `@opentelemetry/core@2.10.0`, `uuid@11.1.1`, `re2@1.26.1`로 고정했다. PubSub가 사용하는 W3CTraceContextPropagator 경로의 인스턴스 생성과 emulator 실행을 검증했다. 이 override는 제품 런타임 의존성을 바꾸지 않으며 CLI 업그레이드 시 다시 확인해야 한다.

### 회귀 테스트 추가

- `backend/test-support/memory-firestore.ts`: `failReads`, `failCommits`, `beforeRead`, `beforeCommit`, `barrier`, `fixedClock`. 메모리 구현은 장애 주입용이며 DB 동등성의 근거로 쓰지 않는다.
- `backend/test-support/care-fixtures.ts`: 합성 계정·동의 상태·처방·문서 및 `scriptedFetch` (timeout Error, 429, 5xx 등). 과거/미래 계획은 startDate/endDate를 덮어쓴다.
- `backend/test-support/emulator.ts`: 고유 namespace·계정과 자동 정리. 두 adapter에 같은 계약을 실행한다.
- 제품별 기대 동작은 원인 이슈의 기존 테스트 파일을 확장한다. #65에는 공통 환경과 격리 요건만 둔다.

## 운영 적용 순서

1. 별도 배포 승인을 받은 뒤 `backend/firestore.indexes.json`의 인덱스를 배포하고 READY를 확인한다. 에뮬레이터는 운영 인덱스 준비 여부를 검증하지 않는다.
2. 현 데이터 백업·현재 오류율을 확인한 뒤 앱/Worker 코드를 배포한다. 이 브랜치 작업 중 운영 배포·운영 데이터 삭제는 하지 않는다.
3. 인증된 `/api/push/dispatch` cron을 유지한다. pending 나이, quarantined 수, desired/applied revision 차이, dispatch 실패를 관찰한다.
4. 필요하면 아래 도구를 dry-run 후 실행한다. `--allow-production`은 실제 운영 프로젝트를 지정할 때만 사용하며 운영자 승인이 선행되어야 한다. 출력에는 건강 데이터가 없다.

```sh
FIREBASE_PROJECT_ID=demo-example FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 node --experimental-strip-types backend/scripts/repair-care.mjs read-model google-example
# 실제 변경은 위 명령에 --apply 추가
# reminders: 일정 즉시 재동기화 / retry-reminders: 실패 작업을 pending으로 재등록
```

롤백 시 이전 코드가 read model을 통째로 덮어쓸 수 있으므로 트래픽/cron을 먼저 중지한다. 새 작업·생성 checkpoint를 임의 삭제하지 말고 원자적 쓰기를 지원하는 버전으로 복구한다.

## REST 설계 근거

Firestore 공식 [commit](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit), [Write/updateMask](https://firebase.google.com/docs/firestore/reference/rest/v1/Write), [batchGet](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/batchGet), [beginTransaction](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/beginTransaction) 계약을 사용한다. 트랜잭션 읽기는 bytes transaction을 JSON으로 전달하는 batchGet을 써서 에뮬레이터 GET query의 BYTE_STRING 오류도 피한다.
