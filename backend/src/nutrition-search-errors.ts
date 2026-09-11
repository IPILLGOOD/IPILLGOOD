import { APIConnectionError, APIConnectionTimeoutError } from "openai";

const messages = {
  key_missing: "현재 자료 검색을 시작할 수 없어요. 관리자에게 알려주세요.",
  key_format: "현재 자료 검색 설정을 확인하고 있어요. 관리자에게 알려주세요.",
  provider_auth: "현재 자료 검색을 시작할 수 없어요. 관리자에게 알려주세요.",
  provider_permission: "현재 자료 검색을 시작할 수 없어요. 관리자에게 알려주세요.",
  provider_quota: "오늘 사용할 수 있는 검색량을 모두 사용했어요. 잠시 후 다시 확인해주세요.",
  provider_credit: "오늘 사용할 수 있는 검색량을 모두 사용했어요. 잠시 후 다시 확인해주세요.",
  provider_spend_limit: "오늘 사용할 수 있는 검색량을 모두 사용했어요. 잠시 후 다시 확인해주세요.",
  provider_usage_limit: "오늘 사용할 수 있는 검색량을 모두 사용했어요. 잠시 후 다시 확인해주세요.",
  provider_rate_limit: "검색 요청이 잠시 몰렸어요. 잠시 후 다시 시도해주세요.",
  provider_limit_unknown: "검색 요청이 잠시 몰렸어요. 잠시 후 다시 시도해주세요.",
  provider_request: "검색 조건을 처리하지 못했어요. 잠시 후 다시 시도해주세요.",
  provider_timeout: "자료 검색 응답이 지연되고 있어요. 잠시 후 다시 시도해주세요.",
  provider_connection: "검색 서비스에 연결하지 못했어요. 잠시 후 다시 시도해주세요.",
  invalid_response: "검색 결과를 해석하지 못했어요. 잠시 후 다시 시도해주세요.",
  internal: "자료를 불러오지 못했어요. 잠시 후 다시 시도해주세요.",
} as const;
type Reason = keyof typeof messages;

export class NutritionSearchError extends Error {
  readonly reason: Reason;
  constructor(reason: Reason) { super(messages[reason]); this.reason = reason; }
}

export function requireNutritionApiKey(value: string | undefined): string {
  if (!value?.trim()) throw new NutritionSearchError("key_missing");
  // Reject accidental assignment/paste errors, without guessing or repairing a secret.
  if (value.includes("=") || /\s/.test(value) || (value.match(/sk-/g)?.length ?? 0) > 1) {
    throw new NutritionSearchError("key_format");
  }
  return value;
}

/** Never copy provider messages, bodies, headers, keys or arbitrary codes into logs. */
export function nutritionSearchFailure(error: unknown) {
  const source = error && typeof error === "object" ? error as { status?: unknown; code?: unknown; type?: unknown; name?: unknown; headers?: unknown; message?: unknown } : {};
  const status = typeof source.status === "number" && Number.isInteger(source.status) && source.status >= 400 && source.status <= 599 ? source.status : undefined;
  let code: Reason = "internal";
  if (error instanceof NutritionSearchError) code = error.reason;
  else if (status === 401) code = "provider_auth";
  else if (status === 403) code = "provider_permission";
  else if (status === 429) {
    if (source.code === "credit_balance_exhausted") code = "provider_credit";
    else if (source.code === "organization_spend_limit_exceeded" || source.code === "project_spend_limit_exceeded") code = "provider_spend_limit";
    else if (source.code === "organization_usage_limit_exceeded") code = "provider_usage_limit";
    else if (source.code === "insufficient_quota" || source.type === "insufficient_quota" || source.code === "billing_hard_limit_reached") code = "provider_quota";
    else if (source.code === "rate_limit_exceeded" || source.type === "rate_limit_exceeded" || source.code === "slow_down" || source.type === "rate_limit_error") code = "provider_rate_limit";
    else code = "provider_limit_unknown";
  }
  else if (status === 400 || status === 404 || status === 422) code = "provider_request";
  else if (error instanceof APIConnectionTimeoutError || source.name === "TimeoutError") code = "provider_timeout";
  else if (error instanceof APIConnectionError) code = "provider_connection";
  let retryAfterSeconds: number | undefined;
  if (status === 429 && (code === "provider_rate_limit" || code === "provider_limit_unknown")) {
    const raw = source.headers instanceof Headers ? source.headers.get("retry-after") : null;
    const seconds = raw && /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw ? (Date.parse(raw) - Date.now()) / 1000 : NaN;
    retryAfterSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.min(3600, Math.ceil(seconds)) : 60;
  }
  const rateLimit: Record<string, number | string> = {};
  if (code === "provider_rate_limit") {
    // Inspect only to extract fixed categories and numbers; never return raw error text.
    const text = typeof source.message === "string" ? source.message : "";
    rateLimit.dimension = /tokens per min|\bTPM\b/i.test(text) ? "tokens" : /requests per min|\bRPM\b/i.test(text) ? "requests" : "unknown";
    for (const label of ["Limit", "Used", "Requested"] as const) {
      const match = new RegExp(`\\b${label}:\\s*(\\d+(?:\\.\\d+)?)\\b`, "i").exec(text);
      if (match && Number.isSafeInteger(Number(match[1]))) rateLimit[label.toLowerCase()] = Number(match[1]);
    }
    if (source.headers instanceof Headers) {
      for (const dimension of ["tokens", "requests"] as const) {
        for (const kind of ["limit", "remaining"] as const) {
          const value = source.headers.get(`x-ratelimit-${kind}-${dimension}`);
          if (value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))) rateLimit[`${dimension}_${kind}`] = Number(value);
        }
      }
    }
  }
  const message = messages[code];
  return { code, message, ...(status ? { upstreamStatus: status } : {}),
    ...(Object.keys(rateLimit).length ? { rateLimit } : {}),
    ...(retryAfterSeconds ? { retryAfterSeconds } : {}) };
}
