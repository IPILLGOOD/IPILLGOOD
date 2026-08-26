import type { ClinicalDocumentType, DiseaseInformation, DocumentAnalysis } from "../types.ts";
import { searchOfficialDiseaseInfo } from "../official-disease-api.ts";

import {
  analyzeClinicalDocumentWithOpenAI,
  searchDiseaseWithOpenAI,
} from "./openai-medical.ts";

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

export class DocumentAnalysisNotConfiguredError extends Error {
  readonly code = "DOCUMENT_ANALYSIS_NOT_CONFIGURED";

  constructor() {
    super("실제 문서 분석 API가 설정되지 않았습니다.");
    this.name = "DocumentAnalysisNotConfiguredError";
  }
}

export class DocumentAnalysisIncompleteError extends Error {
  readonly code = "DOCUMENT_ANALYSIS_INCOMPLETE";

  constructor(documentType: ClinicalDocumentType) {
    super(`${documentType}에서 필수 구조화 정보를 찾지 못했습니다.`);
    this.name = "DocumentAnalysisIncompleteError";
  }
}

type MedicationAnalyzerDependencies = {
  analyzeClinicalDocumentWithOpenAI: typeof analyzeClinicalDocumentWithOpenAI;
};

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
      diagnoses: [{ name: "고혈압", code: "I10" }],
      diseaseInformation: [
        {
          query: "고혈압",
          matchedName: "고혈압",
          code: "I10",
          overview:
            "비식별 샘플에서 고혈압 진단을 확인한 예시예요. 실제 문서에서는 공식 질병 API를 먼저 조회하고, 일치하지 않으면 OpenAI 웹 검색으로 정보를 보완해요.",
          practicalPoints: ["혈압 기록과 복용 중인 약 목록을 다음 진료 때 함께 확인하세요."],
          warningSigns: [],
          source: "demo",
          sourceLabel: "비식별 데모",
          references: [],
        },
      ],
      diseaseLookup: {
        status: "official_match",
        message: "데모에서는 공식 질병 API 매칭 흐름을 예시로 보여드려요.",
      },
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
    medications: [
      {
        productName: "노바스크정 5mg",
        ingredientName: "암로디핀",
        doseAmount: "한 번에 1정",
        frequency: "하루 1회",
        timing: "아침 식사 후",
        startDate: "2026-08-12",
        purposePlain: "혈압이 너무 높아지지 않도록 도와줘요.",
        precautions: ["평소보다 많이 어지러운지 확인해주세요."],
      },
      {
        productName: "쎄레브렉스캡슐 100mg",
        ingredientName: "세레콕시브",
        doseAmount: "한 번에 1캡슐",
        frequency: "하루 2회",
        timing: "아침·저녁 식사 후",
        startDate: "2026-08-12",
        endDate: "2026-08-18",
        purposePlain: "무릎의 통증과 붓는 느낌을 줄이는 데 사용돼요.",
        precautions: ["속이 많이 쓰리거나 아픈지 확인해주세요."],
      },
      {
        productName: "리피토정 10mg",
        ingredientName: "아토르바스타틴",
        doseAmount: "한 번에 1정",
        frequency: "하루 1회",
        timing: "저녁 식사 후",
        startDate: "2026-08-12",
        purposePlain: "혈액 속 기름 성분을 관리하는 데 사용돼요.",
        precautions: ["이유 없이 근육이 많이 아픈지 확인해주세요."],
      },
    ],
  };
}

function diagnosisCandidates(
  analysis: DocumentAnalysis,
): Array<{ name: string; code?: string }> {
  const explicit = (analysis.diagnoses ?? [])
    .map((diagnosis) => ({ name: diagnosis.name.trim(), code: diagnosis.code?.trim() }))
    .filter((diagnosis) => diagnosis.name.length >= 2);
  if (explicit.length > 0) return explicit.slice(0, 3);

  return analysis.findings
    .filter((finding) => /진단|상병|질병|병명|확인된 내용/.test(finding.label))
    .flatMap((finding) => finding.value.split(/[,;/\n]/))
    .map((name) => ({ name: name.replace(/\s*\([A-Z][A-Z0-9.]+\)\s*/i, " ").trim() }))
    .filter((diagnosis) => diagnosis.name.length >= 2 && diagnosis.name.length <= 60)
    .slice(0, 3);
}

function analysisNeedsRetry(analysis: DocumentAnalysis) {
  if (analysis.documentType === "처방전") {
    return !(analysis.medications ?? []).some((medication) => medication.productName.trim());
  }
  return diagnosisCandidates(analysis).length === 0;
}

function withStructuredEvidenceFindings(analysis: DocumentAnalysis): DocumentAnalysis {
  const evidenceNames = analysis.documentType === "처방전"
    ? (analysis.medications ?? []).map((medication) => medication.productName.trim())
    : diagnosisCandidates(analysis).map((diagnosis) => diagnosis.name);
  const existingText = analysis.findings.map((finding) => finding.value).join(" ");
  const missingNames = [...new Set(evidenceNames.filter(Boolean))].filter(
    (name) => !existingText.includes(name),
  );
  if (missingNames.length === 0) return analysis;

  return {
    ...analysis,
    findings: [
      ...analysis.findings,
      {
        label: analysis.documentType === "처방전" ? "확인된 약 이름" : "확인된 진단명",
        value: missingNames.join(", "),
      },
    ],
  };
}

async function enrichDiagnosisAnalysis(analysis: DocumentAnalysis): Promise<DocumentAnalysis> {
  if (analysis.documentType !== "진단서" || analysis.source === "demo") return analysis;

  const candidates = diagnosisCandidates(analysis);
  if (candidates.length === 0) {
    return {
      ...analysis,
      diseaseLookup: {
        status: "no_diagnosis",
        message: "진단서에서 조회할 수 있는 진단명이나 질병코드를 찾지 못했어요.",
      },
    };
  }

  const lookupResults = await Promise.all(
    candidates.map(async (candidate) => {
      const official = await searchOfficialDiseaseInfo(candidate.name, candidate.code);
      if (official.status === "matched") {
        const information: DiseaseInformation = {
          query: candidate.name,
          matchedName: official.item.koreanName,
          code: official.item.code,
          overview: official.item.englishName
            ? `건강보험심사평가원 질병정보에서 KCD 코드 ${official.item.code}, 영문명 ${official.item.englishName}(으)로 확인됐어요.`
            : `건강보험심사평가원 질병정보에서 KCD 코드 ${official.item.code}(으)로 확인됐어요.`,
          practicalPoints: [
            "진단서의 질병명과 질병코드가 공식 정보와 같은지 원본에서 다시 확인해주세요.",
          ],
          warningSigns: [],
          source: "official_api",
          sourceLabel: "건강보험심사평가원 질병정보 API",
          references: [
            {
              title: "건강보험심사평가원 질병정보서비스",
              url: official.sourceUrl,
            },
          ],
        };
        return { route: "official" as const, information };
      }

      if (!process.env.OPENAI_API_KEY) return { route: "none" as const };
      try {
        return {
          route: "openai" as const,
          information: await searchDiseaseWithOpenAI(candidate.name, candidate.code),
        };
      } catch (error) {
        console.error("OpenAI disease search failed", error);
        return { route: "failed" as const };
      }
    }),
  );
  const diseaseInformation = lookupResults.flatMap((result) =>
    result.information ? [result.information] : [],
  );
  const usedOpenAI = lookupResults.some((result) => result.route === "openai");
  const officialMatches = lookupResults.filter((result) => result.route === "official").length;
  const lookupFailed = lookupResults.some((result) => result.route === "failed");

  if (diseaseInformation.length === 0) {
    return {
      ...analysis,
      diseaseLookup: {
        status: process.env.OPENAI_API_KEY && lookupFailed ? "failed" : "not_configured",
        message: process.env.OPENAI_API_KEY
          ? "공식 API와 OpenAI 웹 검색에서 확인 가능한 질병 정보를 찾지 못했어요."
          : "공식 API가 일치하지 않았고 OpenAI API 키가 없어 웹 검색으로 전환하지 못했어요.",
      },
    };
  }

  return {
    ...analysis,
    diseaseInformation,
    diseaseLookup: usedOpenAI
      ? {
          status: "openai_fallback",
          message:
            officialMatches > 0
              ? "공식 API 매칭 결과와 OpenAI 웹 검색 결과를 함께 사용했어요."
              : "공식 API에서 일치 항목을 찾지 못해 OpenAI 웹 검색으로 전환했어요.",
        }
      : {
          status: "official_match",
          message: "건강보험심사평가원 질병정보 API에서 일치하는 정보를 찾았어요.",
        },
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
    (analysis.diagnoses === undefined ||
      (Array.isArray(analysis.diagnoses) &&
        analysis.diagnoses.every(
          (diagnosis) =>
            diagnosis &&
            typeof diagnosis === "object" &&
            typeof diagnosis.name === "string" &&
            (diagnosis.code === undefined || typeof diagnosis.code === "string"),
        ))) &&
    (analysis.medications === undefined ||
      (Array.isArray(analysis.medications) &&
        analysis.medications.every(
          (medication) =>
            medication &&
            typeof medication === "object" &&
            typeof medication.productName === "string" &&
            typeof medication.ingredientName === "string" &&
            typeof medication.doseAmount === "string" &&
            typeof medication.frequency === "string" &&
            typeof medication.timing === "string" &&
            typeof medication.startDate === "string" &&
            (medication.endDate === undefined || typeof medication.endDate === "string") &&
            typeof medication.purposePlain === "string" &&
            Array.isArray(medication.precautions) &&
            medication.precautions.every((item) => typeof item === "string"),
        ))) &&
    typeof analysis.disclaimer === "string"
  );
}

/**
 * 제공자 독립 문서 분석 경계입니다. AI_ANALYSIS_ENDPOINT와 AI_API_KEY가 있으면
 * 외부 API를 호출하고, 없으면 해커톤용 비식별 데모 결과를 반환합니다.
 */
export async function analyzeMedicationDocument(
  input: MedicationAnalyzerInput,
  dependencies: MedicationAnalyzerDependencies = { analyzeClinicalDocumentWithOpenAI },
): Promise<MedicationAnalyzerResult> {
  const endpoint = process.env.AI_ANALYSIS_ENDPOINT;
  const apiKey = process.env.AI_API_KEY;

  if (!input.contentBase64) {
    return {
      status: "complete",
      message: "비식별 데모 분석을 마쳤어요. 실제 API를 연결하면 업로드한 문서를 분석해요.",
      analysis: demoAnalysis(input.documentType),
    };
  }

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

    const structuredAnalysis = withStructuredEvidenceFindings({
      ...body.analysis,
      documentType: input.documentType,
      source: "api",
    });
    if (analysisNeedsRetry(structuredAnalysis)) {
      throw new DocumentAnalysisIncompleteError(input.documentType);
    }
    const analysis = await enrichDiagnosisAnalysis(structuredAnalysis);
    return {
      status: "complete",
      message:
        input.documentType === "진단서"
          ? "진단서 분석과 질병 정보 조회를 마쳤어요. 원본과 출처를 함께 확인해주세요."
          : "문서 분석을 마쳤어요. 원본과 비교해 내용을 확인해주세요.",
      analysis,
    };
  }

  if (process.env.OPENAI_API_KEY) {
    let structuredAnalysis = await dependencies.analyzeClinicalDocumentWithOpenAI({
      ...input,
      contentBase64: input.contentBase64,
    });
    if (analysisNeedsRetry(structuredAnalysis)) {
      structuredAnalysis = await dependencies.analyzeClinicalDocumentWithOpenAI({
        ...input,
        contentBase64: input.contentBase64,
      });
    }
    if (analysisNeedsRetry(structuredAnalysis)) {
      throw new DocumentAnalysisIncompleteError(input.documentType);
    }
    const analysis = await enrichDiagnosisAnalysis(
      withStructuredEvidenceFindings(structuredAnalysis),
    );
    return {
      status: "complete",
      message:
        input.documentType === "진단서"
          ? "진단서 분석과 질병 정보 조회를 마쳤어요. 원본과 출처를 함께 확인해주세요."
          : "OpenAI 문서 분석을 마쳤어요. 원본과 비교해 내용을 확인해주세요.",
      analysis,
    };
  }

  throw new DocumentAnalysisNotConfiguredError();
}
