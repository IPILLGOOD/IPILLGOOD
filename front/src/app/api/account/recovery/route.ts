import { processAccountDeletion, restoreAccount } from "@care-atlas/backend";
import { cookies } from "next/headers";
import { z } from "zod";
import { getAccountRecoverySession, RECOVERY_COOKIE } from "@/lib/auth/account-recovery-session";
import { DELETION_RECEIPT_COOKIE } from "@/lib/auth/account-deletion-receipt";
import { createSession, deleteSession } from "@/lib/auth/session";
import { isSameOriginBrowserRequest } from "@/lib/request-origin";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rateLimitResponse } from "@/lib/rate-limit-core";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("restore"), confirmation: z.literal(true) }).strict(),
  z.object({ action: z.literal("cancel") }).strict(),
]);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!isSameOriginBrowserRequest(request)) return json({ message: "허용되지 않은 요청이에요." }, 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ message: "복구 안내를 확인해주세요." }, 400);
  if (parsed.data.action === "cancel") {
    await deleteSession();
    const store = await cookies();
    store.delete(RECOVERY_COOKIE);
    store.delete(DELETION_RECEIPT_COOKIE);
    store.delete("ipillgood_push_device");
    return json({ redirectTo: "/login" });
  }
  try {
    const recovery = await getAccountRecoverySession();
    if (!recovery) return json({ message: "본인 확인이 만료됐어요. 같은 Google 계정으로 다시 로그인해주세요." }, 401);
    const rate = await enforceRateLimit("auth", { request, userId: recovery.user.id });
    if (!rate.allowed) return rateLimitResponse(rate);
    // A previous suspension failure may be retried, but this never shortens the recovery window.
    if (["pending", "processing", "failed"].includes(recovery.job.status)) await processAccountDeletion(recovery.user.id);
    await restoreAccount({ userId: recovery.user.id, requestId: recovery.job.requestId, authTime: recovery.authTime, confirmation: parsed.data.confirmation });
    await createSession(recovery.user);
    return json({ redirectTo: "/profile?restored=1" });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "RECOVERY_EXPIRED") return json({ message: "3개월의 복구 기간이 지나 영구 삭제 대상이 되었어요. 더 이상 복구할 수 없어요." }, 410);
    if (code === "REAUTHENTICATION_REQUIRED") return json({ message: "같은 Google 계정으로 다시 로그인한 뒤 복구해주세요." }, 401);
    if (code === "ACCOUNT_SUSPENSION_INCOMPLETE") return json({ message: "기존 알림과 세션을 정리하고 있어요. 잠시 후 복구를 다시 시도해주세요." }, 409);
    return json({ message: "복구를 완료하지 못했어요. 잠시 후 다시 시도해주세요." }, 503);
  }
}
