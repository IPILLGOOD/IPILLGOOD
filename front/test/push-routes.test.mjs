import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, beforeEach, test } from "node:test";
import { MemoryFirestore } from "../../backend/test-support/memory-firestore.ts";

const root = new URL("../src/", import.meta.url);
const repo = new URL("../../backend/src/push-repository.ts", import.meta.url).href;
const fixtureUrl = `data:text/javascript,${encodeURIComponent(`
  import * as repository from ${JSON.stringify(repo)};
  export const jar = new Map();
  export const cookieStore = {
    get: (key) => jar.has(key) ? { value: jar.get(key) } : undefined,
    set: (key, value) => jar.set(key, value), delete: (key) => jar.delete(key),
  };
  export const cookies = async () => cookieStore;
  let firestore;
  export function useDatabase(value) { firestore = value; }
  export const activatePushSubscription = (input) => repository.activatePushSubscription({ ...input, firestore });
  export const authorizePushDisplay = (input) => repository.authorizePushDisplay({ ...input, firestore });
  export const registerPushSubscription = (input) => repository.registerPushSubscription({ ...input, firestore });
  export const deactivatePushSubscription = (input) => repository.deactivatePushSubscription({ ...input, firestore });
  export const getPushDeviceHealth = (input) => repository.getPushDeviceHealth({ ...input, firestore });
  export const getCareSnapshot = async () => ({ medications: [] });
  export const getNotificationScheduleStatus = async () => { throw new Error("STATUS_READ_UNAVAILABLE"); };
  export const getAccountSessionState = async () => ({ active: true });
  export const isEphemeralDemoSessionId = () => true;
  export const isServiceCareProfileComplete = async () => true;
  export const isEphemeralDemoSessionActive = async () => true;
  export const deleteEphemeralDemoSession = async () => {};
  export const validateCareConnectionSession = async () => ({ connectedUserId: "connected-a", ownerUserId: "owner-a" });
  export const MAX_SESSION_SECONDS = 604800;
  export const CONNECTED_SESSION_DURATION_SECONDS = 86400;
`)}`;
const empty = "data:text/javascript,export default {}";
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: empty, shortCircuit: true };
    if (specifier === "@care-atlas/backend" || specifier === "next/headers") return { url: fixtureUrl, shortCircuit: true };
    if (specifier === "next/server" || specifier === "next/navigation") return next(`${specifier}.js`, context);
    if (specifier.startsWith("@/")) return { url: new URL(`${specifier.slice(2)}.ts`, root).href, shortCircuit: true };
    if (specifier.startsWith(".") && context.parentURL?.startsWith(root.href) && !specifier.endsWith(".ts")) {
      return { url: new URL(`${specifier}.ts`, context.parentURL).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const fixture = await import(fixtureUrl);
const session = await import("../src/lib/auth/session.ts");
const binding = await import("../src/lib/push/server-binding.ts");
const subscriptions = await import("../src/app/api/push/subscriptions/route.ts");
const logout = await import("../src/app/api/auth/logout/route.ts");
const cleanup = await import("../src/app/api/push/cleanup/route.ts");
const authorize = await import("../src/app/api/push/authorize/route.ts");
hooks.deregister();
const oldSecret = process.env.SESSION_SECRET;
process.env.SESSION_SECRET = "test-only-73:3e8a97041bc254f9dba06c8f22a10ed6";
after(() => { if (oldSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = oldSecret; });
let firestore;
beforeEach(async () => {
  firestore = new MemoryFirestore();
  fixture.useDatabase(firestore);
  fixture.jar.clear();
  await session.createSession({ id: "user-a", name: "Synthetic", provider: "google" });
});
const payload = {
  deviceId: "synthetic-device-0001", platform: "android", browser: "chrome", userAgent: "synthetic", timeZone: "Asia/Seoul",
  subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/synthetic", keys: { auth: "a".repeat(16), p256dh: "b".repeat(65) } },
};
async function request(path, method, data = {}, key) {
  return new Request(`https://ipillgood.test${path}`, { method, headers: {
    origin: "https://ipillgood.test", "content-type": "application/json", "x-push-session": key ?? await binding.getPushSessionKey(),
  }, body: JSON.stringify(data) });
}
async function prepare() {
  const response = await subscriptions.POST(await request("/api/push/subscriptions", "POST", payload));
  assert.equal(response.status, 200);
  return (await response.json()).bindingId;
}
async function activate(bindingId) {
  return subscriptions.PATCH(await request("/api/push/subscriptions", "PATCH", { bindingId }));
}

test("prepare cannot send; confirmation needs the delivered cookie and returns committed status without another status read", async () => {
  const id = await prepare();
  const row = [...firestore.values.values()].find((value) => value.deviceId);
  assert.equal(row.active, false);
  const cookie = fixture.jar.get(binding.PUSH_BINDING_COOKIE);
  fixture.jar.delete(binding.PUSH_BINDING_COOKIE);
  assert.equal((await activate(id)).status, 409);
  fixture.jar.set(binding.PUSH_BINDING_COOKIE, cookie);
  const response = await activate(id);
  assert.equal(response.status, 200, "the deliberately unavailable post-commit status reader must not be called");
  assert.equal((await response.json()).status.activeSubscriptionCount, 1);
});

test("logout removes the session on storage failure, preserves signed cleanup and retries anonymously", async () => {
  const id = await prepare();
  assert.equal((await activate(id)).status, 200);
  const cookie = fixture.jar.get(binding.PUSH_BINDING_COOKIE);
  firestore.failCommits = 1;
  assert.equal((await logout.POST(await request("/api/auth/logout", "POST"))).status, 303);
  assert.equal(fixture.jar.has(session.SESSION_COOKIE_NAME), false);
  assert.equal(fixture.jar.get(binding.PUSH_BINDING_COOKIE), cookie);
  const record = [...firestore.values.values()].find((value) => value.deviceId);
  assert.equal((await authorize.POST(await request("/api/push/authorize", "POST", { subscriptionId: record.id, bindingId: id }))).status, 403);
  assert.equal((await cleanup.POST(await request("/api/push/cleanup", "POST"))).status, 200);
  assert.equal(fixture.jar.has(binding.PUSH_BINDING_COOKIE), false);
  assert.equal(firestore.values.get(`pushSubscriptions/${record.id}`).active, false);
});

test("account switch rejects an in-flight old registration and display without automatically enrolling the new account", async () => {
  const oldKey = await binding.getPushSessionKey();
  const id = await prepare();
  assert.equal((await activate(id)).status, 200);
  await session.createSession({ id: "user-b", name: "Synthetic B", provider: "google" });
  const before = structuredClone(firestore.store);
  assert.equal((await subscriptions.POST(await request("/api/push/subscriptions", "POST", payload, oldKey))).status, 409);
  assert.equal((await activate(id)).status, 409);
  assert.deepEqual(firestore.store, before);
  const response = await cleanup.POST(await request("/api/push/cleanup", "POST"));
  assert.equal((await response.json()).cleaned, true);
  assert.ok([...firestore.values.values()].filter((row) => row.deviceId).every((row) => !row.active));
});

test("a tampered cleanup cookie cannot revoke a subscription or authorize display", async () => {
  const id = await prepare();
  await activate(id);
  const cookie = fixture.jar.get(binding.PUSH_BINDING_COOKIE);
  fixture.jar.set(binding.PUSH_BINDING_COOKIE, `X${cookie.slice(1)}`);
  const before = structuredClone(firestore.store);
  assert.equal(await binding.readPushBinding(), null);
  await cleanup.POST(await request("/api/push/cleanup", "POST"));
  assert.deepEqual(firestore.store, before);
});

test("fresh logins get distinct push identities, while a connected session refresh preserves its identity", async () => {
  const first = await binding.getPushSessionKey();
  await session.createSession({ id: "user-a", name: "Synthetic", provider: "google" });
  assert.notEqual(await binding.getPushSessionKey(), first);
  await session.createSession({ id: "connected-a", name: "Synthetic", provider: "connected", recipientId: "recipient-a", ownerUserId: "owner-a", connectionId: "connection-a", sessionVersion: "version-a" }, { durationSeconds: 86400 });
  const connectedKey = await binding.getPushSessionKey();
  const user = await session.getSession();
  assert.ok(user);
  await session.refreshConnectedSession(user);
  assert.equal(await binding.getPushSessionKey(), connectedKey);
});

test("cross-origin logout cannot remove login or push binding", async () => {
  await prepare();
  const before = new Map(fixture.jar);
  const response = await logout.POST(new Request("https://ipillgood.test/api/auth/logout", { method: "POST", headers: { origin: "https://attacker.test" } }));
  assert.equal(response.status, 403);
  assert.deepEqual(fixture.jar, before);
});
