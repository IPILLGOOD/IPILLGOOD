import {
  confirmMedicationPlanDraftAndSyncMedicationReminders,
  isServiceCareProfileComplete,
  withCareAccountProcessing,
} from "@care-atlas/backend";
import { z } from "zod";

import { careScopeFor } from "@/lib/auth/care-scope";
import { getSession } from "@/lib/auth/session";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rateLimitResponse } from "@/lib/rate-limit-core";
import { isSameOriginBrowserRequest } from "@/lib/request-origin";

const candidateSchema = z.object({
  id: z.string().min(1).max(256),
  included: z.boolean(),
  isManual: z.boolean().optional(),
  confirmedAgainstOriginal: z.boolean().optional(),
  productName: z.string().max(120),
  ingredientName: z.string().max(180),
  mfdsItemSeq: z.string().regex(/^\d{0,20}$/).optional(),
  insuranceCode: z.string().regex(/^\d{0,20}$/).optional(),
  doseAmount: z.string().max(80),
  frequency: z.string().max(80),
  timing: z.string().max(120),
  startDate: z.string().max(10),
  endDate: z.string().max(10).optional(),
  supplyDays: z.number().int().positive().max(3650).optional(),
});

const confirmSchema = z.object({
  draftId: z.string().min(1).max(256),
  revision: z.number().int().positive(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
  candidates: z.array(candidateSchema).min(1).max(50),
});

export async function POST(request: Request) {
  if (!isSameOriginBrowserRequest(request)) {
    return Response.json({ message: "허용되지 않은 요청이에요." }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return Response.json({ message: "로그인이 필요해요." }, { status: 401 });

  const rateLimit = await enforceRateLimit("documentAnalysis", { request, userId: session.id });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);
  const parsed = confirmSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ message: "확정할 약과 복용 일정을 다시 확인해주세요." }, { status: 400 });
  }

  const scope = careScopeFor(session);
  if (!scope.useDemoData && !await isServiceCareProfileComplete(scope.recipientId)) {
    return Response.json({ message: "돌봄 대상자 정보와 건강정보 처리 동의를 먼저 확인해주세요." }, { status: 403 });
  }
  try {
    const result = await withCareAccountProcessing(scope.recipientId, () =>
      confirmMedicationPlanDraftAndSyncMedicationReminders(scope, {
        ...parsed.data,
        confirmedBy: `${session.provider}:${session.id}`,
      }));
    return Response.json({
      message: `선택한 약 ${result.medications.length}개를 복약 일정에 반영했어요. 알림 일정도 안전하게 동기화됩니다.`,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "복약 초안을 확정하지 못했어요.";
    const conflict = /만료|변경|취소|이미|revision|근거 문서/.test(message);
    return Response.json({ message }, { status: conflict ? 409 : 400 });
  }
}
