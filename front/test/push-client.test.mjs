import assert from "node:assert/strict";
import test from "node:test";
import { inspectPushClient, enablePushNotifications } from "../src/lib/push/client.ts";
import { pushEndpointHash } from "../src/lib/push/key-validation.ts";

const keyBytes = (fill) => Uint8Array.from({ length: 65 }, (_, i) => i === 0 ? 4 : fill);
const oldKey = keyBytes(1);
const newKey = keyBytes(2);
const encoded = (key) => Buffer.from(key).toString("base64url");

function harness(t, options = {}) {
  const state = { key: options.key ?? oldKey, permission: "granted", registered: true, lastHttpStatus: null, configReads: 0, posts: 0, prompts: 0, unsubscribes: 0, creates: 0, requests: [] };
  const subscription = (key, endpoint) => ({
    endpoint, expirationTime: null, options: { applicationServerKey: key?.buffer ?? null },
    getKey: (name) => new Uint8Array(name === "auth" ? 16 : 65).fill(3).buffer,
    unsubscribe: async () => { state.unsubscribes++; if (state.refuseUnsubscribe) return false; state.current = null; return true; },
  });
  state.current = subscription(options.boundKey === undefined ? oldKey : options.boundKey, "https://fcm.googleapis.com/fcm/send/synthetic-old");
  state.serverEndpoint = state.current.endpoint;
  const registration = { pushManager: {
    getSubscription: async () => state.current,
    subscribe: async ({ applicationServerKey }) => {
      state.creates++;
      state.current = subscription(applicationServerKey, `https://fcm.googleapis.com/fcm/send/synthetic-${state.creates}`);
      state.afterCreate?.();
      return state.current;
    },
  } };
  const storage = new Map([["ipillgood:push-device-id", "synthetic-device-00001"]]);
  const notification = { get permission() { return state.permission; }, requestPermission: async () => { state.prompts++; return state.permission; } };
  for (const [name, value] of Object.entries({
    navigator: { userAgent: "Mozilla/5.0 Android Chrome/120.0", serviceWorker: { ready: Promise.resolve(registration) } },
    window: { PushManager: {}, Notification: notification, matchMedia: () => ({ matches: true }), localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } },
    Notification: notification,
    fetch: async (url, init = {}) => {
      state.requests.push({ url, method: init.method ?? "GET", cache: init.cache });
      init.signal?.throwIfAborted();
      if (url === "/api/push/config") {
        state.configReads++;
        if (state.configFailure) return Response.json({}, { status: 500 });
        return Response.json({ configured: true, publicKey: encoded(state.key) });
      }
      if (init.method === "POST") {
        state.posts++;
        if (state.failUpload) return Response.json({}, { status: 500 });
        state.serverEndpoint = JSON.parse(init.body).subscription.endpoint;
        state.registered = true;
        state.lastHttpStatus = null;
        return Response.json({ status: { activeSubscriptionCount: 1, activeScheduleCount: 1, nextReminderAt: null } });
      }
      return Response.json({ subscribed: state.registered, endpointHash: await pushEndpointHash(state.serverEndpoint), lastHttpStatus: state.lastHttpStatus, status: { activeSubscriptionCount: 1, activeScheduleCount: 1, nextReminderAt: null } });
    },
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; });
  }
  return state;
}

test("inspection reads fresh configuration every time without prompting, registering or unsubscribing", async (t) => {
  const state = harness(t);
  assert.equal((await inspectPushClient()).subscribed, true);
  state.key = newKey;
  const changed = await inspectPushClient();
  assert.equal(changed.keyStatus, "mismatch");
  assert.equal(changed.subscribed, false);
  assert.equal(state.configReads, 2);
  assert.equal(state.posts + state.prompts + state.unsubscribes, 0);
  assert.ok(state.requests.every((request) => request.method === "GET" && request.cache === "no-store"));
});

test("explicit recovery fetches current key and replaces only a mismatching subscription", async (t) => {
  const state = harness(t, { key: newKey });
  await enablePushNotifications();
  assert.equal(state.unsubscribes, 1);
  assert.equal(state.creates, 1);
  assert.equal(state.posts, 1);
  assert.equal((await inspectPushClient()).subscribed, true);
  await enablePushNotifications();
  assert.equal(state.unsubscribes, 1);
  assert.equal(state.creates, 1);
});

test("failed upload never mistakes an old server endpoint for the new browser subscription", async (t) => {
  const state = harness(t, { key: newKey });
  state.failUpload = true;
  await assert.rejects(enablePushNotifications(), /등록/);
  assert.equal((await inspectPushClient()).subscribed, false);
  state.failUpload = false;
  await enablePushNotifications();
  assert.equal((await inspectPushClient()).subscribed, true);
  assert.equal(state.creates, 1);
});

test("new account does not inherit the browser subscription without opt-in", async (t) => {
  const state = harness(t);
  state.registered = false;
  assert.equal((await inspectPushClient()).subscribed, false);
  assert.equal(state.posts + state.prompts, 0);
});

test("401/403 delivery failures are possible server auth problems, not proof of key mismatch", async (t) => {
  const state = harness(t);
  for (const status of [401, 403]) {
    state.lastHttpStatus = status;
    const result = await inspectPushClient();
    assert.equal(result.keyStatus, "matched");
    assert.equal(result.deliveryAuthRejected, true);
    assert.equal(result.subscribed, false);
  }
  assert.equal(state.unsubscribes, 0);
});

test("expired and denied subscriptions are never shown as healthy", async (t) => {
  const state = harness(t);
  state.current.expirationTime = Date.now() - 1000;
  assert.equal((await inspectPushClient()).expired, true);
  assert.equal((await inspectPushClient()).subscribed, false);
  state.current.expirationTime = null;
  state.permission = "denied";
  assert.equal((await inspectPushClient()).subscribed, false);
});

test("missing applicationServerKey is disclosed without automatically discarding a working subscription", async (t) => {
  const state = harness(t, { boundKey: null });
  assert.equal((await inspectPushClient()).keyStatus, "unverifiable");
  assert.equal(state.unsubscribes + state.posts, 0);
});

test("failed unsubscribe or configuration cannot trigger replacement/upload", async (t) => {
  const state = harness(t, { key: newKey });
  state.refuseUnsubscribe = true;
  await assert.rejects(enablePushNotifications(), /해제/);
  assert.equal(state.creates + state.posts, 0);
  state.configFailure = true;
  await assert.rejects(inspectPushClient(), /설정/);
});

test("account change while browser registration is pending aborts server upload", async (t) => {
  const state = harness(t, { key: newKey });
  const controller = new AbortController();
  state.afterCreate = () => controller.abort();
  await assert.rejects(enablePushNotifications(controller.signal), { name: "AbortError" });
  assert.equal(state.posts, 0);
});

test("unsupported browser without Notification does not throw or mutate", async (t) => {
  const state = harness(t);
  delete window.Notification;
  delete window.PushManager;
  const result = await inspectPushClient();
  assert.equal(result.supported, false);
  assert.equal(result.subscribed, false);
  assert.equal(state.posts + state.prompts, 0);
});
