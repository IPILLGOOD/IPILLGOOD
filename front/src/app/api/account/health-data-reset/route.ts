import {
  getHealthDataReset,
  processHealthDataReset,
  publicHealthDataReset,
  requestHealthDataReset,
} from "@care-atlas/backend";
import { cookies } from "next/headers";
import { z } from "zod";

import { verifyFirebaseGoogleIdToken } from "@/lib/auth/firebase-token";
import { getSession, deleteSession } from "@/lib/auth/session";
import { isSameOriginBrowserRequest } from "@/lib/request-origin";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rateLimitResponse } from "@/lib/rate-limit-core";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    idToken: z.string().min(100).max(8192),
    confirmation: z.literal("건강정보 삭제"),
    deleteFirebaseAccount: z.boolean(),
  }).strict(),
  z.object({ action: z.literal("process") }).strict(),
]);

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "Cache-Control": "no-store" },
});

async function currentGoogleSession(request?: Request) {
  const session = await getSession();
  if (!session || session.provider !== "google") return null;
  if (request) {
    const rate = await enforceRateLimit("auth", { request, userId: session.id });
    if (!rate.allowed) return rateLimitResponse(rate);
  }
  return session;
}

export async function GET() {
  try {
    const session = await currentGoogleSession();
    if (!session || session instanceof Response) return json({ message: "Google 계정으로 로그인해주세요." }, 401);
    const reset = await getHealthDataReset(session.id);
    return reset ? json(publicHealthDataReset(reset)) : json({ message: "진행 중인 건강정보 삭제가 없어요." }, 404);
  } catch {
    return json({ message: "삭제 상태를 확인하지 못했어요. 다시 시도해주세요." }, 503);
  }
}

export async function POST(request: Request) {
  if (!isSameOriginBrowserRequest(request)) return json({ message: "허용되지 않은 요청이에요." }, 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ message: "삭제 확인 내용을 다시 확인해주세요." }, 400);
  try {
    const session = await currentGoogleSession(request);
    if (!session) return json({ message: "Google 계정으로 로그인해주세요." }, 401);
    if (session instanceof Response) return session;
    if (parsed.data.action === "start") {
      const verified = await verifyFirebaseGoogleIdToken(parsed.data.idToken).catch(() => null);
      if (!verified) return json({ message: "Google 본인 확인이 만료되었거나 실패했어요. 다시 확인해주세요." }, 401);
      await requestHealthDataReset({
        userId: session.id,
        tokenUserId: verified.id,
        authTime: verified.authTime,
        confirmation: parsed.data.confirmation,
        deleteFirebaseAccount: parsed.data.deleteFirebaseAccount,
      });
    }
    const reset = await processHealthDataReset(session.id);
    if (!reset) return json({ message: "진행 중인 건강정보 삭제를 찾지 못했어요." }, 404);
    if (reset.status === "completed" && reset.deleteFirebaseAccount) {
      await deleteSession();
      (await cookies()).delete("ipillgood_push_device");
    }
    return json(publicHealthDataReset(reset), reset.status === "completed" ? 200 : 202);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "ACCOUNT_MISMATCH") return json({ message: "현재 로그인한 Google 계정으로 본인 확인을 진행해주세요." }, 403);
    if (code === "REAUTHENTICATION_REQUIRED") return json({ message: "본인 확인 후 5분이 지났어요. 다시 확인해주세요." }, 401);
    if (code === "RESET_ALREADY_IN_PROGRESS") return json({ message: "다른 범위의 삭제가 이미 진행 중이에요. 현재 작업을 먼저 완료해주세요." }, 409);
    return json({ message: "건강정보 삭제를 완료하지 못했어요. 남은 작업부터 다시 시도해주세요." }, 503);
  }
}
