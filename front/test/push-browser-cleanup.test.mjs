import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { markPushCleanupPending, observePushCleanup } from "../src/lib/push/browser-cleanup.ts";

function harness(t) {
  const storage = new Map([["ipillgood:push-device-id", "synthetic-device"]]);
  const state = { requests: 0, unsubscribes: 0, submitted: 0, closed: 0, retries: [], refuse: true };
  const document = new EventTarget();
  const window = new EventTarget();
  window.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
  class Form { action = "https://ipillgood.test/api/auth/logout"; submit() { state.submitted++; } }
  for (const [name, value] of Object.entries({
    document, window, HTMLFormElement: Form, location: { origin: "https://ipillgood.test" },
    navigator: { serviceWorker: { getRegistration: async () => ({
      getNotifications: async () => [{ close: () => { state.closed++; } }],
      pushManager: { getSubscription: async () => ({ unsubscribe: async () => { state.unsubscribes++; return !state.refuse; } }) },
    }) } },
    fetch: async () => { state.requests++; return Response.json({ cleaned: false, signedIn: true }); },
    setTimeout: (fn) => { state.retries.push(fn); return state.retries.length; }, clearTimeout: () => {},
  })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => { if (old) Object.defineProperty(globalThis, name, old); else delete globalThis[name]; });
  }
  return { state, storage, document, Form };
}

test("persistent browser unsubscribe failure does not prevent server cleanup and retries on reentry", async (t) => {
  const { state, storage } = harness(t);
  markPushCleanupPending();
  const stop = observePushCleanup();
  await setImmediate();
  assert.equal(state.requests, 1);
  assert.equal(storage.get("ipillgood:push-cleanup-pending"), "true");
  state.refuse = false;
  window.dispatchEvent(new Event("online"));
  await setImmediate();
  stop();
  assert.equal(state.requests, 2);
  assert.equal(storage.has("ipillgood:push-cleanup-pending"), false);
  assert.equal(storage.has("ipillgood:push-device-id"), false);
});

test("logout submits the existing form even when browser unsubscribe fails and preserves retry state", async (t) => {
  const { state, storage, document, Form } = harness(t);
  const stop = observePushCleanup();
  await setImmediate();
  const event = new Event("submit", { cancelable: true });
  Object.defineProperty(event, "target", { value: new Form() });
  document.dispatchEvent(event);
  await setImmediate();
  stop();
  assert.equal(event.defaultPrevented, true);
  assert.equal(state.submitted, 1);
  assert.equal(state.closed, 1);
  assert.equal(storage.get("ipillgood:push-cleanup-pending"), "true");
});
