import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/lib/auth/") && specifier.startsWith("./") && !specifier.endsWith(".ts")) {
    return next(`${specifier}.ts`, context);
  }
  return next(specifier, context);
} });
const { createGoogleServerSession } = await import("../src/lib/auth/google-auth-browser.ts");
hooks.deregister();

function browser(t) {
  const destinations = [];
  t.mock.method(globalThis, "fetch", async () => Response.json({ redirectTo: "/today" }));
  const original = globalThis.window;
  globalThis.window = {
    localStorage: { removeItem() {} },
    location: { search: "", replace: url => destinations.push(url) },
  };
  t.after(() => { globalThis.window = original; });
  return destinations;
}
const user = { getIdToken: async () => "synthetic-test-token" };
const authModule = { signOut: async () => {} };

test("failed session can be retried successfully", async t => {
  const destinations = browser(t);
  fetch.mock.mockImplementationOnce(async () => Response.json({ error: "google_login_failed" }, { status: 503 }));
  await assert.rejects(createGoogleServerSession(user, {}, authModule, new AbortController().signal), { code: "server/google_login_failed" });
  assert.deepEqual(destinations, []);
  await createGoogleServerSession(user, {}, authModule, new AbortController().signal);
  assert.deepEqual(destinations, ["/today"]);
});

test("token timeout prevents a late token from sending a stale session request", async t => {
  const destinations = browser(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolveToken;
  const pending = createGoogleServerSession({ getIdToken: () => new Promise(resolve => { resolveToken = resolve; }) }, {}, authModule, new AbortController().signal);
  const rejected = assert.rejects(pending, { code: "server/session_timeout" });
  t.mock.timers.tick(15_000);
  await rejected;
  resolveToken("late-test-token");
  await Promise.resolve();
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(destinations, []);
});

test("response body timeout aborts the HTTP request", async t => {
  const destinations = browser(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requestSignal;
  fetch.mock.mockImplementation(async (_url, options) => {
    requestSignal = options.signal;
    return { ok: true, json: () => new Promise(() => {}) };
  });
  const pending = createGoogleServerSession(user, {}, authModule, new AbortController().signal);
  const rejected = assert.rejects(pending, { code: "server/session_timeout" });
  await Promise.resolve();
  t.mock.timers.tick(15_000);
  await rejected;
  assert.equal(requestSignal.aborted, true);
  assert.deepEqual(destinations, []);
});

test("cancelled attempt cannot navigate after a late successful response", async t => {
  const destinations = browser(t);
  const controller = new AbortController();
  fetch.mock.mockImplementation(async () => {
    controller.abort();
    return Response.json({ redirectTo: "/today" });
  });
  await assert.rejects(createGoogleServerSession(user, {}, authModule, controller.signal), { name: "AbortError" });
  assert.deepEqual(destinations, []);
});
