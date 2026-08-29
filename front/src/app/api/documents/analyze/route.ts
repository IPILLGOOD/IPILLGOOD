import { createHash } from "node:crypto";

import {
  analyzeMedicationDocument,
  withCareAccountProcessing,
  isServiceAccountActive,
  DocumentAnalysisIncompleteError,
  DocumentAnalysisNotConfiguredError,
  DocumentUploadValidationError,
  getCareSnapshot,
  getDocumentImportReview,
  getMedicationPlanDraft,
  isServiceHealthDataConsentConfirmed,
  MedicationDuplicateResolutionRequiredError,
  registerDocument,
  saveDocumentImportReview,
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

  const scope = careScopeFor(session);
  if (!await isServiceHealthDataConsentConfirmed(scope.recipientId)) {
    return Response.json(
      { message: "건강정보 처리에 동의한 뒤 문서를 분석할 수 있어요." },
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
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    const duplicateActionValue = String(formData.get("duplicateAction") ?? "");
    const duplicateAction = duplicateActionValue === "merge" || duplicateActionValue === "separate"
      ? duplicateActionValue
      : undefined;

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
    const requestIdempotencyKey = idempotencyKey || contentHash;
    if (!/^[^/]{1,256}$/.test(requestIdempotencyKey)) {
      return Response.json({ message: "문서 요청 식별자가 올바르지 않아요." }, { status: 400 });
    }

    if (session.provider === "google" && !await isServiceAccountActive(session.id)) {
      return Response.json({ message: "회원 탈퇴 처리 중에는 분석할 수 없어요." }, { status: 403 });
    }
    if (!await isServiceHealthDataConsentConfirmed(scope.recipientId)) {
      return Response.json(
        { message: "건강정보 처리 동의가 철회되어 분석을 중단했어요." },
        { status: 403 },
      );
    }
    const existingDocument = (await getCareSnapshot(scope)).documents.find(
      (document) => document.contentHash === contentHash,
    );
    if (existingDocument) {
      const storedDraft = existingDocument.medicationDraftId
        ? await getMedicationPlanDraft(scope, existingDocument.medicationDraftId)
        : null;
      const draft = storedDraft?.state === "needs_review" ? storedDraft : null;
      const requiresPeriodReview = draft?.candidates.some((candidate) =>
        !candidate.startDate || !candidate.endDate) ?? false;
      const reviewMedicationCount = typedDocumentType === "처방전"
        ? (existingDocument.analysis?.medications ?? []).filter(
            (medication) => medication.reviewStatus !== "verified",
          ).length
        : 0;
      return Response.json({
        message: draft
          ? "이미 등록한 같은 문서예요. 기존 복약 초안을 불러왔어요."
          : "이미 등록한 같은 문서예요. 기존 분석 결과를 불러왔어요.",
        analysis: existingDocument.analysis,
        document: existingDocument,
        draft,
        addedMedicationCount: 0,
        reviewMedicationCount,
        requiresPeriodReview,
        idempotentReplay: true,
        duplicateResolution: existingDocument.duplicateResolution,
      });
    }

    const pendingReview = await getDocumentImportReview(scope, requestIdempotencyKey, contentHash);
    if (pendingReview && !duplicateAction) {
      return Response.json({
        message: "기존 복약과 겹치는 후보가 있어 병합 또는 별도 등록을 선택해주세요.",
        analysis: pendingReview.analysis,
        duplicateResolutionRequired: true,
        duplicateCandidates: pendingReview.duplicateCandidates,
        idempotencyKey: requestIdempotencyKey,
      }, { status: 409 });
    }

    const result = pendingReview
      ? { status: "complete" as const, message: "저장된 분석 결과를 불러왔어요.", analysis: pendingReview.analysis }
      : await withCareAccountProcessing(scope.recipientId, () => analyzeMedicationDocument({
          documentType: typedDocumentType,
          fileName,
          contentType,
          contentBase64,
        }));
    let document;
    try {
      document = await registerDocument(scope, {
        fileName,
        contentHash,
        documentType: typedDocumentType,
        size: file instanceof File ? file.size : 284_000,
        isSample,
        analysis: result.analysis,
        requestIdempotencyKey,
        duplicateAction,
      });
    } catch (error) {
      if (!(error instanceof MedicationDuplicateResolutionRequiredError)) throw error;
      const review = await saveDocumentImportReview(scope, {
        idempotencyKey: requestIdempotencyKey,
        contentHash,
        fileName,
        documentType: typedDocumentType,
        size: file instanceof File ? file.size : 284_000,
        isSample,
        analysis: result.analysis,
        duplicateCandidates: error.candidates,
      });
      return Response.json({
        message: error.message,
        analysis: result.analysis,
        duplicateResolutionRequired: true,
        duplicateCandidates: review.duplicateCandidates,
        idempotencyKey: requestIdempotencyKey,
      }, { status: 409 });
    }

    const draft = document.medicationDraftId
      ? await getMedicationPlanDraft(scope, document.medicationDraftId)
      : null;
    const requiresPeriodReview = draft?.candidates.some((candidate) =>
      !candidate.startDate || !candidate.endDate) ?? false;
    const reviewMedicationCount = typedDocumentType === "처방전"
      ? (result.analysis.medications ?? []).filter(
          (medication) => medication.reviewStatus !== "verified",
        ).length
      : 0;
    return Response.json({
      message: document.duplicateResolution === "merge"
        ? `${result.message} 기존 복약 계획과 병합해 중복 일정은 만들지 않았어요.`
        : reviewMedicationCount > 0
          ? `${result.message} OCR 또는 공식 정보 확인이 필요한 약 ${reviewMedicationCount}개는 선택할 수 없어요. 나머지 약도 검토하고 확정하기 전에는 반영하지 않아요.`
          : draft
            ? requiresPeriodReview
              ? `${result.message} 복약 일정에는 아직 반영하지 않았어요. 약 ${draft.candidates.length}개의 처방 기간을 확인하고 확정해주세요.`
              : `${result.message} 복약 일정에는 아직 반영하지 않았어요. 약 ${draft.candidates.length}개를 검토하고 확정해주세요.`
            : result.message,
      analysis: result.analysis,
      document,
      draft,
      addedMedicationCount: 0,
      reviewMedicationCount,
      requiresPeriodReview,
      duplicateResolution: document.duplicateResolution,
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
