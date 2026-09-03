import {
  getDocumentAnalysisJob,
  requestDocumentAnalysisJobCancellation,
} from "@care-atlas/backend";

import { getSession } from "@/lib/auth/session";
import { careScopeFor } from "@/lib/auth/care-scope";

type Context = { params: Promise<{ jobId: string }> };

async function jobForSession(context: Context) {
  const session = await getSession();
  if (!session) return { error: Response.json({ message: "로그인이 필요해요." }, { status: 401 }) };
  const { jobId } = await context.params;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(jobId)) {
    return { error: Response.json({ message: "분석 작업 식별자가 올바르지 않아요." }, { status: 400 }) };
  }
  return { scope: careScopeFor(session), jobId };
}

export async function GET(_request: Request, context: Context) {
  const resolved = await jobForSession(context);
  if ("error" in resolved) return resolved.error;
  const job = await getDocumentAnalysisJob(resolved.scope, resolved.jobId);
  if (!job) return Response.json({ message: "분석 작업을 찾지 못했어요." }, { status: 404 });
  return Response.json({ job });
}

export async function DELETE(_request: Request, context: Context) {
  const resolved = await jobForSession(context);
  if ("error" in resolved) return resolved.error;
  const job = await requestDocumentAnalysisJobCancellation(resolved.scope, resolved.jobId);
  if (!job) return Response.json({ message: "분석 작업을 찾지 못했어요." }, { status: 404 });
  return Response.json({
    message: job.state === "completed"
      ? "이미 분석이 완료됐어요."
      : job.state === "failed" || job.state === "cancelled"
        ? "이미 분석 작업이 종료됐어요."
        : "취소 요청을 접수했어요. 저장을 중단하고 최종 상태를 확인할게요.",
    job,
  });
}
