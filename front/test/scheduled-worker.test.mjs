import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, test } from "node:test";

// Exercise the real scheduled entrypoint without loading a generated app or any live binding.
const workerUrl = new URL("../custom-worker.ts", import.meta.url).href;
const fixtureUrl = `data:text/javascript,${encodeURIComponent(`
  export const calls = [];
  export const outcomes = [];
  export default { async fetch(request, env, context) {
    calls.push({ request, env, context });
    const outcome = outcomes.shift();
    if (outcome instanceof Error) throw outcome;
    return new Response("synthetic", { status: outcome ?? 200 });
  }};
  export class DOQueueHandler {}
  export class DOShardedTagCache {}
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === workerUrl && specifier === "./.open-next/worker.js") {
      return { url: fixtureUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
let worker;
let fixture;
try {
  ({ default: worker } = await import(workerUrl));
  fixture = await import(fixtureUrl);
} finally {
  hooks.deregister();
}

const paths = ["/api/account/deletion/cleanup", "/api/demo/cleanup", "/api/auth/connection/cleanup", "/api/push/dispatch"];
const environment = { PUSH_CRON_SECRET: "synthetic-scheduled-worker-secret-20260828" };
const context = { waitUntil() {} };
beforeEach(() => {
  fixture.calls.length = 0;
  fixture.outcomes.length = 0;
});

test("scheduled worker rejects absent or short credentials before any cleanup", async () => {
  for (const secret of [undefined, "", "x".repeat(31)]) {
    await assert.rejects(worker.scheduled({}, { PUSH_CRON_SECRET: secret }, context), /not configured/);
  }
  assert.equal(fixture.calls.length, 0);
});

test("scheduled worker invokes withdrawal cleanup first and authenticates all routes", async () => {
  await worker.scheduled({}, environment, context);
  assert.deepEqual(fixture.calls.map(({ request }) => new URL(request.url).pathname), paths);
  for (const call of fixture.calls) {
    assert.equal(new URL(call.request.url).origin, "https://ipillgood.internal");
    assert.equal(call.request.method, "POST");
    assert.equal(call.request.headers.get("x-ipillgood-cron-secret"), environment.PUSH_CRON_SECRET);
    assert.equal(call.env, environment);
    assert.equal(call.context, context);
  }
});

test("one failed cleanup does not skip other scheduled routes and fails the invocation", async () => {
  fixture.outcomes.push(503, 200, 200, 500);
  await assert.rejects(worker.scheduled({}, environment, context), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    assert.match(error.errors[0].message, /account\/deletion\/cleanup failed: HTTP 503/);
    assert.match(error.errors[1].message, /push\/dispatch failed: HTTP 500/);
    return true;
  });
  assert.equal(fixture.calls.length, 4);
});

test("a transient scheduled exception is retried by the next invocation", async () => {
  fixture.outcomes.push(new Error("synthetic transient failure"), 200, 200, 200);
  await assert.rejects(worker.scheduled({}, environment, context), AggregateError);
  await worker.scheduled({}, environment, context);
  assert.deepEqual(fixture.calls.map(({ request }) => new URL(request.url).pathname), [...paths, ...paths]);
});

test("the scheduled wrapper preserves the app fetch handler", async () => {
  assert.equal(worker.fetch, fixture.default.fetch);
  const request = new Request("https://ipillgood.invalid/login");
  assert.equal((await worker.fetch(request, environment, context)).status, 200);
  assert.equal(fixture.calls[0].request, request);
});
