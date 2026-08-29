import assert from "node:assert/strict";
import test from "node:test";
import { createFirebaseAccountAdmin } from "./firebase-account-admin.ts";

test("account admin targets only the server UID and revokes refresh tokens while disabling", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const auth = createFirebaseAccountAdmin({ projectId: "project", accessToken: async () => "test-only", fetcher: async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({});
  } });
  await auth.disable("uid-a");
  await auth.delete("uid-a");
  assert.equal(calls[0]?.body.localId, "uid-a");
  assert.equal(calls[0]?.body.disableUser, true);
  assert.ok(Number(calls[0]?.body.validSince) > 0);
  assert.deepEqual(calls[1]?.body, { localId: "uid-a" });
  assert.equal(calls[1]?.url, "https://identitytoolkit.googleapis.com/v1/projects/project/accounts:delete");
});

test("only USER_NOT_FOUND is idempotent; permission or transport failures are not completion", async () => {
  for (const code of ["USER_NOT_FOUND", "PERMISSION_DENIED", "INTERNAL_ERROR"]) {
    const auth = createFirebaseAccountAdmin({ projectId: "project", accessToken: async () => "test-only", fetcher: async () => Response.json({ error: { message: code } }, { status: 400 }) });
    if (code === "USER_NOT_FOUND") { await auth.disable("uid-a"); await auth.delete("uid-a"); }
    else { await assert.rejects(auth.disable("uid-a")); await assert.rejects(auth.delete("uid-a")); }
  }
  assert.throws(() => createFirebaseAccountAdmin({ projectId: "production", emulatorHost: "127.0.0.1:9099", accessToken: async () => "owner" }));
});

test("soft-deletion revocation leaves Firebase enabled for a fresh recovery login", async () => {
  let body: Record<string, unknown> = {};
  const auth = createFirebaseAccountAdmin({ projectId: "project", accessToken: async () => "synthetic", fetcher: async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({});
  } });
  await auth.revoke("uid-a");
  assert.equal(body.localId, "uid-a");
  assert.equal(body.disableUser, undefined);
  assert.ok(Number(body.validSince) > 0);
});

test("local ADC quota project is forwarded to Identity Toolkit", async () => {
  let headers = new Headers();
  const auth = createFirebaseAccountAdmin({
    projectId: "resource-project",
    quotaProjectId: "quota-project",
    accessToken: async () => "synthetic",
    fetcher: async (_url, init) => {
      headers = new Headers(init?.headers);
      return Response.json({});
    },
  });

  await auth.lookup("uid-a");
  assert.equal(headers.get("x-goog-user-project"), "quota-project");
});
