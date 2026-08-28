import { requestAccountDeletion, processAccountDeletion, publicAccountDeletion } from "@care-atlas/backend";
import { cookies } from "next/headers";
import { z } from "zod";
import { isSameOriginBrowserRequest } from "@/lib/request-origin";
import { getAccountDeletionSession, deleteSession } from "@/lib/auth/session";
import { verifyFirebaseGoogleIdToken } from "@/lib/auth/firebase-token";
import { DELETION_RECEIPT_COOKIE, getAccountDeletionReceipt, setAccountDeletionReceipt } from "@/lib/auth/account-deletion-receipt";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rateLimitResponse } from "@/lib/rate-limit-core";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), idToken: z.string().min(100).max(8192), confirmation: z.literal("회원 탈퇴"), policyVersion: z.string().min(1).max(100) }).strict(),
  z.object({ action: z.enum(["process", "finish"]) }).strict(),
]);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  try {
    const job = await getAccountDeletionReceipt();
    return job ? json(publicAccountDeletion(job)) : json({ message: "확인할 탈퇴 요청이 없어요." }, 401);
  } catch { return json({ message: "처리 상태를 확인하지 못했어요. 다시 시도해주세요." }, 503); }
}

export async function POST(request: Request) {
  if (!isSameOriginBrowserRequest(request)) return json({ message: "허용되지 않은 요청이에요." }, 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ message: "탈퇴 확인 내용을 다시 확인해주세요." }, 400);
  try {
    const input = parsed.data;
    if (input.action === "start") {
      const session = await getAccountDeletionSession();
      if (!session || session.provider !== "google") return json({ message: "Google 계정으로 로그인해주세요." }, 401);
      const rate = await enforceRateLimit("auth", { request, userId: session.id });
      if (!rate.allowed) return rateLimitResponse(rate);
      const existing = await getAccountDeletionReceipt();
      let job = existing?.userId === session.id ? existing : null;
      if (!job) {
        const verified = await verifyFirebaseGoogleIdToken(input.idToken).catch(() => null);
        if (!verified) return json({ message: "Google 본인 확인이 만료되었거나 실패했어요. 다시 확인해주세요." }, 401);
        job = await requestAccountDeletion({ userId: session.id, tokenUserId: verified.id, authTime: verified.authTime, confirmation: input.confirmation, policyVersion: input.policyVersion });
      }
      // Commit a receipt before the separate request revokes tokens and unlinks notifications.
      await setAccountDeletionReceipt(job);
      await deleteSession();
      (await cookies()).delete("ipillgood_push_device");
      return json(publicAccountDeletion(job), 202);
    }
    const job = await getAccountDeletionReceipt();
    if (!job) return json({ message: "탈퇴 요청 확인 정보가 만료되었어요. 관리자에게 문의해주세요." }, 401);
    if (input.action === "finish") {
      if (job.status !== "soft_deleted" && job.status !== "completed") return json({ message: "아직 탈퇴 처리가 완료되지 않았어요." }, 409);
      await deleteSession();
      const store = await cookies();
      store.delete(DELETION_RECEIPT_COOKIE);
      store.delete("ipillgood_push_device");
      return json(publicAccountDeletion(job));
    }
    const result = await processAccountDeletion(job.userId);
    return result ? json(publicAccountDeletion(result)) : json({ message: "처리 상태를 확인하지 못했어요." }, 503);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "ACCOUNT_MISMATCH") return json({ message: "현재 로그인한 Google 계정으로 본인 확인을 진행해주세요." }, 403);
    if (code === "REAUTHENTICATION_REQUIRED") return json({ message: "본인 확인 후 5분이 지났어요. 다시 확인해주세요." }, 401);
    if (code === "DELETION_POLICY_UNAVAILABLE") return json({ message: "탈퇴 안내가 변경되었어요. 새로고침 후 다시 확인해주세요." }, 409);
    return json({ message: "탈퇴 요청을 완료하지 못했어요. 처리 상태를 확인한 뒤 다시 시도해주세요." }, 503);
  }
}
