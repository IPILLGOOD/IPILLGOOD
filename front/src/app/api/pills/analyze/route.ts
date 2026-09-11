import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isServiceCareProfileComplete, withCareAccountProcessing } from "@care-atlas/backend";
import { analyzePillWebPhotos, parsePillWebUpload, PILL_WEB_MAX_BODY_BYTES } from "@care-atlas/backend/pill-photo-web";
import { boundedPillResponse, readPillWebManifest, readPillWebChunks } from "@care-atlas/backend/pill-catalog-web";
import { getSession } from "@/lib/auth/session";
import { careScopeFor } from "@/lib/auth/care-scope";
import { isSameOriginBrowserRequest } from "@/lib/request-origin";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rateLimitResponse } from "@/lib/rate-limit-core";

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const unavailable = "공식 낱알 목록을 갱신하고 있어요. 잠시 후 다시 이용해주세요.";
async function assetReader(request: Request) {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const assets = (env as { ASSETS?: { fetch(request: Request): Promise<Response> } }).ASSETS;
    if (assets) return (path: string) => assets.fetch(new Request(`https://assets.local${path}`));
  } catch { /* Next.js local server has no Workers asset binding. */ }
  const local = new URL(request.url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(local.hostname)) throw new Error("catalog_unavailable");
  return (path: string) => fetch(new URL(path, local), { redirect: "error", signal: AbortSignal.timeout(10_000) });
}
export async function GET(request: Request) {
  if (!await getSession()) return reply({ message: "로그인이 필요해요." }, 401);
  try {
    if (!process.env.OPENAI_API_KEY?.trim()) throw new Error("not_configured");
    const manifest = await readPillWebManifest(await assetReader(request));
    return reply({ ready: true, verifiedAt: manifest.verifiedAt, totalCount: manifest.totalCount });
  } catch { return reply({ ready: false, message: unavailable }, 503); }
}
export async function POST(request: Request) {
  if (!isSameOriginBrowserRequest(request)) return reply({ message: "허용되지 않은 요청이에요." }, 403);
  const session = await getSession();
  if (!session) return reply({ message: "로그인이 필요해요." }, 401);
  const scope = careScopeFor(session);
  if (!scope.useDemoData && !await isServiceCareProfileComplete(scope.recipientId)) return reply({ message: "프로필과 건강정보 처리 동의를 먼저 확인해주세요." }, 403);
  if (scope.useDemoData && process.env.IPILLGOOD_DEMO_MODE !== "true") return reply({ message: "현재 체험 모드에서는 사진을 분석할 수 없어요." }, 403);
  const limit = await enforceRateLimit("pillPhotoAnalysis", { request, userId: session.id });
  if (!limit.allowed) return rateLimitResponse(limit);
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)
    || Number(request.headers.get("content-length")) > PILL_WEB_MAX_BODY_BYTES) return reply({ message: "사진 용량이 너무 크거나 파일 형식이 올바르지 않아요." }, 413);
  let stage = "catalog";
  try {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error("not_configured");
    const readAsset = await assetReader(request);
    const manifest = await readPillWebManifest(readAsset);
    stage = "upload";
    const bytes = await boundedPillResponse(new Response(request.body), PILL_WEB_MAX_BODY_BYTES);
    const form = await new Response(bytes as BodyInit, { headers: { "content-type": contentType } }).formData();
    const images = await parsePillWebUpload(form);
    stage = "analysis";
    const result = await withCareAccountProcessing(scope.recipientId, () => analyzePillWebPhotos(images, { apiKey,
      model: process.env.PILL_PHOTO_MODEL?.trim() || "gpt-5.6-sol",
      catalog: { version: manifest.version, verifiedAt: manifest.verifiedAt, totalCount: manifest.totalCount },
      chunks: () => readPillWebChunks(manifest, readAsset),
    }));
    return reply(result);
  } catch (error) {
    // Do not log images, filenames, inferred health data, credentials or provider bodies.
    const reason = error instanceof Error ? error.message : "";
    if (stage === "upload") return reply({ message: reason === "duplicate_photo"
      ? "같은 사진이 두 장 들어갔어요. 같은 알약의 앞면과 뒷면을 각각 촬영해주세요."
      : "사진 두 장과 전송 동의를 확인해주세요. JPEG 또는 PNG 사진을 다시 선택해주세요." }, 400);
    if (stage === "catalog" || reason === "catalog_unavailable") return reply({ message: unavailable }, 503);
    return reply({ message: reason === "rate_limited" ? "분석 요청이 많아요. 잠시 후 다시 시도해주세요."
      : reason === "timeout" ? "분석 시간이 길어져 중단했어요. 잠시 후 다시 시도해주세요."
      : "사진 분석을 완료하지 못했어요. 잠시 후 다시 시도해주세요." }, reason === "rate_limited" ? 429 : 503);
  }
}
