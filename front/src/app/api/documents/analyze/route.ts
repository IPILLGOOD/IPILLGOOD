import { createHash } from "node:crypto";

import {
  analyzeMedicationDocument,
  withCareAccountProcessing,
  isServiceAccountActive,
  DocumentAnalysisIncompleteError,
  DocumentAnalysisNotConfiguredError,
  DocumentUploadValidationError,
  getMedicationPlanDraft,
  registerDocument,
  type ClinicalDocumentType,
  validateClinicalDocumentFile,
} from "@care-atlas/backend";

import { getSession } from "@/lib/auth/session";
import { careScopeFor } from "@/lib/auth/care-scope";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rateLimitResponse } from "@/lib/rate-limit-core";

const allowedDocumentTypes = new Set<ClinicalDocumentType>(["처방전", "진단서"]);
const maxFileSize = 5 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ message: "로그인이 필요해요." }, { status: 401 });
  }

  if (session.provider === "demo" && process.env.IPILLGOOD_DEMO_MODE !== "true") {
    return Response.json(
      { message: "현재는 읽기 전용 모드예요. 인증 연결 후 분석을 활성화해주세요." },
      { status: 403 },
    );
  }

  const rateLimit = await enforceRateLimit("documentAnalysis", {
    request,
    userId: session.id,
  });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  try {
    const formData = await request.formData();
    const documentType = String(formData.get("documentType") ?? "처방전");
    const isSample = formData.get("sample") === "true";

    if (isSample && session.provider !== "demo") {
      return Response.json(
        { message: "샘플 문서 체험은 데모 로그인에서만 이용할 수 있어요." },
        { status: 403 },
      );
    }

    if (!allowedDocumentTypes.has(documentType as ClinicalDocumentType)) {
      return Response.json({ message: "처방전 또는 진단서를 선택해주세요." }, { status: 400 });
    }

    const file = formData.get("document");
    if (!isSample && (!(file instanceof File) || file.size === 0)) {
      return Response.json(
        { message: "분석할 처방전이나 진단서 파일을 선택해주세요." },
        { status: 400 },
      );
    }

    if (file instanceof File && file.size > maxFileSize) {
      return Response.json({ message: "문서는 5MB 이하로 올려주세요." }, { status: 400 });
    }

    const typedDocumentType = documentType as ClinicalDocumentType;
    const fileName =
      file instanceof File ? file.name : `비식별_샘플_${typedDocumentType}.jpg`;
    const fileBytes =
      file instanceof File ? new Uint8Array(await file.arrayBuffer()) : undefined;
    const claimedContentType = file instanceof File ? file.type : "";
    const validatedFile = fileBytes
      ? await validateClinicalDocumentFile(fileBytes, claimedContentType)
      : undefined;
    const contentType = validatedFile?.contentType ?? "image/jpeg";
    const contentBase64 = fileBytes ? Buffer.from(fileBytes).toString("base64") : undefined;
    const contentHash = createHash("sha256")
      .update(typedDocumentType)
      .update("\0")
      .update(fileBytes ?? `sample:${fileName}`)
      .digest("hex");

    if (session.provider === "google" && !await isServiceAccountActive(session.id)) {
      return Response.json({ message: "회원 탈퇴 처리 중에는 분석할 수 없어요." }, { status: 403 });
    }
    const result = await withCareAccountProcessing(careScopeFor(session).recipientId, () => analyzeMedicationDocument({
      documentType: typedDocumentType,
      fileName,
      contentType,
      contentBase64,
    }));
    const scope = careScopeFor(session);
    const document = await registerDocument(scope, {
      fileName,
      contentHash,
      documentType: typedDocumentType,
      size: file instanceof File ? file.size : 284_000,
      isSample,
      analysis: result.analysis,
    });
    const draft = document.medicationDraftId
      ? await getMedicationPlanDraft(scope, document.medicationDraftId)
      : null;

    return Response.json({
      message:
        draft
          ? `${result.message} 복약 일정에는 아직 반영하지 않았어요. 약 ${draft.candidates.length}개를 검토하고 확정해주세요.`
          : result.message,
      analysis: result.analysis,
      document,
      draft,
      addedMedicationCount: 0,
    });
  } catch (error) {
    if (error instanceof DocumentUploadValidationError) {
      return Response.json({ message: error.userMessage }, { status: 400 });
    }
    if (error instanceof DocumentAnalysisNotConfiguredError) {
      return Response.json(
        {
          message: session.provider === "demo"
            ? "실제 문서 분석 API가 설정되지 않았어요. 비식별 샘플만 이용할 수 있어요."
            : "문서 분석 서비스를 준비 중이에요. 잠시 후 다시 시도해주세요.",
        },
        { status: 503 },
      );
    }
    if (error instanceof DocumentAnalysisIncompleteError) {
      return Response.json(
        { message: "문서에서 약 또는 진단 정보를 충분히 읽지 못했어요. 더 선명한 파일로 다시 시도해주세요." },
        { status: 422 },
      );
    }
    console.error("Document analysis failed", error);
    return Response.json(
      { message: "문서를 분석하지 못했어요. 파일을 확인한 뒤 다시 시도해주세요." },
      { status: 500 },
    );
  }
}
