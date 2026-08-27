import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedPushEndpoint } from "../src/lib/push/endpoint.ts";

test("supported provider endpoint shapes (synthetic tokens) remain valid", () => {
  for (const endpoint of [
    "https://fcm.googleapis.com/fcm/send/synthetic",
    "https://web.push.apple.com/QPush/synthetic",
    "https://updates.push.services.mozilla.com/wpush/v2/synthetic",
    "https://wns2-bl2p.notify.windows.com/w/?token=synthetic%2Ftoken",
    "https://another.region.notify.windows.com/w/?token=synthetic",
    "https://notify.windows.com/w/?token=synthetic",
    "https://WNS2-BL2P.NOTIFY.WINDOWS.COM:443/w/?token=synthetic",
  ]) assert.equal(isAllowedPushEndpoint(endpoint), true, endpoint);
});

test("lookalike hosts, unsafe URL components and private targets are rejected", () => {
  for (const endpoint of [
    "https://evilnotify.windows.com/w/", "https://notify.windows.com.evil.test/w/",
    "https://notify.windows.com@evil.test/w/", "https://evil.test/?notify.windows.com",
    "https://user:password@notify.windows.com/w/", "https://notify.windows.com:444/w/",
    "https://notify.windows.com/w/#fragment", "http://wns.notify.windows.com/w/",
    "https://127.0.0.1/w/", "https://[::1]/w/", "https://169.254.169.254/",
    "https://evilfcm.googleapis.com/", "https://evil.push.apple.com.evil.test/",
    "https://evilpush.services.mozilla.com/", "not a URL", "//notify.windows.com/w/",
  ]) assert.equal(isAllowedPushEndpoint(endpoint), false, endpoint);
});
