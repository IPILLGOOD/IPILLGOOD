# PWA 복약 알림

모바일 브라우저·설치형 PWA의 프로필 탭에서 기기 알림을 켜고 끈다. 사용자 동작으로 권한과 구독을 활성화하며 조회만으로 새 구독을 등록하지 않는다. 데스크톱 일반 브라우저에서는 알림 설정 카드를 표시하지 않는다.

## 구독과 계정 연결

- `/api/push/config` returns a fingerprint of the current login identity. Browser requests must match the identity rendered with the page, preventing an old tab from changing a newly signed-in account. Connected-session expiry refresh preserves this identity; a fresh login creates a new one.
- `POST /api/push/subscriptions` prepares an **inactive** registration and returns a signed, HttpOnly binding cookie. `PATCH` acknowledges the cookie and activates that exact generation. Subscription activation and canonical reminder schedules commit in one Firestore transaction; the response uses its result without a second database read. An unacknowledged preparation cannot send.
- Device IDs and endpoint reuse revoke previous active/pending registrations. Automatic repair is restricted to an already opted-in or pending registration for the same login; opt-out clears both states.
- Logout attempts browser unsubscribe and closes visible notifications, then removes the login session. The server atomically disables the subscription and queues schedule reconciliation. If revocation fails, its signed, generation-scoped cookie remains available to `/api/push/cleanup`, including after logout. It grants no health-data access and cannot disable a later opt-in.
- Public pages retry server/browser cleanup on reload, online/pageshow and every minute while failed. Browser cleanup failure does not skip server cleanup. New opt-in waits for pending browser cleanup. Web Locks serialize cleanup and registration across tabs when supported (otherwise per-context serialization plus server generation checks apply).
- Push payloads identify their subscription generation. The service worker checks the current session, binding and server active status before display and before opening a notification. Missing/old bindings, expired sessions and unavailable authorization suppress the notification. Raw endpoint URLs, keys and session credentials are not added to logs.


## 발송·표시·재시도

예약 작업은 서울 시간의 복약 계획과 활성 구독을 바탕으로 다음 회차를 조회한다. 기본 시각은 아침 08:00, 점심 13:00, 저녁 19:00, 취침 전 21:00이다. 문서 초안 확정·복약 변경·문서 삭제는 일정 동기화를 갱신한다. 발송은 예정 시각부터 30분 동안만 유효하며 404·410 구독은 비활성화한다.

결정적 회차 ID와 작업 lease로 중복을 제한하고 429·5xx·시간 초과를 정해진 기간과 횟수 안에서 재시도한다. 외부 접수 직후 서버가 중단되면 결과가 불명확할 수 있어 정확히 한 번 전달·표시를 보장하지 않는다. [저장·알림 안정성](backend-reliability.md)

Push 서비스의 HTTP 성공과 기기 표시를 구분한다. 서비스 워커가 `showNotification`을 완료하면 서버에 표시 receipt를 보낸다. 유효한 세션·구독을 확인할 수 없으면 표시를 억제하며 오프라인 건강 알림 재생은 하지 않는다. 이미 공급자·OS에 접수된 알림은 서버 트랜잭션으로 회수할 수 없다. 알림 본문은 약명·진단명 대신 일반 복약 확인 문구를 사용한다.

## Endpoint 검사

[`endpoint.ts`](../front/src/lib/push/endpoint.ts)의 허용 목록을 단일 기준으로 사용한다. HTTPS와 정확한 호스트·하위 도메인 경계를 확인하고 인증정보·비표준 포트·fragment·무관한 호스트를 거부한다. query 토큰은 원형을 유지한다. Windows Edge WNS도 포함한다. [Microsoft WNS 채널 안내](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/push-notifications/wns-overview#requesting-a-notification-channel)

## 구성과 검증

VAPID·Cron·운영 테스트 비밀값 설정은 [개발 안내](development-guide.md)에 있다. 앱과 `sw.js`를 함께 배포하며 이전 등록이 현재 로그인에 연결되지 않았다면 사용자가 다시 구독해야 한다.

전체 검증은 미확인 구독, 활성화 실패, 계정 전환, 이전 탭, 로그아웃 정리 실패·재시도, 새 구독과 오래된 정리의 경쟁, 만료 연결과 알림 표시·클릭 차단을 합성 요청으로 검사한다. `qa:push`는 실행 중인 앱에서 Chrome CDP로 서비스 워커의 알림 표시와 receipt 요청 경로를 점검한다. 실제 공급자·기기 도착은 별도 확인이 필요하다.

실기기에서는 PWA 설치·프로필에서 알림 허용·다음 복약 시각 확인·앱 종료 후 시스템 알림 표시·해제 후 구독 비활성화를 확인한다. iPhone·iPad는 알림을 지원하는 OS의 홈 화면 설치형 PWA가 필요하다. 실제 endpoint·키·기기 식별자를 테스트 fixture나 공개 로그에 넣지 않는다.
