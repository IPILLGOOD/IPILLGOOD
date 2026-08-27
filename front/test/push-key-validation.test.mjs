import assert from "node:assert/strict";
import test from "node:test";
import { decodePushPublicKey, pushKeyStatus, subscriptionExpired, withPushTimeout } from "../src/lib/push/key-validation.ts";
import { observePushReentry } from "../src/lib/push/refresh-lifecycle.ts";

const bytes = Uint8Array.from({ length: 65 }, (_, index) => index === 0 ? 4 : index);
const key = Buffer.from(bytes).toString("base64url");

test("VAPID key comparison is byte-based, handles padding, mismatch and unavailable browser metadata", () => {
  assert.deepEqual(decodePushPublicKey(key), bytes);
  assert.equal(pushKeyStatus(bytes.buffer, `${key}=`), "matched");
  const other = bytes.slice(); other[2]++;
  assert.equal(pushKeyStatus(other.buffer, key), "mismatch");
  assert.equal(pushKeyStatus(new Uint8Array(5).buffer, key), "mismatch");
  assert.equal(pushKeyStatus(null, key), "unverifiable");
  for (const invalid of ["", "%%%", "abcd", Buffer.from(new Uint8Array(65)).toString("base64url")]) {
    assert.throws(() => decodePushPublicKey(invalid));
  }
});

test("subscription expiry is separate from key matching", () => {
  assert.equal(subscriptionExpired(null, 100), false);
  assert.equal(subscriptionExpired(100, 100), true);
  assert.equal(subscriptionExpired(101, 100), false);
});

test("PWA launch, foreground, BFCache, focus, reconnect and display changes all recheck; cleanup stops checks", () => {
  const page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const browser = new EventTarget();
  const media = new EventTarget();
  let count = 0;
  const stop = observePushReentry(() => count++, page, browser, media);
  assert.equal(count, 1);
  for (const event of ["pageshow", "focus", "online"]) browser.dispatchEvent(new Event(event));
  media.dispatchEvent(new Event("change"));
  assert.equal(count, 5);
  page.visibilityState = "hidden";
  page.dispatchEvent(new Event("visibilitychange"));
  browser.dispatchEvent(new Event("focus"));
  assert.equal(count, 5);
  page.visibilityState = "visible";
  page.dispatchEvent(new Event("visibilitychange"));
  assert.equal(count, 6);
  stop();
  page.dispatchEvent(new Event("visibilitychange"));
  browser.dispatchEvent(new Event("pageshow"));
  media.dispatchEvent(new Event("change"));
  assert.equal(count, 6);
});

test("service worker readiness is bounded instead of leaving UI loading forever", async () => {
  await assert.rejects(withPushTimeout(new Promise(() => {}), 5), /초과/);
  assert.equal(await withPushTimeout(Promise.resolve("ready"), 100), "ready");
});
