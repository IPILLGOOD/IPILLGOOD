# #99 운영 경계 검증 — 2026-08-28

## 판정

사용자의 운영 수정 요청에 따라 **누락된 인덱스 3개·실행 계정의 Firebase Auth 최소 권한·#99 배포를 반영했다.** 실제 Worker 자격 증명으로 Auth 조회와 세 쿼리 성공을 확인했고, 운영 프로필의 탈퇴 안내와 취소도 검증했다. 개인 계정 탈퇴·삭제는 실행하지 않았다. 지정된 테스트 계정의 실제 Google 탈퇴·복구 및 모바일/PWA 실기기 검증까지 완료했다는 뜻은 아니다.

새 scheduled 검사 5개를 포함한 최종 `npm run verify -- --account-full-cycle`은 `demo-rel-a4baaa249ee3`에서 **230개 통과·0개 실패**로 종료했고 타입·린트·Next 빌드도 통과했다. 그 뒤 제품 코드는 바꾸지 않았고 같은 작업 트리를 Cloudflare용으로 다시 빌드해 배포했다.

## 운영 수정 결과

| 항목 | 반영·확인 결과 |
| --- | --- |
| 배포 | 버전 `64773bb8-f2ff-4a5f-bd65-90e4196d2e9c` 100%, 배포 ID `d4833156-97ce-4b7f-8c06-2476cfba5a56`, 2026-08-28 14:12:39 KST |
| 소스 | `15d6725` 기반의 검증된 미커밋 #99 작업 트리. HEAD 자체에 #99가 커밋됐다는 뜻은 아님 |
| 실제 실행 계정 | Worker의 기존 secret에서 `care-atlas-cloudflare@care-atlas-seoul-2026-v2.iam.gserviceaccount.com` 확인. 개인 키·토큰은 출력·반출하지 않음 |
| 최소 Auth 권한 | 프로젝트 custom role `ipillgoodAccountLifecycle`: `firebaseauth.users.get`, `firebaseauth.users.update`, `firebaseauth.users.delete`만 추가. 기존 `roles/datastore.user` 및 다른 IAM 바인딩 유지 |
| 실제 권한 검사 | Worker 자격 증명의 `testIamPermissions`가 세 권한 모두 반환, 존재하지 않는 임의 UID의 Auth lookup 200 및 사용자 없음 |
| 인덱스 | `CICAgOjXh4EK`(reminder sync), `CICAgJiUpoMK`(push subscriptions), `CICAgJim14AK`(reminder schedules) 모두 READY. Firestore 규칙 변경 없음 |
| 실제 쿼리 | 14:12:01 KST, Worker 자격 증명으로 아래 세 쿼리 모두 성공. 쓰기·수동 Push 발송 없이 읽기만 실행 |
| API 경계 | 운영 login 200, 탈퇴 상태 GET 401, 무인증 cleanup POST 401, 무인증 복구 화면 307 → login |
| 복구 API | 같은 출처의 무인증 restore POST 401, 외부 Origin의 restore POST 403, 응답 no-store |
| 프로필 UI | 실제 로그인된 Chrome에서 계정 관리 → 회원 탈퇴 안내 열기 → 3개월·명시적 복구·Google 계정 제외 문구 → 취소 → 원래 버튼으로 포커스 복귀 확인 |
| 실제 Cron | 새 운영 버전에서 연속 2회 `outcome: ok`, 예외·오류 로그 0 |

기존 Cloudflare Worker, secret, 환경 변수와 매분 Cron을 유지했다. `--keep-vars`로 앱 버전을 올린 뒤 해당 앱 버전만 100%로 전환했다. 실제 계정의 토큰 무효화·비활성화·삭제를 권한 검사 목적으로 실행하지 않았다.

### 배포 후 실제 Cron 증거

| 실제 이벤트 시각 (KST) | 운영 버전 | 결과 |
| --- | --- | --- |
| 2026-08-28 14:13:02.689 | `64773bb8-f2ff-4a5f-bd65-90e4196d2e9c` | `ok`, exceptions 0, logs 0 |
| 2026-08-28 14:14:02.691 | 동일 | `ok`, exceptions 0, logs 0 |

로그 관찰은 Cron 이벤트의 시각·버전·결과만 출력하도록 제한했고 두 번 확인한 후 종료했다. 새 scheduled 구현은 계정 정리 → 데모 정리 → Push 처리 경로를 모두 호출하고 하나라도 실패하면 예외를 발생시킨다. 따라서 두 이벤트는 세 경로의 성공을 확인한 결과다. 다만 실제 만료 계정의 영구 삭제 완료를 증명하는 검사는 아니며, 계정 삭제 시나리오 자체는 위 230개 격리 테스트로 검증했다.

### Cloudflare와 Firebase의 역할

Cloudflare는 프런트와 API·Cron을 실행하는 서버다. 사용자 기록은 Firestore, 로그인 계정은 Firebase Authentication에 있다. Worker가 Firebase API를 호출하므로 해당 Firebase 서비스 계정의 권한이 필요하며, Cloudflare 계정을 관리하는 기능은 아니다. 소프트 삭제 중에는 기존 토큰만 무효화하고 Firebase 계정은 로그인 가능하게 유지한다. 3개월이 지나 복구하지 않은 계정에 대해서만 영구 삭제 과정에서 Firebase Auth 비활성화·삭제를 수행한다. Google 계정 자체는 삭제하지 않는다.

실제 자격 증명 확인에는 운영 트래픽이 없는 임시 읽기 전용 preview 버전을 사용했다. 임의 인증값과 SHA-256 검사로 보호하며 2026-08-28 14:38:37 KST부터 모든 요청을 404로 거부한다. 인증값·키·토큰·사용자 데이터는 보고서에 기록하지 않는다. 진단 초기에 raw workerd fetch의 `Illegal invocation`이 발생해 OpenNext와 같은 함수 래퍼로 진단 코드만 보정했다. 운영 앱의 OpenNext 초기화에는 해당 래퍼가 이미 있으므로 제품 코드를 변경하지 않았다.

## 초기 진단 기록 — 아래는 운영 반영 전 상태

다음 표와 초기 실패 근거는 수정 전 상황을 보존한 기록이다. 현재 상태는 위 운영 수정 결과와 배포 후 Cron 증거를 기준으로 판단한다.

| 항목 | 확인한 결과 |
| --- | --- |
| #99 배포 여부 | 미배포. 현재 버전은 `22398df0-2efd-4a22-9010-76929344d649`, 커밋 `15d6725`. 실제 프로필에 탈퇴 UI가 없고 `GET /api/account/deletion`은 404 |
| Firebase Auth 권한 | Cloudflare용 서비스 계정에 `roles/datastore.user`만 부여. 필요한 `firebaseauth.users.get/update/delete` 없음 |
| 실제 Cron | 매분 실행되지만 Push 알림 동기화 쿼리에서 HTTP 400으로 실패 |
| Firestore 인덱스 | 운영 복합 인덱스 0개. 필요한 세 쿼리 모두 `FAILED_PRECONDITION: The query requires an index` 재현 |
| Google 설정 | 제공자 활성화, 운영·localhost·127.0.0.1 허용 도메인 확인 |
| 실제 Google 팝업 | Chrome에서 로컬 Worker의 버튼 → 실제 Google 계정 선택 화면 → 창 닫기 → 취소 안내·버튼 재활성화 확인. 응답 대기 만료 안내도 확인 |
| 모바일용 OAuth 콜백 | 운영 `https://ipillgood.wkddudgk4869.workers.dev/__/auth/handler` 프록시 200. 해당 redirect URI를 Google이 허용하며 계정 선택 페이지로 이동; URI 불일치 없음 |
| Cloudflare 빌드 복사 로그 | 실제 파일 누락 아님. OpenNext의 문자열 `exports` 처리 오류 재현, 파일 세 곳의 해시 일치 및 최종 번들 포함 확인 |
| 로컬 Worker 실행 | `workerd` 기동·로그인 200·탈퇴 API 미인증 401·cleanup 미인증 401·복구 미인증 307 확인 |
| scheduled 진입점 | 새 회귀 테스트 5개 통과: 비밀값 검사, 호출 순서·인증, 일부 실패 시 나머지 실행, 다음 호출 재시도, fetch 유지 |

## 초기 배포·IAM 근거

`wrangler deployments list --json`과 `versions view`로 확인한 운영 버전 생성 시각은 `2026-08-27T21:10:45.92787Z`, 배포 시각은 `2026-08-27T21:10:48.110984Z`다. 버전 설명은 `main-15d6725-issues-50-53-72-silent-PWA-reconnect-CI-verified`다. 해당 커밋의 scheduled 진입점은 `/api/demo/cleanup`과 `/api/push/dispatch`만 호출한다. 작업 트리의 #99 변경은 운영에 없다.

프로젝트 `care-atlas-seoul-2026-v2`의 IAM 정책에서 `care-atlas-cloudflare@care-atlas-seoul-2026-v2.iam.gserviceaccount.com`에는 `roles/datastore.user`만 연결되어 있다. 이 역할의 실제 권한 목록에 `firebaseauth.users.*`는 없다. 프로젝트에는 상위 조직/폴더가 없다. 별도의 `firebase-adminsdk-fbsvc` 계정에는 Auth 관리자 역할이 있지만 두 계정은 다르다.

Cloudflare에는 `FIREBASE_SERVICE_ACCOUNT_JSON`, `PUSH_CRON_SECRET` 등 필요한 secret **이름**이 존재한다. secret 값은 읽거나 출력하지 않았으므로 실제 바인딩된 서비스 계정이 위 Cloudflare용 계정과 일치하는지는 운영 반영 시 확인해야 한다. 계정명만으로 실제 자격 증명 일치를 단정하지 않는다. 추가 IAM Policy Troubleshooter는 해당 API가 비활성화되어 사용할 수 없었으며 활성화하지 않았다.

## 초기 실제 Cron 실패 원인

읽기 전용 tail에서 `2026-08-28T04:26:02Z`(한국 시각 13:26:02), `cron: "* * * * *"`, 운영 버전 `22398df0-2efd-4a22-9010-76929344d649`의 실행을 확인했다. 결과는 `exception`이며 로그는 `Scheduled medication reminders failed`와 `Firestore REST request failed: HTTP 400`이다. 이 로그는 기존 Push 작업의 실패이고 아직 배포되지 않은 #99 삭제 작업의 실패를 의미하지 않는다.

실제 Firestore에서 **쓰기나 Push 발송 없이** 각 쿼리를 `limit(1)`로 실행했다. 세 쿼리 모두 HTTP 400, `FAILED_PRECONDITION`, `The query requires an index`를 반환했다. 운영 인덱스 조회 결과는 빈 목록이었다.

| 컬렉션 | 필요한 오름차순 필드 |
| --- | --- |
| `medicationReminderSync` | `status`, `nextAttemptAt` |
| `pushSubscriptions` | `active`, `id` |
| `medicationReminderSchedules` | `status`, `nextDueAt`, `id` |

이 세 인덱스는 이미 `backend/firestore.indexes.json`에 정의되어 있다. 운영 반영 시 Firestore 규칙을 함께 바꾸지 말고 인덱스만 반영한 뒤 `READY`와 세 쿼리 성공, 다음 실제 Cron 성공을 확인해야 한다. 인덱스나 권한을 이번 진단 과정에서 생성하지 않았다.

## Google·모바일 검증 범위

Firebase 관리 API에서 Google 제공자 활성화 및 허용 도메인을 확인했다. 공개 프로젝트 설정 API도 운영 Origin/Referer로 정상 응답했다. 기본 Firebase 인증 iframe과 운영 인증 프록시는 모두 200이다.

내장 브라우저의 운영 로그인 버튼에서는 네트워크 오류가 두 번 재현됐다. 이를 서비스 전체의 로그인 장애로 단정하지 않고 Chrome에서 교차 확인했다. Chrome의 기존 운영 세션으로 오늘 화면과 프로필이 정상 열렸다. 기존 사용자를 로그아웃시키지 않았으며 프로필도 저장하지 않았다.

별도 로컬 Worker(`demo-account-worker-qa`, 실서비스 자격 증명 없음)에서는 **실제 Firebase 웹 SDK와 실제 Google 계정 선택 팝업**이 열렸다. 계정을 선택하지 않고 닫았을 때 `Google 로그인 창이 닫혔어요. 다시 시도해주세요.`와 재활성화된 버튼을 확인했다. 60초 대기 만료 후에도 오류 안내와 재시도가 가능했다. 브라우저에 있는 개인·조직 계정을 테스트 계정으로 임의 지정하지 않았다.

운영 모바일 콜백 URI를 사용하는 Google OAuth 진입 요청도 계정 선택 페이지까지 성공했다. 다만 이것은 **콜백 등록 검증**이지 실제 모바일 Safari/설치형 PWA에서 인증 복귀·재인증·탈퇴·복구까지 완료했다는 뜻은 아니다. 해당 검증에는 지정된 테스트 계정과 배포본이 필요하다. Firebase가 안내하는 동일 출처 인증 프록시 조건은 [공식 리디렉션 지침](https://firebase.google.com/docs/auth/web/redirect-best-practices)을 기준으로 확인했다.

## 빌드 로그와 Worker 검증

`@opennextjs/cloudflare`의 `transformPackageJson()`에 실제 `data-uri-to-buffer@4.0.1` package.json을 넣으면 `TypeError: Cannot use 'in' operator to search for 'workerd' in ./dist/index.js`가 발생한다. `copyWorkerdPackages()`가 이 예외를 포괄적으로 잡아 `Failed to copy`로 출력한다. 패키지의 `exports`는 문자열이고 `workerd` 분기는 없다. 같은 현상은 [OpenNext 이슈 #1299](https://github.com/opennextjs/opennextjs-cloudflare/issues/1299)에 보고돼 있다.

원본, Next standalone, OpenNext server-function의 `data-uri-to-buffer/dist/index.js`는 모두 1,852바이트이며 SHA-256이 `2600a836f11329477b5be94145cdb95a7b4888a5acb60851b1276beab3d9e29a`로 일치한다. 최종 Wrangler 번들에도 이 모듈이 포함되어 있다. 이 파일 누락을 이유로 배포를 막을 근거는 해소됐으며 의존성 소스를 임의 패치하거나 경고를 숨기지 않았다.

실제 OpenNext 번들을 `wrangler dev --local`로 실행해 로그인 HTML과 #99 미인증 경계를 확인했다. 운영 자격 증명 없이 실행했으므로 실제 데이터 작업 성공을 의미하지 않는다. `--test-scheduled`에서 비밀값 없는 호출은 명시적인 설정 오류로 실패하는 것도 확인했다. [Cloudflare의 로컬 Cron 테스트 방식](https://developers.cloudflare.com/workers/examples/cron-trigger/)을 사용했다.

`front/test/scheduled-worker.test.mjs`의 5개 테스트는 실제 `custom-worker.ts`를 가져오되 Next handler만 합성 응답으로 대체한다. 정리 경로 누락·인증 누락·실패 은폐를 방지하는 회귀 검사이며 운영 Cron 성공의 대체 증거가 아니다.

## 남은 실제 계정·실기기 검증

운영 인덱스·최소 Auth 권한·#99 배포는 사용자 요청에 따라 반영했다. 남은 계정 생애주기의 실제 Google 검증에는 **실제 탈퇴·복구에 사용할 폐기 가능한 Google 테스트 계정**이 필요하다. 개인/조직 계정의 IPILLGOOD 데이터를 임의 삭제하거나 운영의 3개월 삭제 기한을 임의 단축하지 않는다. Google 계정 자체는 삭제 대상이 아니다.

3개월 경계는 운영 시간을 바꿔 검증하지 않는다. 격리된 테스트 환경의 시계 제어로 검증했고, 운영에서 추가 검증하려면 명시적으로 승인한 테스트 전용 데이터가 필요하다. 실제 모바일/PWA 실행 환경이 없으면 그 항목을 완료로 표시하지 않는다. GitHub 이슈는 수정하거나 닫지 않았다.
