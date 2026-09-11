import assert from "node:assert/strict";
import test from "node:test";
import { APIConnectionError, APIConnectionTimeoutError } from "openai";
import { nutritionSearchFailure, requireNutritionApiKey, NutritionSearchError } from "./nutrition-search-errors.ts";

test("malformed pasted keys fail before a provider request, without exposing their value", () => {
  for (const key of ["sk-proj-OPENAI_API_KEY=sk-proj-synthetic", "sk-one-sk-two", " key "]) {
    assert.throws(() => requireNutritionApiKey(key), (error) => {
      assert.ok(error instanceof NutritionSearchError);
      assert.equal(error.reason, "key_format");
      assert.ok(!error.message.includes(key));
      return true;
    });
  }
  assert.throws(() => requireNutritionApiKey(undefined), /검색을 시작할 수 없어요/);
  assert.equal(requireNutritionApiKey("sk-synthetic-test"), "sk-synthetic-test");
});
test("authentication, invalid requests, quota and SDK network errors are distinguished", () => {
  for (const [error, expected] of [
    [{ status: 401 }, "provider_auth"], [{ status: 400 }, "provider_request"],
    [{ status: 403 }, "provider_permission"], [{ status: 429, code: "insufficient_quota" }, "provider_quota"],
    [{ status: 429, code: "rate_limit_exceeded" }, "provider_rate_limit"],
    [{ status: 429, type: "insufficient_quota" }, "provider_quota"],
    [{ status: 429, code: "credit_balance_exhausted", type: "insufficient_quota" }, "provider_credit"],
    [{ status: 429, code: "project_spend_limit_exceeded" }, "provider_spend_limit"],
    [{ status: 429, code: "organization_usage_limit_exceeded" }, "provider_usage_limit"],
    [{ status: 429, code: "slow_down" }, "provider_rate_limit"],
    [{ status: 429 }, "provider_limit_unknown"],
    [new APIConnectionTimeoutError({}), "provider_timeout"],
    [new APIConnectionError({}), "provider_connection"],
  ] as const) assert.equal(nutritionSearchFailure(error).code, expected);
});
test("temporary limits preserve safe retry timing while quota errors have no automatic retry", () => {
  assert.equal(nutritionSearchFailure({ status: 429, code: "rate_limit_exceeded", headers: new Headers({ "retry-after": "12" }) }).retryAfterSeconds, 12);
  assert.equal(nutritionSearchFailure({ status: 429, headers: new Headers({ "retry-after": "invalid-secret" }) }).retryAfterSeconds, 60);
  assert.equal(nutritionSearchFailure({ status: 429, code: "insufficient_quota" }).retryAfterSeconds, undefined);
  for (const code of ["credit_balance_exhausted", "project_spend_limit_exceeded", "organization_spend_limit_exceeded", "organization_usage_limit_exceeded"]) {
    assert.equal(nutritionSearchFailure({ status: 429, code, headers: new Headers({ "retry-after": "12" }) }).retryAfterSeconds, undefined);
  }
});
test("raw provider details and arbitrary error codes never leave the classifier", () => {
  const result = nutritionSearchFailure({ status: 401, message: "synthetic-secret", code: "synthetic-secret", headers: { authorization: "synthetic-secret" } });
  assert.deepEqual(result, { code: "provider_auth", message: "현재 자료 검색을 시작할 수 없어요. 관리자에게 알려주세요.", upstreamStatus: 401 });
  assert.ok(!JSON.stringify(result).includes("synthetic-secret"));
});

test("rate-limit diagnostics extract only the dimension and safe numbers", () => {
  const result = nutritionSearchFailure({ status: 429, code: "rate_limit_exceeded",
    message: "secret organization: tokens per min (TPM): Limit: 10000, Used: 8000, Requested: 4000. secret prompt",
    headers: new Headers({ "x-ratelimit-limit-tokens": "10000", "x-ratelimit-remaining-tokens": "2000", "x-ratelimit-limit-requests": "secret-header" }) });
  assert.deepEqual(result.rateLimit, { dimension: "tokens", limit: 10000, used: 8000, requested: 4000, tokens_limit: 10000, tokens_remaining: 2000 });
  assert.ok(!JSON.stringify(result).includes("secret"));
  assert.doesNotMatch(result.message, /API|토큰|요청량/);
});
