import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryRateLimitStore,
  RATE_LIMIT_POLICIES,
  clientIpFromHeaders,
  consumeRateLimit,
  rateLimitResponse,
} from "../src/lib/rate-limit-core.ts";

test("Cloudflare 제한에는 사용자와 IP를 조합한 비식별 키만 전달한다", async () => {
  let receivedKey = "";
  const result = await consumeRateLimit(
    "documentAnalysis",
    { ip: "203.0.113.7", userId: "google-sensitive-user" },
    {
      binding: {
        async limit({ key }) {
          receivedKey = key;
          return { success: false };
        },
      },
    },
  );

  assert.equal(result.allowed, false);
  assert.equal(result.source, "cloudflare");
  assert.match(receivedKey, /^[a-f0-9]{64}$/);
  assert.equal(receivedKey.includes("203.0.113.7"), false);
  assert.equal(receivedKey.includes("google-sensitive-user"), false);
});

test("정책별 허용량을 넘으면 막고 다음 창에서 다시 허용한다", async () => {
  const memoryStore = new InMemoryRateLimitStore();
  const identity = { ip: "198.51.100.20", userId: "user-1" };
  const policy = RATE_LIMIT_POLICIES.documentAnalysis;
  const now = Date.UTC(2026, 7, 26, 0, 0, 0);

  for (let request = 0; request < policy.limit; request += 1) {
    const result = await consumeRateLimit("documentAnalysis", identity, { memoryStore, now });
    assert.equal(result.allowed, true);
  }
  const blocked = await consumeRateLimit("documentAnalysis", identity, { memoryStore, now });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 60);

  const nextWindow = await consumeRateLimit("documentAnalysis", identity, {
    memoryStore,
    now: now + 60_000,
  });
  assert.equal(nextWindow.allowed, true);
});

test("서로 다른 기능의 제한 카운터는 간섭하지 않는다", async () => {
  const memoryStore = new InMemoryRateLimitStore();
  const identity = { ip: "198.51.100.21", userId: "user-2" };
  const now = Date.UTC(2026, 7, 26, 0, 0, 0);

  for (let request = 0; request <= RATE_LIMIT_POLICIES.documentAnalysis.limit; request += 1) {
    await consumeRateLimit("documentAnalysis", identity, { memoryStore, now });
  }
  const checkIn = await consumeRateLimit("checkIn", identity, { memoryStore, now });
  assert.equal(checkIn.allowed, true);
});

test("Cloudflare 원본 IP를 우선하고 제한 응답에 429와 재시도 시간을 제공한다", async () => {
  const headers = new Headers({
    "cf-connecting-ip": "203.0.113.8",
    "x-forwarded-for": "198.51.100.30, 198.51.100.31",
  });
  assert.equal(clientIpFromHeaders(headers), "203.0.113.8");

  const response = rateLimitResponse({
    allowed: false,
    limit: 5,
    retryAfterSeconds: 42,
    source: "memory",
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "42");
  assert.equal(response.headers.get("ratelimit-limit"), "5");
});
