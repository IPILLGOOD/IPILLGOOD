export const RATE_LIMIT_POLICIES = {
  auth: { binding: "RATE_LIMIT_AUTH", limit: 10, windowSeconds: 60 },
  checkIn: { binding: "RATE_LIMIT_CHECKIN", limit: 20, windowSeconds: 60 },
  documentAnalysis: { binding: "RATE_LIMIT_ANALYSIS", limit: 5, windowSeconds: 60 },
  medicationSearch: { binding: "RATE_LIMIT_SEARCH", limit: 30, windowSeconds: 60 },
} as const;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;

export type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  retryAfterSeconds: number;
  source: "cloudflare" | "memory";
}

type MemoryEntry = { count: number; resetAt: number };

export class InMemoryRateLimitStore {
  private readonly entries = new Map<string, MemoryEntry>();

  consume(key: string, limit: number, windowSeconds: number, now = Date.now()) {
    const existing = this.entries.get(key);
    const entry =
      !existing || existing.resetAt <= now
        ? { count: 0, resetAt: now + windowSeconds * 1_000 }
        : existing;
    entry.count += 1;
    this.entries.set(key, entry);

    if (this.entries.size > 10_000) {
      for (const [entryKey, value] of this.entries) {
        if (value.resetAt <= now) this.entries.delete(entryKey);
      }
    }

    return {
      allowed: entry.count <= limit,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1_000)),
    };
  }
}

const defaultMemoryStore = new InMemoryRateLimitStore();

export function clientIpFromHeaders(headers: Headers) {
  const cloudflareIp = headers.get("cf-connecting-ip")?.trim();
  if (cloudflareIp) return cloudflareIp.slice(0, 64);
  const forwardedIp = headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return (forwardedIp || "unknown").slice(0, 64);
}

async function rateLimitKey(policy: RateLimitPolicyName, userId: string | undefined, ip: string) {
  const identity = `${policy}\u0000${userId || "anonymous"}\u0000${ip}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function consumeRateLimit(
  policyName: RateLimitPolicyName,
  identity: { ip: string; userId?: string },
  options: {
    binding?: RateLimitBinding;
    memoryStore?: InMemoryRateLimitStore;
    now?: number;
  } = {},
): Promise<RateLimitResult> {
  const policy = RATE_LIMIT_POLICIES[policyName];
  const key = await rateLimitKey(policyName, identity.userId, identity.ip);

  if (options.binding) {
    try {
      const result = await options.binding.limit({ key });
      return {
        allowed: result.success,
        limit: policy.limit,
        retryAfterSeconds: policy.windowSeconds,
        source: "cloudflare",
      };
    } catch {
      // 배포 바인딩의 일시 오류에는 로컬 창 제한을 보조 방어로 사용합니다.
    }
  }

  const result = (options.memoryStore ?? defaultMemoryStore).consume(
    `${policyName}:${key}`,
    policy.limit,
    policy.windowSeconds,
    options.now,
  );
  return { ...result, limit: policy.limit, source: "memory" };
}

export function rateLimitResponse(result: RateLimitResult, message = "요청이 너무 많아요. 잠시 후 다시 시도해주세요.") {
  return Response.json(
    { message },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "RateLimit-Limit": String(result.limit),
        "Retry-After": String(result.retryAfterSeconds),
      },
    },
  );
}
