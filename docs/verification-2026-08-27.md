# 검증 기록 — 2026-08-27

브랜치: `codex/backend-reliability-issues` / 시작점: `a20776f` (origin/main).

원래 checkout에는 진행 중인 cherry-pick이 있어 별도 worktree에서 작업했다. 원래 checkout의 파일·cherry-pick 상태는 변경하지 않았다. UI 컴포넌트와 스타일 파일은 수정하지 않았다.

## 실행 결과

| 검사 | 결과 |
| --- | --- |
| 기존 기준선 | 단위 97개 통과 |
| 최종 `npm run verify` | 전체 성공, 임의 demo 프로젝트와 임의 포트 사용 |
| 단위 테스트 | front 37 + backend 85 = 122개 통과 |
| Firestore 에뮬레이터 | Admin SDK 3 + REST 3 = 6개 통과 |
| Production standalone E2E | 데모 전체 흐름 + 일반 계정 범위/API 인증, 2개 통과 |
| 타입·린트·diff 공백 검사 | 통과 |
| Next production / Cloudflare Worker build | 통과 |
| `npm audit` / `npm audit --omit=dev` | 알려진 취약점 0건 |
| 앱 내 브라우저 직접 확인 | 로그인 → 데모 오늘 화면 → 문서 화면, 콘솔 error 0건 |

로컬 Node 23.3.0 / Java 21에서 실행했다. CI는 의존성이 공식 지원하는 Node 24 / Java 21을 사용한다. Node 23의 모듈 관련 경고와 기존 Next middleware deprecation 경고는 오류 없이 남아 있다.

## 검증한 장애와 경합

- atomic batch 중 create 충돌: 앞선 write까지 모두 취소됨.
- concurrent nested merge: 두 변경과 inactive 구독 상태가 보존됨.
- Admin/REST transaction 충돌, cursor pagination 계약.
- 서로 다른 문서 동시 등록과 오래된 프로필 저장, 삭제/등록 경합.
- 읽기 장애를 빈 계정으로 대체하지 않음; canonical 데이터에서 read model 복구.
- 원본 변경과 pending 복구 작업이 같은 commit에 저장됨.
- 동일 질문 최초 동시 요청: Agent 1회, 질문·분석·성공 실행 각 1건.
- Agent 결과 checkpoint 후 게시 실패 재시도와 lease 중단 회수.
- 종료 일정 101건이 활성 알림을 막지 않음.
- 처리 중 lease 100건 뒤의 다음 페이지 알림도 발송됨.
- 동시 dispatch, claim 후 중단, 429 Retry-After, 기기별 성공 보존, 5xx 최대 5회.
- 동시 opt-out·구독 삭제·계획 중단을 발송 결과가 되돌리지 않음.
- 미구독 계정과 같은 입력 재동기화의 불필요한 writes 없음.
- 누락 일정 복구, 반복 실패 격리와 운영자 재시도.
- 마지막 복약일의 유효한 알림을 동기화가 조기 종료하지 않음.
- 브라우저 기록 저장 → 문서 추가/삭제 → 재조회 → 대시보드·보고서 → 로그아웃 정리.
- 비인증·타 출처 요청과 Auth emulator unsigned 토큰을 production API가 거부함.

## 검증 범위 밖 및 적용 조건

- 운영 Firebase 인덱스 READY 확인, 실제 계정 OAuth, 유료 AI 응답, 실기기 Push 접수·표시, 운영 배포는 수행하지 않았다.
- #54의 삭제·보존·익명화 정책은 미확정이며 연쇄 삭제는 완료하지 않았다.
- #66의 발송 복구·재시도 부분만 구현했다. DoseOccurrence·지표 통합까지 포함한 전체 이슈 완료는 아니다.
- 외부 접수와 DB checkpoint 사이의 프로세스 중단에 대해 정확히 한 번 호출을 보장하지 않는다.
- 원격 CI 결과는 연결된 PR의 Checks가 기준이다. 로컬 결과를 원격 CI 통과로 대신하지 않는다.

설계·복구 명령·인덱스 선배포·롤백 주의점은 [운영 가이드](backend-reliability.md)를 따른다.
