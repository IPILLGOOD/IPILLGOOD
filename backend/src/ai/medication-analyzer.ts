import type { ClinicalDocumentType, DocumentAnalysis } from "../types";

export interface MedicationAnalyzerInput {
  documentType: ClinicalDocumentType;
  fileName: string;
  contentType: string;
  contentBase64?: string;
}

export interface MedicationAnalyzerResult {
  status: "complete";
  message: string;
  analysis: DocumentAnalysis;
}

function demoAnalysis(documentType: ClinicalDocumentType): DocumentAnalysis {
  if (documentType === "진단서") {
    return {
      documentType,
      summary:
        "진료에서 확인된 상태와 이후 돌봄에서 살펴볼 내용을 보호자가 이해하기 쉬운 말로 정리했어요.",
      findings: [
        { label: "확인된 내용", value: "혈압을 꾸준히 관리하고 경과를 살펴보는 중이에요." },
        { label: "진료 시점", value: "2026년 8월 16일" },
        { label: "다음 계획", value: "기록한 혈압과 몸 상태를 다음 진료 때 함께 확인해요." },
      ],
      carePoints: [
        "평소와 다른 어지러움이나 휘청거림이 있는지 기록해주세요.",
        "의료진이 안내한 다음 진료 날짜와 검사 일정을 확인해주세요.",
      ],
      questionsForProfessional: [
        "집에서 어떤 변화를 우선 기록해 가면 좋을까요?",
        "현재 복용약과 함께 확인해야 할 생활 습관이 있을까요?",
      ],
      disclaimer:
        "이 결과는 비식별 데모 문서를 기준으로 만든 예시이며 진단을 대신하지 않아요. 실제 내용은 원본과 의료진 설명으로 확인해주세요.",
      source: "demo",
    };
  }

  return {
    documentType,
    summary:
      "처방된 약의 이름과 먹는 방법을 보호자가 확인하기 쉬운 순서로 정리했어요.",
    findings: [
      { label: "약 이름", value: "노바스크정 5mg 외 2개" },
      { label: "먹는 방법", value: "아침 식사 후 1회, 아침·저녁 식사 후 2회" },
      { label: "처방 기간", value: "2026년 8월 12일부터 약별 처방 기간 확인 필요" },
    ],
    carePoints: [
      "처방전의 약 이름과 실제 약 봉투가 같은지 먼저 확인해주세요.",
      "어지러움이나 속 불편함처럼 평소와 다른 변화가 있으면 시간과 상황을 기록해주세요.",
    ],
    questionsForProfessional: [
      "먹는 시간을 놓쳤을 때는 어떻게 해야 하나요?",
      "현재 함께 먹는 약 중 따로 간격을 두어야 하는 약이 있나요?",
    ],
    disclaimer:
      "이 결과는 비식별 데모 문서를 기준으로 만든 예시이며 처방 변경이나 복용 중단을 안내하지 않아요. 실제 내용은 원본과 의사·약사 설명으로 확인해주세요.",
    source: "demo",
  };
}

function isDocumentAnalysis(value: unknown): value is DocumentAnalysis {
  if (!value || typeof value !== "object") return false;
  const analysis = value as Partial<DocumentAnalysis>;
  return (
    typeof analysis.summary === "string" &&
    Array.isArray(analysis.findings) &&
    analysis.findings.every(
      (finding) =>
        finding &&
        typeof finding === "object" &&
        typeof finding.label === "string" &&
        typeof finding.value === "string",
    ) &&
    Array.isArray(analysis.carePoints) &&
    analysis.carePoints.every((point) => typeof point === "string") &&
    Array.isArray(analysis.questionsForProfessional) &&
    analysis.questionsForProfessional.every((question) => typeof question === "string") &&
    typeof analysis.disclaimer === "string"
  );
}

/**
 * 제공자 독립 문서 분석 경계입니다. AI_ANALYSIS_ENDPOINT와 AI_API_KEY가 있으면
 * 외부 API를 호출하고, 없으면 해커톤용 비식별 데모 결과를 반환합니다.
 */
export async function analyzeMedicationDocument(
  input: MedicationAnalyzerInput,
): Promise<MedicationAnalyzerResult> {
  const endpoint = process.env.AI_ANALYSIS_ENDPOINT;
  const apiKey = process.env.AI_API_KEY;

  if (endpoint && apiKey) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`문서 분석 API가 ${response.status} 응답을 반환했습니다.`);
    }

    const body = (await response.json()) as { analysis?: unknown };
    if (!isDocumentAnalysis(body.analysis)) {
      throw new Error("문서 분석 API 응답 형식이 올바르지 않습니다.");
    }

    return {
      status: "complete",
      message: "문서 분석을 마쳤어요. 원본과 비교해 내용을 확인해주세요.",
      analysis: { ...body.analysis, documentType: input.documentType, source: "api" },
    };
  }

  return {
    status: "complete",
    message: "비식별 데모 분석을 마쳤어요. 실제 API를 연결하면 업로드한 문서를 분석해요.",
    analysis: demoAnalysis(input.documentType),
  };
}
