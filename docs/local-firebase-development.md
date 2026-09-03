# 로컬 Firebase 인증 개발

브라우저에서 선택하는 Google 계정과 Next.js 서버가 Firebase에 접근할 때 사용하는 주체는 서로 다릅니다.

- 브라우저 계정은 Firebase Authentication에 로그인하는 서비스 사용자입니다. 이 계정에는 프로젝트 IAM 역할이 필요하지 않습니다.
- 서버 실행 주체는 Firestore와 Identity Toolkit API를 호출합니다. 실제 프로젝트를 사용할 때만 ADC(Application Default Credentials)와 IAM 역할이 필요합니다.

## 권장 경로: Local Emulator Suite

Node.js 24와 Java 21 이상을 준비한 뒤 프로젝트 루트에서 실행합니다.

```bash
npm install
npm run doctor:local
npm run dev:local
```

`doctor:local`은 Node·Java·Firebase CLI·에뮬레이터 포트 구성을 확인합니다. `dev:local`은 다음 값을 프로세스에 주입하고 Auth·Firestore Emulator와 Next.js를 함께 실행합니다.

```text
FIREBASE_PROJECT_ID=demo-ipillgood-local
FIRESTORE_EMULATOR_HOST=127.0.0.1:8181
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9199
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-ipillgood-local
NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9199
```

세션 비밀값은 실행할 때마다 임의로 만들고 실제 서비스 계정·ADC 파일은 사용하지 않습니다. `demo-` 프로젝트와 loopback 주소가 아니면 애플리케이션이 에뮬레이터 연결을 거부합니다. Google 로그인 버튼을 누르면 실제 Google 계정 선택기가 아니라 Auth Emulator가 제공하는 로컬 가상 계정 화면이 열립니다. 로컬 토큰은 서명되지 않으므로 개발 모드, `demo-` 프로젝트, loopback Auth·Firestore 조합에서 Auth Emulator가 해당 계정을 확인한 경우에만 서버가 허용합니다.

IAM 없는 핵심 로그인 회귀 검증은 다음 명령으로 실행합니다.

```bash
npm run verify:local-auth
```

이 검증은 가상 Google 사용자를 만들고, 애플리케이션의 `/api/auth/google` 경계에서 토큰과 계정을 확인한 뒤, Firestore Emulator를 거쳐 로그인 세션 쿠키가 생성되는지 검사합니다.

공식 근거:

- [Local Emulator Suite 프로젝트 선택](https://firebase.google.com/docs/emulator-suite/connect_firestore#choose_a_firebase_project)은 실서비스 자원이 없는 `demo-` 프로젝트 사용을 권장합니다.
- [Authentication Emulator 연결](https://firebase.google.com/docs/emulator-suite/connect_auth)은 Web SDK의 `connectAuthEmulator`와 서버의 `FIREBASE_AUTH_EMULATOR_HOST` 설정, 가상 타사 IDP 로그인 화면을 설명합니다.
- [Firestore Emulator 연결](https://cloud.google.com/firestore/native/docs/emulator#connect_to_the_emulator)은 Node.js 서버 클라이언트가 `FIRESTORE_EMULATOR_HOST`를 사용하도록 안내합니다.

## 실제 Firebase 프로젝트를 연결할 때

실제 프로젝트 데이터가 꼭 필요한 작업에만 이 경로를 사용합니다. 프로젝트 관리자는 먼저 `firestore.googleapis.com`과 `identitytoolkit.googleapis.com` API가 활성화되어 있는지 확인하고 Firebase Authentication에서 Google 공급자와 `localhost` 승인 도메인을 설정합니다. API 활성화에는 `serviceusage.services.enable` 권한이 필요하므로 일반 개발자가 아니라 프로젝트 관리자가 한 번만 수행합니다.

```bash
gcloud services enable firestore.googleapis.com identitytoolkit.googleapis.com \
  --project=care-atlas-seoul-2026-v3
```

기본 로그인·프로필·돌봄 데이터 흐름과 사용자 ADC에 필요한 최소 사전 정의 역할은 다음과 같습니다.

| 용도 | 필요한 권한 | 최소 사전 정의 역할 |
|---|---|---|
| Firestore 문서 읽기·쓰기 | `datastore.entities.*` 등 데이터 접근 권한 | `roles/datastore.user` |
| Firebase 사용자 조회 | `firebaseauth.users.get` | `roles/firebaseauth.viewer` |
| ADC quota project 사용 | `serviceusage.services.use` | `roles/serviceusage.serviceUsageConsumer` |

`roles/firebase.admin`은 기본 로그인에 필요하지 않습니다. [`projects.accounts.lookup`](https://cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/lookup)은 `firebaseauth.users.get`만 요구하며, [Firebase Authentication Viewer](https://cloud.google.com/iam/docs/roles-permissions/firebaseauth) 역할에 이 권한이 포함됩니다. [Cloud Datastore User](https://cloud.google.com/firestore/native/docs/security/iam#roles)는 Firestore 데이터 읽기·쓰기를 위한 역할입니다. 사용자 ADC에 quota project를 기록하고 사용하는 경우에는 [공식 quota project 안내](https://cloud.google.com/docs/quotas/set-quota-project)에 따라 `serviceusage.services.use`도 필요합니다.

관리자가 전용 개발 서비스 계정에 역할을 부여하는 예시는 다음과 같습니다. `<DEV_SERVICE_ACCOUNT>`와 승인할 주체는 조직 정책에 맞게 바꿉니다.

```bash
gcloud projects add-iam-policy-binding care-atlas-seoul-2026-v3 \
  --member="serviceAccount:<DEV_SERVICE_ACCOUNT>" \
  --role="roles/datastore.user"
gcloud projects add-iam-policy-binding care-atlas-seoul-2026-v3 \
  --member="serviceAccount:<DEV_SERVICE_ACCOUNT>" \
  --role="roles/firebaseauth.viewer"
gcloud projects add-iam-policy-binding care-atlas-seoul-2026-v3 \
  --member="serviceAccount:<DEV_SERVICE_ACCOUNT>" \
  --role="roles/serviceusage.serviceUsageConsumer"
```

개발자는 조직에서 승인한 ADC 방식으로 해당 주체를 사용합니다. 사용자 ADC를 직접 쓰는 경우에는 위 역할을 그 사용자에게 부여합니다.

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project care-atlas-seoul-2026-v3
gcloud auth application-default print-access-token >/dev/null
```

계정 비활성화·토큰 폐기·Firebase 사용자 삭제까지 검증하려면 각각 `firebaseauth.users.update` 또는 `firebaseauth.users.delete`가 추가로 필요합니다. 이 권한은 기본 로그인 범위가 아니므로 별도 전용 주체와 커스텀 역할을 사용하고, 일반 협업자에게 Firebase Admin 역할을 일괄 부여하지 않습니다.

## 오류 확인

| 표시 또는 로그 | 확인할 항목 |
|---|---|
| `auth/unauthorized-domain` | Firebase Authentication 승인된 도메인에 현재 호스트가 있는지 확인 |
| `auth/configuration-not-found` | Authentication 초기화와 Google 공급자 활성화 확인 |
| `firebase_local_emulator_unavailable` | 루트에서 `npm run dev:local`을 다시 실행하고 8181·9199 포트 확인 |
| `firebase_server_permission` | 브라우저 계정이 아니라 ADC 실행 주체에 위 최소 역할과 quota project 권한이 있는지 확인 |

서버는 Firebase 권한 또는 ADC 오류를 503으로 구분하고, 브라우저 계정과 서버 실행 계정이 다르다는 조치 문구를 로그에 남깁니다. 원본 토큰과 사용자 식별자는 로그에 남기지 않습니다.
