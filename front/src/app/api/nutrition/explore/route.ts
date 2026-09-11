import { unstable_cache } from "next/cache";
import { getCareSnapshot, isServiceCareProfileComplete } from "@care-atlas/backend";
import { nutritionExplorationRequest } from "@care-atlas/backend/nutrition-exploration";
import { searchNutritionResources } from "@care-atlas/backend/ai/nutrition-exploration";
import { nutritionSearchFailure, requireNutritionApiKey } from "@care-atlas/backend/nutrition-search-errors";
import { careScopeFor } from "@/lib/auth/care-scope";
import { getSession } from "@/lib/auth/session";
import { isSameOriginBrowserRequest } from "@/lib/request-origin";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rateLimitResponse } from "@/lib/rate-limit-core";

// Public condition resources only. No recipient identifiers or medication data in this cache.
const cachedSearch = unstable_cache(searchNutritionResources, ["nutrition-exploration-ko-discovery-v11"], { revalidate: 86400 });
const pendingSearches = new Map<string, ReturnType<typeof cachedSearch>>();

function coalescedSearch(conditionName: string, conditionCode: string) {
  const key = `${conditionCode}\u0000${conditionName}`;
  const existing = pendingSearches.get(key);
  if (existing) return existing;
  const pending = cachedSearch(conditionName, conditionCode).finally(() => {
    if (pendingSearches.get(key) === pending) pendingSearches.delete(key);
  });
  pendingSearches.set(key, pending);
  return pending;
}

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(request: Request) {
  if (!isSameOriginBrowserRequest(request)) return reply({ message: "허용되지 않은 요청이에요." }, 403);
  const session = await getSession();
  if (!session) return reply({ message: "로그인이 필요해요." }, 401);
  const parsed = nutritionExplorationRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return reply({ message: "질환을 다시 선택해주세요." }, 400);
  const limit = await enforceRateLimit("nutritionSearch", { request, userId: session.id });
  if (!limit.allowed) return rateLimitResponse(limit, "검색을 너무 자주 요청했어요. 잠시 후 다시 시도해주세요.");
  const startedAt = Date.now();
  let stage = "care_scope";
  try {
    const scope = careScopeFor(session);
    if (!scope.useDemoData && !await isServiceCareProfileComplete(scope.recipientId)) {
      return reply({ message: "프로필과 건강정보 처리 동의를 먼저 확인해주세요." }, 403);
    }
    stage = "snapshot";
    const snapshot = await getCareSnapshot(scope);
    const condition = snapshot.recipient.confirmedConditions?.find((item) => item.id === parsed.data.conditionId);
    if (!condition) return reply({ message: "현재 프로필에서 확정된 질환을 선택해주세요." }, 403);
    stage = "configuration";
    requireNutritionApiKey(process.env.OPENAI_API_KEY);
    stage = "search";
    const result = await coalescedSearch(condition.standardName, condition.code);
    console.info(JSON.stringify({
      event: "nutrition_exploration_completed",
      durationMs: Date.now() - startedAt,
      resultCount: result.articles.length,
    }));
    return reply(result);
  } catch (error) {
    const failure = nutritionSearchFailure(error);
    console.warn(JSON.stringify({ event: "nutrition_exploration_failed", stage, code: failure.code, durationMs: Date.now() - startedAt, upstreamStatus: failure.upstreamStatus, retryAfterSeconds: failure.retryAfterSeconds, rateLimit: failure.rateLimit }));
    const response = reply({ message: failure.message, code: failure.code, retryAfterSeconds: failure.retryAfterSeconds }, failure.upstreamStatus === 429 ? 429 : 503);
    if (failure.retryAfterSeconds) response.headers.set("Retry-After", String(failure.retryAfterSeconds));
    return response;
  }
}
