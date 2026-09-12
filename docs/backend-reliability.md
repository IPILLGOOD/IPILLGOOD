# 저장·알림 안정성

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

단일 계정의 변경이 500 writes를 넘으면 부분 저장 없이 실패한다. 대규모 계정은 별도 분할 모델이 필요하다. 삭제된 계정의 데이터는 복구 도구로 재생성하지 않는다.

복구 작업의 `queuedAt`은 자동 재시도 중 유지하며 `lastSucceededAt`, `lastFailureAt`, `lastQueueDelayMs`, `appliedRevision`을 다음 pending 상태에서도 보존한다. 운영 도구에서 최초 대기 시간과 이전 성공을 확인할 수 있다. Cron의 `processed`는 no-op을 포함한 처리 수이며 실제 수정 건수로 해석하지 않는다.

### 외부 호출 보장 범위

발송 조회는 활성 일정만 대상으로 `(nextDueAt, id)` 커서를 사용한다. 재시도·lease 대기 건이 첫 페이지를 채워도 뒤의 일정으로 진행한다. 한 번에 최대 1,000건을 조회하고 기본 100건을 claim하므로 대규모 적체는 여러 cron 실행에 걸쳐 처리한다.

AI/Push는 DB 트랜잭션 안에서 호출하지 않는다. 저장된 결과가 있으면 다시 호출하지 않는다. 다만 외부 서비스가 요청을 접수한 직후 checkpoint 전에 프로세스가 죽으면 결과가 불명확하다. 공급자가 멱등 키나 결과 조회를 보장하지 않는 한 이 구간에서 정확히 한 번 호출을 보장할 수 없다. Push는 같은 tag/topic과 회차 ID를 사용하나 운영체제 표시 중복까지 보장하지 않는다. 사용자가 해제하기 직전에 이미 전송된 알림은 회수할 수 없다.

## 로컬·CI 검증

Node 24, Java 21, npm이 필요하다. 운영 `.env*`·`.dev.vars`가 없는 새 checkout/worktree에서:

```sh
npm ci
npx playwright install --with-deps chromium webkit
npm run verify -- --account-full-cycle
```

마지막 명령은 PR·main 푸시 CI와 동일하다. unit → typecheck → lint → production build → Firestore/Auth emulator → Admin/REST 계약 → production standalone 서버 → 브라우저·API → 계정 풀사이클 순으로 실행하고 프로세스를 정리한다. 자동 생성한 demo 프로젝트, 임의 포트·세션 비밀값과 합성 데이터만 사용한다. 기존 로그인·클라우드 비밀값을 전달하지 않는다. 빌드 시 Google Fonts 다운로드는 허용하며, 실행 중인 앱과 테스트의 외부 fetch/TCP 연결은 preload로 차단한다. 실제 Google 로그인·유료 OpenAI·실제 Push 공급자 접수는 이 검증에 포함하지 않는다. `npm run verify`만 실행하면 계정 풀사이클은 제외된다.

테스트 전용 로그인 API나 운영 인증 우회 플래그를 추가하지 않았다. 일반 계정 테스트는 실행기만 아는 임의 키로 정상 세션 포맷을 발급하고, production Google 인증 API가 Auth emulator의 unsigned 토큰을 거부하는지 검사한다.

실패 자료: `test-results/`의 screenshot·trace, `playwright-report/`, `verification-artifacts/run.log`, `verification.json`, `verification.md`. 계정 검증 자료는 `verification-artifacts/full-cycle-report/`, `full-cycle-results/`, `account-deletion/`에 남는다. CI는 이를 7일 보관하고 Actions 실행 요약에 단계별 결과를 표시한다. 실제 환자 데이터로 실행하지 않는다.

브라우저·API 검증이 실패해도 별도 서버·계정을 쓰는 계정 풀사이클은 계속 실행한다. 어느 하나라도 실패하면 전체 명령은 실패로 끝난다. 빌드나 emulator 준비 실패처럼 뒤 단계의 실행 조건이 충족되지 않은 경우에는 중단하며, 요약에는 실제 실행한 단계만 기록한다.

### 현재 화면 흐름과 검증 유지

- 오늘 화면의 인라인 안부 또는 빠른 이동의 상세 기록에서 입력한다. 선택 카드는 숨긴 input을 강제로 누르지 않고 표시된 label을 클릭한 뒤 checked 상태를 확인한다. 저장 완료 화면과 오늘 화면 복귀, 재진입 후 기록 보존을 검사한다.
- 복약 목록은 약 선택 탭을 바꿔 선택 상태·상세 패널·상세 링크가 일치하는지 검사한다.
- 연결 코드는 8칸 입력 UI에서 실제 키 입력과 자동 포커스 이동을 거쳐 제출한다. 계정 풀사이클은 연결된 계정의 접근, 탈퇴 시 연결 해제, 복구·영구 삭제·재가입까지 검사한다.
- 320px·200% 글자 크기 검증은 경로별 단계와 문서·요소의 scrollWidth를 기록한다. 요소 테두리 안에 있는 텍스트나 장식이 넘쳐도 원인을 찾을 수 있도록 한다.
- 화면을 바꾼 PR에서는 해당 E2E도 함께 갱신하고 위 명령을 실행한다. 선택자 변경으로 인한 실패를 `force`, 테스트 생략, 접근성 기준 완화로 숨기지 않는다.

테스트용 Firebase CLI에 한정하여 취약 전이 의존성을 `@opentelemetry/core@2.10.0`, `uuid@11.1.1`, `re2@1.26.1`로 고정했다. PubSub가 사용하는 W3CTraceContextPropagator 경로의 인스턴스 생성과 emulator 실행을 검증했다. 이 override는 제품 런타임 의존성을 바꾸지 않으며 CLI 업그레이드 시 다시 확인해야 한다.

### 회귀 테스트 추가

- `backend/test-support/memory-firestore.ts`: `failReads`, `failCommits`, `beforeRead`, `beforeCommit`, `fixedClock`. 메모리 구현은 장애 주입용이며 DB 동등성의 근거로 쓰지 않는다.
- `backend/test-support/care-fixtures.ts`: 합성 계정·동의 상태·처방·문서. 과거/미래 계획은 startDate/endDate를 덮어쓴다.
- `backend/test-support/emulator.ts`: 고유 namespace·계정과 자동 정리. 두 adapter에 같은 계약을 실행한다.

## REST 설계 근거

Firestore 공식 [commit](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit), [Write/updateMask](https://firebase.google.com/docs/firestore/reference/rest/v1/Write), [batchGet](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/batchGet), [beginTransaction](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/beginTransaction) 계약을 사용한다. 트랜잭션 읽기는 bytes transaction을 JSON으로 전달하는 batchGet을 써서 에뮬레이터 GET query의 BYTE_STRING 오류도 피한다.

## 수동 복구

`backend/scripts/repair-care.mjs`는 기본적으로 dry-run이다. 실제 변경은 `--apply`, 운영 프로젝트는 `--allow-production`도 명시해야 한다. `read-model`은 원본에서 조회 모델을 복구하고, `reminders`는 일정 재동기화, `retry-reminders`는 실패 작업 재등록을 수행한다.

```sh
FIREBASE_PROJECT_ID=demo-example FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 node --experimental-strip-types backend/scripts/repair-care.mjs read-model google-example
```

Firestore 복합 인덱스는 `backend/firestore.indexes.json`으로 관리한다. 에뮬레이터 검증은 실제 프로젝트의 인덱스 준비 상태를 확인하지 않는다.
