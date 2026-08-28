import assert from "node:assert/strict";

const baseUrl = process.env.IPILLGOOD_BASE_URL ?? "http://127.0.0.1:3000";
const commonHeaderNames = [
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "strict-transport-security",
];

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/login`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // 서버가 시작되는 동안 재시도합니다.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`보안 헤더 QA 서버가 시작되지 않았습니다: ${baseUrl}`);
}

function assertCommonHeaders(response, path) {
  for (const name of commonHeaderNames) {
    assert.ok(response.headers.get(name), `${path}: ${name} 누락`);
  }
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}

await waitForServer();

for (const [path, status] of [["/", 200], ["/login", 200], ["/today", 307], ["/404", 404]]) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    headers: path === "/today" ? { cookie: "care_atlas_session=invalid" } : undefined,
  });
  assert.equal(response.status, status, `${path}: unexpected response status`);
  assertCommonHeaders(response, path);
  const policy = response.headers.get("content-security-policy");
  assert.ok(policy, `${path}: Content-Security-Policy 누락`);
  assert.match(policy, /script-src[^;]+'nonce-[^']+'/);
  assert.match(policy, /style-src-attr 'unsafe-inline'/);
  assert.doesNotMatch(
    policy,
    /script-src[^;]+'unsafe-inline'|style-src [^;]*'unsafe-inline'|api\.openai\.com|apis\.data\.go\.kr/,
  );
  if (path === "/404") {
    assert.equal(response.headers.get("location"), null, "/404 must not redirect to itself");
    assert.match(await response.text(), /페이지를 찾을 수 없어요/);
  }
}

const missingResponse = await fetch(`${baseUrl}/missing-response-qa/nested`, { redirect: "manual" });
assert.equal(missingResponse.status, 307);
assert.equal(missingResponse.headers.get("location"), "/404");
assertCommonHeaders(missingResponse, "missing page redirect");

const apiResponse = await fetch(`${baseUrl}/api/push/config`, { redirect: "manual" });
assertCommonHeaders(apiResponse, "/api/push/config");
assert.match(apiResponse.headers.get("content-security-policy") ?? "", /default-src 'none'/);

const serviceWorkerResponse = await fetch(`${baseUrl}/sw.js`, { redirect: "manual" });
assertCommonHeaders(serviceWorkerResponse, "/sw.js");
assert.match(serviceWorkerResponse.headers.get("content-type") ?? "", /javascript/);
assert.match(serviceWorkerResponse.headers.get("content-security-policy") ?? "", /connect-src 'self'/);

console.log("Response QA passed for /, /login, /today, canonical 404, missing-page redirect, API, and /sw.js");
