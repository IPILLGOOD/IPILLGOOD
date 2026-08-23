import assert from "node:assert/strict";
import test from "node:test";

import {
  getVapidConfiguration,
  sendWebPush,
  type BrowserPushSubscription,
} from "./web-push.ts";

function base64Url(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return Buffer.from(bytes).toString("base64url");
}

async function fixtures() {
  const vapidPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", vapidPair.privateKey);
  const vapidPublic = await crypto.subtle.exportKey("raw", vapidPair.publicKey);
  const clientPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const clientPublic = await crypto.subtle.exportKey("raw", clientPair.publicKey);
  const subscription: BrowserPushSubscription = {
    endpoint: "https://push.example.test/send/subscription-id",
    keys: {
      p256dh: base64Url(clientPublic),
      auth: base64Url(crypto.getRandomValues(new Uint8Array(16))),
    },
  };
  const vapid = getVapidConfiguration({
    VAPID_PUBLIC_KEY: base64Url(vapidPublic),
    VAPID_PRIVATE_KEY: privateJwk.d,
    VAPID_SUBJECT: "mailto:push@example.com",
  });
  assert.ok(vapid);
  return { subscription, vapid };
}

test("VAPID 공개키를 브라우저 구독용 형식으로 검증한다", async () => {
  const { vapid } = await fixtures();
  assert.equal(Buffer.from(vapid.publicKey, "base64url").byteLength, 65);
  assert.equal(Buffer.from(vapid.publicKey, "base64url")[0], 4);
});

test("표준 aes128gcm Web Push 요청을 만들고 푸시 서비스 접수를 확인한다", async () => {
  const { subscription, vapid } = await fixtures();
  let captured: { url: string; init?: RequestInit } | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init };
    return new Response("", { status: 201 });
  };
  try {
    const result = await sendWebPush(
      subscription,
      {
        title: "알림 테스트",
        body: "도착 확인",
        data: { url: "/today", type: "test" },
      },
      {
        vapid,
        ttlSeconds: 300,
        urgency: "high",
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.status, 201);
    assert.equal(captured?.url, subscription.endpoint);
    const headers = new Headers(captured?.init?.headers);
    assert.equal(headers.get("content-encoding"), "aes128gcm");
    assert.equal(headers.get("ttl"), "300");
    assert.equal(headers.get("urgency"), "high");
    assert.match(headers.get("authorization") ?? "", /^vapid /i);
    assert.ok(captured?.init?.body instanceof Uint8Array);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("푸시 서비스의 410 응답을 만료 구독으로 분류한다", async () => {
  const { subscription, vapid } = await fixtures();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("expired", { status: 410 });
  let result;
  try {
    result = await sendWebPush(
      subscription,
      {
        title: "알림 테스트",
        body: "도착 확인",
        data: { url: "/today", type: "test" },
      },
      {
        vapid,
        ttlSeconds: 300,
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(result.ok, false);
  assert.equal(result.expired, true);
  assert.equal(result.responseBody, "gone");
});
