import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, beforeEach, test } from "node:test";

const fixtureUrl = `data:text/javascript,${encodeURIComponent(`
  export const state = { session: null, complete: true, allowed: true, calls: [], policies: [], failure: false, delayMs: 0 };
  export const getSession = async () => state.session;
  export const careScopeFor = () => ({ recipientId: 'synthetic-owner' });
  export const isServiceCareProfileComplete = async () => state.complete;
  export const getCareSnapshot = async () => ({ recipient: { confirmedConditions: [{ id: 'confirmed', standardName: '고혈압', code: 'I10' }] }, medications: [{ ingredientName: 'private-medication' }] });
  export const enforceRateLimit = async (policy) => { state.policies.push(policy); return { allowed: state.allowed }; };
  export const rateLimitResponse = () => Response.json({}, { status: 429 });
  export const unstable_cache = (fn) => fn;
  export const searchNutritionResources = async (...args) => { state.calls.push(args); if (state.delayMs) await new Promise((resolve) => setTimeout(resolve, state.delayMs)); if (state.failure && typeof state.failure === "object") throw state.failure; if (state.failure) throw new Error('secret upstream details'); return { articles: [], retrievedAt: '2026-09-09T00:00:00Z' }; };
`)}`;
const root = new URL("../src/", import.meta.url);
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (["@care-atlas/backend", "@care-atlas/backend/ai/nutrition-exploration", "@/lib/auth/session", "@/lib/auth/care-scope", "@/lib/rate-limit", "@/lib/rate-limit-core", "next/cache"].includes(specifier)) return { url: fixtureUrl, shortCircuit: true };
  if (specifier.startsWith("@/")) return { url: new URL(`${specifier.slice(2)}.ts`, root).href, shortCircuit: true };
  return next(specifier, context);
} });
const { POST } = await import("../src/app/api/nutrition/explore/route.ts");
const { state } = await import(fixtureUrl);
hooks.deregister();
const previousKey = process.env.OPENAI_API_KEY;
beforeEach(() => { Object.assign(state, { session: { id: 'synthetic' }, complete: true, allowed: true, calls: [], policies: [], failure: false, delayMs: 0 }); process.env.OPENAI_API_KEY = 'synthetic-test-key'; });
after(() => { if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey; });
const request = (body = { conditionId: 'confirmed' }, origin = 'https://ipillgood.test') => new Request('https://ipillgood.test/api/nutrition/explore', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('rejects cross-origin, anonymous and unconfirmed-condition searches', async () => {
  assert.equal((await POST(request(undefined, 'https://other.test'))).status, 403);
  state.session = null;
  assert.equal((await POST(request())).status, 401);
  state.session = { id: 'synthetic' };
  assert.equal((await POST(request({ conditionId: 'another-person' }))).status, 403);
  assert.deepEqual(state.calls, []);
});
test('consent, rate limits, malformed requests and missing provider prevent search', async () => {
  state.complete = false;
  assert.equal((await POST(request())).status, 403);
  state.complete = true; state.allowed = false;
  assert.equal((await POST(request())).status, 429);
  state.allowed = true;
  assert.equal((await POST(request({ conditionId: 'confirmed', topicId: 'unknown' }))).status, 400);
  delete process.env.OPENAI_API_KEY;
  assert.equal((await POST(request())).status, 503);
  assert.deepEqual(state.calls, []);
});
test('search receives only server resolved condition, never profile or medications', async () => {
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(state.calls, [['고혈압', 'I10']]);
  assert.deepEqual(state.policies, ['nutritionSearch']);
  assert.deepEqual((await response.json()).articles, []);
});
test('upstream failures are retryable and do not disclose provider details', async () => {
  state.failure = true;
  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /secret/);
});

test('concurrent searches for one condition share one provider request', async () => {
  state.delayMs = 20;
  const [first, second] = await Promise.all([POST(request()), POST(request())]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(state.calls, [['고혈압', 'I10']]);
});

test('malformed environment keys return a diagnostic code before any search', async () => {
  process.env.OPENAI_API_KEY = 'sk-proj-OPENAI_API_KEY=sk-proj-synthetic';
  const response = await POST(request());
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, 'key_format');
  assert.ok(!JSON.stringify(body).includes('sk-proj'));
  assert.deepEqual(state.calls, []);
});


test('provider limits return 429 and preserve retry timing and quota guidance', async () => {
  state.failure = { status: 429, code: 'rate_limit_exceeded', headers: new Headers({ 'retry-after': '12' }) };
  const limited = await POST(request());
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '12');
  const limitedBody = await limited.json();
  assert.equal(limitedBody.code, 'provider_rate_limit');
  assert.doesNotMatch(limitedBody.message, /API|토큰|모델|키/);
  state.failure = { status: 429, code: 'insufficient_quota' };
  const quota = await POST(request());
  assert.equal(quota.status, 429);
  assert.equal(quota.headers.get('retry-after'), null);
  assert.equal((await quota.json()).code, 'provider_quota');
});
