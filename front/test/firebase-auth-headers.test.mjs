import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { unstable_doesMiddlewareMatch, unstable_getResponseFromNextConfig } from "next/experimental/testing/server.js";

const securityModule = new URL("../src/lib/security-headers.ts", import.meta.url).href;
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === "next/server") return next("next/server.js", context);
  if (["@/lib/security-headers", "./src/lib/security-headers"].includes(specifier)) {
    return { url: securityModule, shortCircuit: true };
  }
  if (specifier === "@opennextjs/cloudflare") {
    return { url: "data:text/javascript,export const initOpenNextCloudflareForDev = () => {}", shortCircuit: true };
  }
  return next(specifier, context);
} });
const { middleware, config } = await import("../src/middleware.ts");
const { default: nextConfig } = await import("../next.config.ts");
hooks.deregister();

test("Firebase helpers keep their own script and iframe policy through the rewrite", async () => {
  for (const path of ["/__/auth/handler", "/__/auth/iframe", "/__/auth/handler.js", "/__/auth/experiments.js", "/api/firebase-auth/iframe"]) {
    const url = `https://ipillgood.test${path}`;
    assert.equal(unstable_doesMiddlewareMatch({ config, url }), false, path);
    const response = await unstable_getResponseFromNextConfig({ url, nextConfig });
    assert.equal(response.headers.get("content-security-policy"), null, path);
    assert.equal(response.headers.get("x-frame-options"), null, path);
  }
  const response = middleware(new NextRequest("https://ipillgood.test/__/auth/iframe"));
  assert.equal(response.headers.get("content-security-policy"), null);
});

test("ordinary pages and APIs retain their restrictive security headers", async () => {
  for (const path of ["/login", "/today", "/profile"]) {
    const url = `https://ipillgood.test${path}`;
    assert.equal(unstable_doesMiddlewareMatch({ config, url }), true);
    const response = middleware(new NextRequest(url));
    assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    assert.match(response.headers.get("content-security-policy") ?? "", /'strict-dynamic'/);
  }
  const api = await unstable_getResponseFromNextConfig({ url: "https://ipillgood.test/api/push/config", nextConfig });
  assert.match(api.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  assert.equal(api.headers.get("x-frame-options"), "DENY");
});
