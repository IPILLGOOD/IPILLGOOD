import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
function worker() {
  const events = new Map();
  const state = { status: 204, displayed: [], opened: [], requests: [] };
  const context = vm.createContext({
    URL, AbortSignal, Date,
    fetch: async (url, options) => {
      state.requests.push({ url, options });
      if (state.offline) throw new Error("offline");
      return new Response(null, { status: state.status });
    },
    self: {
      location: { origin: "https://ipillgood.test" },
      addEventListener: (name, fn) => events.set(name, fn),
      registration: { showNotification: async (title, options) => state.displayed.push({ title, options }) },
      clients: { matchAll: async () => [], openWindow: async (url) => state.opened.push(url) },
    },
  });
  vm.runInContext(source, context);
  state.emit = async (name, value) => {
    let work;
    events.get(name)({ ...value, waitUntil: (promise) => { work = promise; } });
    await work;
  };
  return state;
}
const payload = { title: "synthetic reminder", body: "synthetic body", data: { subscriptionId: "a".repeat(48), bindingId: "synthetic-binding", deliveryId: "b".repeat(48), url: "/today" } };

test("worker authorizes current account before showing a notification or recording its display", async () => {
  const w = worker();
  await w.emit("push", { data: { json: () => payload } });
  assert.equal(w.displayed.length, 1);
  assert.deepEqual(w.requests.map((r) => r.url), ["/api/push/authorize", "/api/push/receipts"]);
  assert.equal(w.requests[0].options.cache, "no-store");
  assert.equal(w.requests[0].options.credentials, "same-origin");
});

test("logout, account switch, missing binding and network/storage failure never display queued health notifications", async () => {
  for (const status of [401, 403, 500, 503]) {
    const w = worker();
    w.status = status;
    await w.emit("push", { data: { json: () => payload } });
    assert.equal(w.displayed.length, 0);
    assert.equal(w.requests.length, 1);
  }
  const offline = worker();
  offline.offline = true;
  await offline.emit("push", { data: { json: () => payload } });
  assert.equal(offline.displayed.length, 0);
  const legacy = worker();
  await legacy.emit("push", { data: { json: () => ({ title: "old", data: {} }) } });
  assert.equal(legacy.displayed.length, 0);
  assert.equal(legacy.requests.length, 0);
});

test("an old notification click closes it but cannot open the previous account or record a new account's receipt", async () => {
  const w = worker();
  let closed = false;
  w.status = 403;
  await w.emit("notificationclick", { notification: { data: payload.data, close: () => { closed = true; } } });
  assert.equal(closed, true);
  assert.equal(w.opened.length, 0);
  assert.deepEqual(w.requests.map((r) => r.url), ["/api/push/authorize"]);
});
