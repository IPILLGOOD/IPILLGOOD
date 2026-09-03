import {
  isServiceCareProfileComplete,
  updateDocumentDiagnoses,
  withCareAccountProcessing,
} from "@care-atlas/backend";
import { z } from "zod";

import { careScopeFor } from "@/lib/auth/care-scope";
import { getSession } from "@/lib/auth/session";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rateLimitResponse } from "@/lib/rate-limit-core";
import { isSameOriginBrowserRequest } from "@/lib/request-origin";

const updateSchema = z.object({
  documentId: z.string().min(1).max(256),
  expectedAnalysisRevision: z.number().int().positive(),
  diagnoses: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    code: z.string().trim().max(20).optional(),
  })).min(1).max(20),
});

export async function POST(request: Request) {
  if (!isSameOriginBrowserRequest(request)) {
    return Response.json({ message: "허용되지 않은 요청이에요." }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return Response.json({ message: "로그인이 필요해요." }, { status: 401 });

  const rateLimit = await enforceRateLimit("documentAnalysis", { request, userId: session.id });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ message: "진단명과 질병코드를 다시 확인해주세요." }, { status: 400 });
  }

  const scope = careScopeFor(session);
  if (!scope.useDemoData && !await isServiceCareProfileComplete(scope.recipientId)) {
    return Response.json({ message: "돌봄 대상자 정보와 건강정보 처리 동의를 먼저 확인해주세요." }, { status: 403 });
  }
  try {
    const document = await withCareAccountProcessing(scope.recipientId, () =>
      updateDocumentDiagnoses(scope, {
        ...parsed.data,
        updatedBy: `${session.provider}:${session.id}`,
      }));
    return Response.json({ message: "진단 정보를 수정했어요. 원본과 다시 대조한 뒤 확정해주세요.", document });
  } catch (error) {
    const message = error instanceof Error ? error.message : "진단 정보를 수정하지 못했어요.";
    const conflict = /변경|revision|최신/.test(message);
    return Response.json({ message }, { status: conflict ? 409 : 400 });
  }
}
