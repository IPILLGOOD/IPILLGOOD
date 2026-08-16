import {
  analyzeMedicationDocument,
  registerDocument,
  type ClinicalDocumentType,
} from "@care-atlas/backend";

const allowedDocumentTypes = new Set<ClinicalDocumentType>(["처방전", "진단서"]);
const maxFileSize = 5 * 1024 * 1024;

export async function POST(request: Request) {
  if (process.env.CARE_ATLAS_DEMO_MODE !== "true") {
    return Response.json(
      { message: "현재는 읽기 전용 모드예요. 인증 연결 후 분석을 활성화해주세요." },
      { status: 403 },
    );
  }

  try {
    const formData = await request.formData();
    const documentType = String(formData.get("documentType") ?? "처방전");
    const isSample = formData.get("sample") === "true";

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

    if (
      file instanceof File &&
      !file.type.startsWith("image/") &&
      file.type !== "application/pdf"
    ) {
      return Response.json({ message: "이미지 또는 PDF 파일만 분석할 수 있어요." }, { status: 400 });
    }

    const typedDocumentType = documentType as ClinicalDocumentType;
    const fileName =
      file instanceof File ? file.name : `비식별_샘플_${typedDocumentType}.jpg`;
    const contentType = file instanceof File ? file.type : "image/jpeg";
    const contentBase64 =
      file instanceof File
        ? Buffer.from(await file.arrayBuffer()).toString("base64")
        : undefined;

    const result = await analyzeMedicationDocument({
      documentType: typedDocumentType,
      fileName,
      contentType,
      contentBase64,
    });
    const document = await registerDocument({
      fileName,
      documentType: typedDocumentType,
      size: file instanceof File ? file.size : 284_000,
      isSample,
      analysis: result.analysis,
    });

    return Response.json({
      message: result.message,
      analysis: result.analysis,
      document,
    });
  } catch (error) {
    console.error("Document analysis failed", error);
    return Response.json(
      { message: "문서를 분석하지 못했어요. 파일을 확인한 뒤 다시 시도해주세요." },
      { status: 500 },
    );
  }
}
