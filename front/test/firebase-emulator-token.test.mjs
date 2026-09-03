import assert from "node:assert/strict";
import test from "node:test";

import { verifyFirebaseEmulatorGoogleIdToken } from "../src/lib/auth/firebase-emulator-token.ts";

const now = 2_000_000_000_000;
const projectId = "demo-ipillgood-local";
const user = {
  sub: "local-google-user",
  email: "caregiver@example.test",
  email_verified: true,
  name: "로컬 보호자",
  auth_time: now / 1_000,
  iat: now / 1_000,
  exp: now / 1_000 + 3_600,
  iss: `https://securetoken.google.com/${projectId}`,
  aud: projectId,
  firebase: { sign_in_provider: "google.com" },
};

function token(payload = user, algorithm = "none") {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: algorithm, typ: "JWT" })}.${encode(payload)}.`;
}

const environment = {
  authHost: "127.0.0.1:9199",
  firestoreHost: "127.0.0.1:8181",
  nodeEnv: "development",
  now: () => now,
  projectId,
};

function accountResponse() {
  return Response.json({
    users: [{
      localId: user.sub,
      email: user.email,
      emailVerified: true,
      providerUserInfo: [{ providerId: "google.com" }],
    }],
  });
}

test("Auth emulator가 확인한 unsigned Google 토큰만 로컬 경로에서 허용한다", async () => {
  const claims = await verifyFirebaseEmulatorGoogleIdToken(token(), {
    ...environment,
    fetcher: async (url, init) => {
      assert.equal(url, "http://127.0.0.1:9199/identitytoolkit.googleapis.com/v1/accounts:lookup?key=demo-local");
      assert.deepEqual(JSON.parse(String(init?.body)), { idToken: token() });
      return accountResponse();
    },
  });
  assert.equal(claims.sub, user.sub);
});

test("서명 토큰, 잘못된 audience, 운영 환경과 계정 불일치를 거부한다", async () => {
  await assert.rejects(() => verifyFirebaseEmulatorGoogleIdToken(token(user, "RS256"), { ...environment, fetcher: async () => accountResponse() }));
  await assert.rejects(() => verifyFirebaseEmulatorGoogleIdToken(token({ ...user, aud: "production" }), { ...environment, fetcher: async () => accountResponse() }));
  await assert.rejects(() => verifyFirebaseEmulatorGoogleIdToken(token(), { ...environment, nodeEnv: "production", fetcher: async () => accountResponse() }));
  await assert.rejects(() => verifyFirebaseEmulatorGoogleIdToken(token(), { ...environment, fetcher: async () => Response.json({ users: [] }) }));
});
