import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";

import {
  RATE_LIMIT_POLICIES,
  clientIpFromHeaders,
  consumeRateLimit,
  type RateLimitBinding,
  type RateLimitPolicyName,
} from "./rate-limit-core";

async function cloudflareBinding(policyName: RateLimitPolicyName) {
  try {
    const context = await getCloudflareContext({ async: true });
    const binding = (context.env as Record<string, unknown>)[RATE_LIMIT_POLICIES[policyName].binding];
    if (binding && typeof (binding as RateLimitBinding).limit === "function") {
      return binding as RateLimitBinding;
    }
  } catch {
    // next dev 또는 Cloudflare 외 환경에서는 메모리 제한을 사용합니다.
  }
  return undefined;
}

export async function enforceRateLimit(
  policyName: RateLimitPolicyName,
  options: { request?: Request; userId?: string } = {},
) {
  const requestHeaders = options.request?.headers ?? new Headers(await headers());
  const result = await consumeRateLimit(
    policyName,
    {
      ip: clientIpFromHeaders(requestHeaders),
      userId: options.userId,
    },
    { binding: await cloudflareBinding(policyName) },
  );

  if (!result.allowed) {
    console.warn(JSON.stringify({ event: "rate_limited", policy: policyName }));
  }
  return result;
}
