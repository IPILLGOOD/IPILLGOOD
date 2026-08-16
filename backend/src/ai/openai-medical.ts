import OpenAI from "openai";
import type {
  Response as OpenAIResponse,
  ResponseInputContent,
} from "openai/resources/responses/responses";

import type { DiseaseInformation, DiseaseReference, DocumentAnalysis } from "../types.ts";
import type {
  PharmacogenomicInfo,
  PlainMedicationExplanation,
} from "../official-medication-api.ts";

interface DocumentInput {
  documentType: "처방전" | "진단서";
  fileName: string;
  contentType: string;
  contentBase64: string;
}

interface DiseaseSearchPayload {
  matchedName: string;
  code: string;
  overview: string;
  practicalPoints: string[];
  warningSigns: string[];
}

interface PlainMedicationPayload {
  items: Array<PlainMedicationExplanation & { index: number }>;
}

const documentAnalysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          value: { type: "string" },
        },
        required: ["label", "value"],
      },
    },
    carePoints: { type: "array", items: { type: "string" } },
    questionsForProfessional: { type: "array", items: { type: "string" } },
    disclaimer: { type: "string" },
    diagnoses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          code: { type: "string" },
        },
        required: ["name", "code"],
      },
    },
  },
  required: [
    "summary",
    "findings",
    "carePoints",
    "questionsForProfessional",
    "disclaimer",
    "diagnoses",
  ],
} as const;

const diseaseSearchSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    matchedName: { type: "string" },
    code: { type: "string" },
    overview: { type: "string" },
    practicalPoints: { type: "array", items: { type: "string" } },
    warningSigns: { type: "array", items: { type: "string" } },
  },
  required: ["matchedName", "code", "overview", "practicalPoints", "warningSigns"],
} as const;

const plainMedicationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          index: { type: "integer" },
          categoryPlain: { type: "string" },
          overview: { type: "string" },
          geneInfo: { type: "string" },
          productInfo: { type: "string" },
          caregiverNote: { type: "string" },
        },
        required: [
          "index",
          "categoryPlain",
          "overview",
          "geneInfo",
          "productInfo",
          "caregiverNote",
        ],
      },
    },
  },
  required: ["items"],
} as const;

function getClient(apiKey = process.env.OPENAI_API_KEY): OpenAI {
  return new OpenAI({
    apiKey,
    timeout: 30_000,
    maxRetries: 1,
  });
}

function modelName(model = process.env.OPENAI_MODEL): string {
  return model ?? "gpt-5.6-luna";
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label} 응답을 JSON으로 해석하지 못했습니다.`);
  }
}

function documentContent(input: DocumentInput): ResponseInputContent[] {
  const fileData = `data:${input.contentType};base64,${input.contentBase64}`;
  const documentPart: ResponseInputContent =
    input.contentType === "application/pdf"
      ? {
          type: "input_file",
          filename: input.fileName,
          file_data: fileData,
          detail: "auto",
        }
      : {
          type: "input_image",
          image_url: fileData,
          detail: "high",
        };

  return [
    documentPart,
    {
      type: "input_text",
      text: [
        `첨부된 ${input.documentType}의 내용을 한국어로 정확히 추출해 보호자가 이해하기 쉽게 정리하세요.`,
        "문서에 실제로 적힌 내용만 사용하고, 불명확한 부분은 추측하지 마세요.",
        "진단서라면 diagnoses에 진단명과 KCD/ICD 코드를 각각 넣고, 코드가 없으면 빈 문자열을 넣으세요.",
        "처방전이라면 diagnoses는 빈 배열로 반환하세요.",
        "개인식별정보는 결과에 포함하지 마세요.",
      ].join("\n"),
    },
  ];
}

export async function analyzeClinicalDocumentWithOpenAI(
  input: DocumentInput,
): Promise<DocumentAnalysis> {
  const response = await getClient().responses.create({
    model: modelName(),
    store: false,
    reasoning: { effort: "low" },
    input: [{ role: "user", content: documentContent(input) }],
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "clinical_document_analysis",
        strict: true,
        schema: documentAnalysisSchema,
      },
    },
  });

  const parsed = parseJson<Omit<DocumentAnalysis, "documentType" | "source">>(
    response.output_text,
    "문서 분석",
  );
  return {
    ...parsed,
    diagnoses: parsed.diagnoses?.map((diagnosis) => ({
      name: diagnosis.name.trim(),
      ...(diagnosis.code?.trim() ? { code: diagnosis.code.trim() } : {}),
    })),
    documentType: input.documentType,
    source: "openai",
  };
}

function citationReferences(response: OpenAIResponse): DiseaseReference[] {
  const references = new Map<string, DiseaseReference>();
  const addReference = (url: string, title: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
      references.set(parsed.toString(), { title, url: parsed.toString() });
    } catch {
      // 유효한 웹 URL만 사용자에게 출처로 표시합니다.
    }
  };

  for (const item of response.output) {
    if (item.type === "message") {
      for (const content of item.content) {
        if (content.type !== "output_text") continue;
        for (const annotation of content.annotations) {
          if (annotation.type !== "url_citation") continue;
          addReference(annotation.url, annotation.title);
        }
      }
    }

    if (item.type === "web_search_call" && item.action.type === "search") {
      for (const source of item.action.sources ?? []) {
        if (references.has(source.url)) continue;
        let title = "의료 정보 출처";
        try {
          title = new URL(source.url).hostname.replace(/^www\./, "");
        } catch {
          // URL이 유효하지 않으면 일반 출처명으로 표시합니다.
        }
        addReference(source.url, title);
      }
    }
  }

  return [...references.values()].slice(0, 5);
}

export async function searchDiseaseWithOpenAI(
  query: string,
  code?: string,
): Promise<DiseaseInformation> {
  const response = await getClient().responses.create({
    model: modelName(),
    store: false,
    reasoning: { effort: "low" },
    tools: [
      {
        type: "web_search",
        search_context_size: "medium",
        filters: {
          allowed_domains: [
            "kdca.go.kr",
            "hira.or.kr",
            "nhis.or.kr",
            "snuh.org",
            "amc.seoul.kr",
            "severance.healthcare",
            "who.int",
            "cdc.gov",
            "medlineplus.gov",
          ],
        },
        user_location: {
          type: "approximate",
          country: "KR",
          timezone: "Asia/Seoul",
        },
      },
    ],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    input: [
      "다음 진단명에 대해 환자와 보호자가 이해할 수 있는 최신 질병 정보를 웹에서 검색하세요.",
      `진단명: ${query}`,
      code ? `질병코드: ${code}` : "질병코드: 문서에 없음",
      "공공기관, 대학병원, 국제 보건기관의 환자용 자료를 우선 사용하세요.",
      "진단이나 치료 지시를 새로 만들지 말고, 응급 신호는 출처에서 확인되는 내용만 포함하세요.",
      "결과는 한국어로 작성하세요.",
    ].join("\n"),
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "disease_information",
        strict: true,
        schema: diseaseSearchSchema,
      },
    },
  });

  const parsed = parseJson<DiseaseSearchPayload>(response.output_text, "질병 검색");
  const references = citationReferences(response);
  if (references.length === 0) {
    throw new Error("OpenAI 웹 검색에서 확인 가능한 출처를 받지 못했습니다.");
  }

  return {
    query,
    matchedName: parsed.matchedName,
    ...(parsed.code.trim() ? { code: parsed.code.trim() } : code ? { code } : {}),
    overview: parsed.overview,
    practicalPoints: parsed.practicalPoints,
    warningSigns: parsed.warningSigns,
    source: "openai_web",
    sourceLabel: "OpenAI 웹 검색 · 의료기관/공공기관 출처",
    references,
  };
}

export async function simplifyMedicationInformationWithOpenAI(
  items: PharmacogenomicInfo[],
  options: { apiKey?: string; model?: string } = {},
): Promise<PharmacogenomicInfo[]> {
  if (items.length === 0) return items;

  const sourceItems = items.slice(0, 10).map((item, index) => ({
    index,
    koreanName: item.koreanName,
    englishName: item.englishName,
    generalInfo: item.generalInfo.slice(0, 4_000),
    pharmacogenomicInfo: item.pharmacogenomicInfo.slice(0, 4_000),
    productInfo: item.productInfo.slice(0, 4_000),
  }));
  const response = await getClient(options.apiKey).responses.create({
    model: modelName(options.model),
    store: false,
    reasoning: { effort: "low" },
    instructions: [
      "식약처 공식 약물 정보를 고령자 보호자가 이해하기 쉬운 한국어로 바꾸는 설명자입니다.",
      "제공된 원문 안의 사실만 사용하고 새로운 효능, 부작용, 복용법을 만들지 마세요.",
      "중학생이 한 번에 이해할 수 있는 일상 표현만 사용하세요.",
      "질병명, 의학 전문 용어, 유전자 기호, 검사 약어를 원문 그대로 나열하지 마세요.",
      "전문명이 꼭 필요하면 쉬운 뜻을 먼저 쓰고 전문명은 괄호 안에 한 번만 적으세요.",
      "예: 정맥혈전증은 '피가 굳어 혈관을 막는 문제', PT/INR은 '피가 굳는 데 걸리는 시간을 보는 혈액검사'로 설명하세요.",
      "CYP2C9, VKORC1 같은 유전자 이름은 쓰지 말고 '몸이 약을 처리하는 타고난 차이'라고 설명하세요.",
      "제품명과 성분명은 사용자가 확인해야 하므로 원문 이름을 유지해도 됩니다.",
      "categoryPlain에는 이 약의 대표적인 대분류를 '감기약', '혈압약', '소화제', '진통제', '항응고제'처럼 짧고 쉬운 말 하나로 적으세요. 원문만으로 판단할 수 없으면 '분류 확인 필요'라고 적으세요.",
      "productInfo에는 제품명 목록이나 함량 숫자를 길게 나열하지 말고, 같은 성분의 여러 제품과 함량이 있다는 의미만 요약하세요.",
      "caregiverNote에는 원문 속 권장 용량 숫자를 반복하지 말고 처방전에 적힌 양을 따르며 의료진에게 확인하라고 안내하세요.",
      "유전자 정보가 원문에 없으면 geneInfo는 빈 문자열로 반환하세요.",
      "약을 끊거나 양을 바꾸라는 지시는 하지 말고, 판단이 필요한 내용은 의사나 약사에게 확인하도록 안내하세요.",
      "각 설명은 짧은 문장 2~3개 이내로 작성하세요.",
    ].join("\n"),
    input: JSON.stringify(sourceItems),
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "plain_medication_information",
        strict: true,
        schema: plainMedicationSchema,
      },
    },
  });

  const parsed = parseJson<PlainMedicationPayload>(response.output_text, "약물 쉬운 설명");
  const explanations = new Map(
    parsed.items
      .filter(
        (item) =>
          Number.isInteger(item.index) && item.index >= 0 && item.index < sourceItems.length,
      )
      .map((item) => [item.index, item]),
  );

  const enrichedItems = items.map((item, index) => {
    const explanation = explanations.get(index);
    if (!explanation) return item;
    return {
      ...item,
      plainExplanation: {
        categoryPlain: explanation.categoryPlain.trim(),
        overview: explanation.overview.trim(),
        geneInfo: explanation.geneInfo.trim(),
        productInfo: explanation.productInfo.trim(),
        caregiverNote: explanation.caregiverNote.trim(),
      },
    };
  });
  if (enrichedItems.slice(0, sourceItems.length).some((item) => !item.plainExplanation)) {
    throw new Error("약물 쉬운 설명 일부가 누락됐습니다.");
  }
  return enrichedItems;
}
