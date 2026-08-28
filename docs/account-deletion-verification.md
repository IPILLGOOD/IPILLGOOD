# #99 풀사이클 검증 — 2026-08-28

## 판정: 로컬 풀사이클 통과, 운영 반영·Cron 검증 완료

사용자가 확정한 **탈퇴 후 3개월 보관 → 같은 Google 계정으로 복구 안내 → 명시적 복구 또는 기한 후 영구 삭제** 정책을 기준으로 검증했다. 초기 검증에서 발견한 지연 작업 경합 버그는 사용자 요청에 따라 수정했고, 실패하던 재현 테스트와 새 scheduled 진입점 검사 5개를 포함해 **230개 테스트가 한 번의 전체 실행에서 모두 통과**했다. 운영 조회에서 발견한 #99 미배포, Cloudflare용 계정의 Auth 권한 누락, 복합 인덱스 3개 누락은 후속 사용자 요청에 따라 모두 수정했다. 새 운영 버전의 실제 Cron은 연속 2회 성공했고 운영 프로필의 탈퇴 안내·취소, API 인증 경계도 확인했다. 세부 근거는 [운영 경계 검증 보고서](account-deletion-live-verification.md)에 기록했다. 지정된 Google 테스트 계정의 실제 탈퇴·복구 및 모바일/PWA 실기기 검증은 별도로 남아 있다.

수정한 제품 코드는 `account-deletion.ts`와 `health-data-deletion.ts`의 작업 소유권 검사 및 소프트 삭제 commit이다. 회귀·에뮬레이터 테스트도 보강했다. 최종 230개 통과 후 제품 코드는 추가로 바꾸지 않았고 같은 작업 트리를 배포했다. 운영 사용자의 계정 탈퇴·데이터 삭제, GitHub 이슈 변경·종료는 실행하지 않았다.

## 수정한 버그와 재현 이력

### P2 — 소유권이 만료된 탈퇴 작업이 복구 후 새 알림을 삭제함

수정 전 위치: `backend/src/account-deletion.ts`의 `deleteRecipientNotifications()` 호출 및 이후 checkpoint. 알림 삭제가 `health-data-deletion.ts`에서 조건 없는 batch로 실행됐다.

재현 순서:

1. 작업 A가 소프트 삭제를 시작한 뒤 Push 조회에서 지연된다.
2. 가상 시각을 301초 전진시켜 A의 5분 처리 소유권을 만료시킨다.
3. 작업 B가 소유권을 가져와 알림 정리를 마치고 `soft_deleted`로 전환한다.
4. 사용자가 명시적으로 계정을 복구한다.
5. 복구된 계정에서 새로 알림에 동의해 Push 구독과 복약 알림 일정을 등록한다.
6. 작업 A를 재개한다. A가 **새 구독과 일정까지 삭제한 뒤에야** checkpoint에서 소유권 상실을 발견한다.

수정 전 결과: 계정 상태는 `restored`이나 새 Push 구독은 사라지고 일정도 0건이 됐다. 건강정보 삭제가 재현된 것은 아니다.

수정: 조회한 알림 문서를 삭제하는 트랜잭션에서 해당 작업의 request ID·owner·`processing` 상태·UID/recipientId·유효한 lease를 검사하도록 변경했다. 이 검사와 최대 200개 삭제가 같은 트랜잭션에 들어간다. checkpoint에도 동일한 검사를 적용해 이전 작업이 복구나 재탈퇴 상태를 덮어쓰지 못하게 했다. Firestore의 읽기 후 쓰기 및 충돌 재시도 동작에 맞춰 구현했다. [공식 트랜잭션 문서](https://firebase.google.com/docs/firestore/manage-data/transactions).

재현 테스트는 `backend/src/account-deletion.test.ts`의 `expired suspension worker must not erase a new Push opt-in after another worker restores the account`이다. 수정 전 단독 실행과 전체 단위 테스트에서 같은 assertion이 실패했으며, 수정 후에는 새 구독과 일정 보존을 확인해 통과한다. 이 테스트를 제거하거나 skip하지 않았다.

추가로 정확히 5분에 만료된 작업의 삭제 거부와 Cron 재시도, 소유권을 읽은 뒤 commit 직전에 복구/재탈퇴하는 경합, 200개 초과 알림의 분할 삭제를 검사했다. 실제 Firestore 에뮬레이터의 Admin·REST 양쪽에서도 지연된 작업이 복구 후 새 구독을 지우지 못함을 확인했다. 실제 외부 Push 발송은 없다.

```sh
node --experimental-strip-types --test \
  --test-name-pattern='expired suspension worker' \
  backend/src/account-deletion.test.ts
```

## 수정 후 최종 검증 기록

| 검사 | 결과 |
| --- | --- |
| 프런트 단위 테스트 | 82/82 통과, scheduled 진입점 5개 포함 |
| 백엔드 단위 테스트 | 117/117 통과, 기존 경합 재현 및 추가 경계·동시성 검사 포함 |
| Firestore Admin/REST 및 Auth 에뮬레이터 계약 | 13/13 통과 |
| 기존 브라우저/API 회귀 | 17/17 통과 |
| 서버 발급 세션을 사용하는 추가 생애주기 검사 | 1/1 통과 |
| TypeScript / ESLint / Next 프로덕션 빌드 | 통과 |
| OpenNext Cloudflare 빌드 / Wrangler dry-run | exit 0. 후속 승인된 운영 배포와 실제 Cron도 통과 |

`npm run verify -- --account-full-cycle`이 exit 0으로 종료했다. 합계는 **230개 통과, 0개 실패**이며 `verification-artifacts/verification.json`의 7개 검증 단계가 모두 `passed: true`다. 수정 전 218개 통과·1개 실패, 경합 수정 직후 225개 통과였던 기록과 구분한다.

Cloudflare 빌드에는 `data-uri-to-buffer` 복사 실패 로그가 있었으나 번들은 생성되었고, 후속 `wrangler deploy --dry-run`도 패키징·검사를 통과했다. 후속 조사에서 이 로그는 OpenNext의 문자열 `exports` 처리 오류이며 파일은 동일한 해시로 복사되어 최종 번들에 포함된 것을 확인했다. 로컬 `workerd` 기동과 API 인증 경계도 통과했다. Next의 기존 middleware 명칭 변경 경고는 남아 있다. 후속 사용자 요청으로 운영 버전 `64773bb8-f2ff-4a5f-bd65-90e4196d2e9c`를 100% 배포했다.

기존 브라우저 테스트는 테스트 코드에서 서명한 앱/복구 쿠키를 직접 넣기 때문에 Google 토큰 검증과 실제 세션 발급 연결까지 검증한 것은 아니었다. 새 `front/verification/account-full-cycle.spec.ts`는 이 공백을 보완한다.

## 실제 API를 연결한 생애주기 검사

외부 Google/JWKS만 테스트 제공자로 대체했다. 매 실행마다 임시 RSA 키를 생성하며 앱의 실제 RS256 검증, issuer/audience/provider 검사, Firebase Auth 상태 조회, 세션·복구 쿠키 발급, API, Firestore, Cron 처리 코드를 그대로 사용한다. 테스트 코드에서 앱 세션을 위조하거나 앱에 인증 우회 분기를 추가하지 않았다.

다음 순서를 하나의 브라우저 세션과 계정으로 검사했다.

- Google 형태의 로그인 토큰 → 실제 `/api/auth/google` → 정상 세션 발급.
- 서명 없는 토큰·다른 audience·Google이 아닌 provider 거부.
- 프로필의 탈퇴 안내 열기와 취소; 재인증 5분 초과·타 계정·잘못된 확인 문구·정책 버전·외부 Origin 거부.
- 실제 탈퇴 API 접수 → 즉시 이전 세션/문서 분석 거부 → 화면의 정리 처리 → 로그인 화면 복귀.
- 소프트 삭제에서 Auth 계정과 건강정보는 보존, Push 관련 4개 컬렉션은 정리.
- 같은 Google 식별자로 재로그인 → 일반 세션 없이 복구 안내; 취소해도 기한 불변.
- 재로그인 → 화면에서 명시적으로 복구 → 기존 건강정보 복구, 이전 기기 세션은 계속 거부, Push는 자동 복원하지 않음.
- 재탈퇴 → 새 요청 ID 및 3개월 기한 생성.
- 만료 1분 전 Cron에서는 건강정보 보존; 기한 후 복구 화면 변경 및 복구 API 410.
- 인증된 cleanup API를 반복 실행해 200개 초과 데이터와 부모 없는 중첩 문서, 프로필, 읽기 모델, Auth 사용자, 작업 기록 부재 확인. 최종 정리에는 3번의 Cron 호출이 필요했다.
- 대조 계정의 Auth·데이터는 유지.
- 같은 Google 식별자로 재가입하면 새 Firebase UID와 빈 문서·복약 데이터. 이전 Push도 되살아나지 않음.

앱 프로세스의 시계만 이동했으며 OS 시계나 저장된 삭제 기한을 직접 바꾸지 않았다. 브라우저 오류는 0건이었다. 복구·기한 만료 화면 스크린샷을 확인했다. 기존 화면 검사에는 320/768/1024/1440px, axe WCAG, 키보드와 실패 재시도가 포함된다.

최종 전체 실행 프로젝트는 `demo-rel-a4baaa249ee3`이며 결과는 `verification-artifacts/verification.json`, 로그는 `verification-artifacts/run.log`, 단계별 증거는 `verification-artifacts/account-deletion/full-cycle-evidence.json`이다.

검증 도구의 loopback Secure 쿠키 처리와 Next Date 래퍼 호환 문제는 앞선 실행에서 수정했다. 이번 전체 재검증에서는 로컬 Cloudflare 호출 제한 상태가 다른 테스트와 공유돼 429가 한 번 발생했다. 생애주기마다 고유한 합성 클라이언트 IP를 부여하고 그 흐름 안에서는 끝까지 같은 IP를 사용하도록 테스트를 격리했다. 제품의 호출 제한을 끄거나 올리지 않았으며, 이 조정 후 단위 검사부터 전체 과정을 다시 실행해 모두 통과했다.

## 재실행

Node 24와 Java 21을 사용했다. 이 워크스페이스의 기본 Node/Java 버전 대신 검증 가능한 런타임을 지정한다.

```sh
PATH=/Users/youngha/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/opt/openjdk@21/bin:$PATH \
  npm run verify -- --account-full-cycle
```

이미 만들어진 프로덕션 빌드로 생애주기 검사만 독립 재현하려면 다음을 사용한다. 이 명령은 단위·정적 검사·빌드·기존 회귀를 대체하지 않는다.

```sh
PATH=/Users/youngha/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/opt/openjdk@21/bin:$PATH \
  npm run verify -- --account-full-cycle-only
```

두 실행 모두 격리된 `demo-` 프로젝트, loopback Auth/Firestore 에뮬레이터, 무작위 세션 키를 사용한다. 앱 런타임과 테스트의 외부 네트워크는 차단한다. 임시 인증 키와 테스트 계정은 종료 시 정리한다. `.env`/운영 자격 증명이 있는 작업 트리에서는 검증 도구가 실행을 거부한다.

## 종료 전 남은 확인

1. 완료: 운영 인덱스 3개 READY, 실제 실행 서비스 계정의 최소 Auth 권한 세 개 확인, #99 배포, 실제 Cron 연속 2회 성공 및 운영 프로필·API 경계 확인.
2. 지정된 폐기 가능한 테스트 계정으로 실제 Google 재인증 → 탈퇴 최종 확인 → 복구와 모바일/PWA 복귀를 검사. 실제 팝업의 계정 선택·닫기·타임아웃과 운영 콜백 URI 허용은 추가로 확인했지만, 계정 삭제나 모바일 실기기 전체 흐름은 수행하지 않았다. 3개월 경계는 격리된 환경 또는 명시적으로 승인한 테스트 전용 데이터로 검사해야 한다.
3. [이슈 #99](https://github.com/IPILLGOOD/IPILLGOOD/issues/99)의 기존 즉시 삭제 중심 문구·완료 기준을 확정된 3개월 정책과 맞추기. 운영 검증 시점에도 이슈는 OPEN이며 이번 검증에서 수정하거나 닫지 않았다. #62/#88의 전체 정책 검토 완료를 의미하지도 않는다.
