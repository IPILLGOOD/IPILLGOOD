import OpenAI from "openai";
import type {
  Response as OpenAIResponse,
  ResponseInputContent,
} from "openai/resources/responses/responses";

import type {
  ConfirmedCondition,
  DiseaseInformation,
  DiseaseReference,
  DocumentAnalysis,
  MedicationEvidenceField,
  NutritionInsight,
} from "../types.ts";
import type {
  PharmacogenomicInfo,
  PlainMedicationExplanation,
} from "../official-medication-api.ts";
import type {
  OfficialMedicationPlainExplanation,
  OfficialMedicationSearchItem,
} from "../official-medication-search.ts";

interface DocumentInput {
  documentType: "처방전" | "진단서";
  fileName: string;
  contentType: string;
  contentBase64: string;
  retryFocus?: string[];
}

interface CoreDocumentExtraction {
  prescriptionDate: string;
  totalSupplyDays: number;
  diagnoses: Array<{ name: string; code: string }>;
  medications: Array<{
    sourceRow: number;
    productName: string;
    ingredientName: string;
    mfdsItemSeq: string;
    insuranceCode: string;
    doseAmount: string;
    frequency: string;
    timing: string;
    startDate: string;
    endDate: string;
    supplyDays: number;
  }>;
}

interface DiseaseSearchPayload {
  matchedName: string;
  code: string;
  overview: string;
  practicalPoints: string[];
  warningSigns: string[];
}

interface NutritionSearchPayload {
  topics: Array<{
    nutrientName: string;
    title: string;
    summary: string;
    foodExamples: string[];
    supplementGuidance: string;
    professionalQuestion: string;
  }>;
}

interface PlainMedicationPayload {
  items: Array<PlainMedicationExplanation & { index: number }>;
}

interface MedicationSearchPlainPayload {
  items: Array<OfficialMedicationPlainExplanation & { index: number }>;
}

const documentExtractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    prescriptionDate: { type: "string" },
    totalSupplyDays: { type: "integer" },
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
    medications: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sourceRow: { type: "integer", minimum: 1 },
          productName: { type: "string" },
          ingredientName: { type: "string" },
          mfdsItemSeq: { type: "string" },
          insuranceCode: { type: "string" },
          doseAmount: { type: "string" },
          frequency: { type: "string" },
          timing: { type: "string" },
          startDate: { type: "string" },
          endDate: { type: "string" },
          supplyDays: { type: "integer" },
        },
        required: [
          "sourceRow",
          "productName",
          "ingredientName",
          "mfdsItemSeq",
          "insuranceCode",
          "doseAmount",
          "frequency",
          "timing",
          "startDate",
          "endDate",
          "supplyDays",
        ],
      },
    },
  },
  required: [
    "prescriptionDate",
    "totalSupplyDays",
    "diagnoses",
    "medications",
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

const nutritionSearchSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    topics: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          nutrientName: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          foodExamples: { type: "array", items: { type: "string" }, maxItems: 4 },
          supplementGuidance: { type: "string" },
          professionalQuestion: { type: "string" },
        },
        required: ["nutrientName", "title", "summary", "foodExamples", "supplementGuidance", "professionalQuestion"],
      },
    },
  },
  required: ["topics"],
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

const medicationSearchPlainSchema = {
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
          usagePlain: { type: "string" },
          safetyPlain: { type: "string" },
          genePlain: { type: "string" },
          caregiverNote: { type: "string" },
        },
        required: [
          "index",
          "categoryPlain",
          "overview",
          "usagePlain",
          "safetyPlain",
          "genePlain",
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

function positiveInteger(value: number): number | undefined {
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function digitsOnly(value: string): string | undefined {
  const normalized = value.replace(/\D/g, "");
  return normalized || undefined;
}

function medicationEvidence(
  medication: CoreDocumentExtraction["medications"][number],
): NonNullable<DocumentAnalysis["medications"]>[number]["fieldEvidence"] {
  const values: Array<[
    MedicationEvidenceField,
    string | number | undefined,
  ]> = [
    ["productName", medication.productName],
    ["ingredientName", medication.ingredientName],
    ["mfdsItemSeq", medication.mfdsItemSeq],
    ["insuranceCode", medication.insuranceCode],
    ["doseAmount", medication.doseAmount],
    ["frequency", medication.frequency],
    ["timing", medication.timing],
    ["startDate", medication.startDate],
    ["endDate", medication.endDate],
    ["supplyDays", positiveInteger(medication.supplyDays)],
  ];

  return values.flatMap(([field, value]) => {
    const sourceText = String(value ?? "").trim();
    return sourceText ? [{ field, sourceText }] : [];
  });
}

function documentAnalysisFromExtraction(
  documentType: DocumentInput["documentType"],
  parsed: CoreDocumentExtraction,
): DocumentAnalysis {
  const prescriptionDate = parsed.prescriptionDate.trim() || undefined;
  const totalSupplyDays = positiveInteger(parsed.totalSupplyDays);
  const diagnoses = parsed.diagnoses.flatMap((diagnosis) => {
    const name = diagnosis.name.trim();
    if (!name) return [];
    const code = diagnosis.code.trim();
    return [{ name, ...(code ? { code } : {}) }];
  });
  const medications = parsed.medications.map((medication, index) => {
    const mfdsItemSeq = digitsOnly(medication.mfdsItemSeq);
    const insuranceCode = digitsOnly(medication.insuranceCode);
    const productName = medication.productName.trim();
    const ingredientName = medication.ingredientName.trim();
    const doseAmount = medication.doseAmount.trim();
    const frequency = medication.frequency.trim();
    const timing = medication.timing.trim();
    const startDate = medication.startDate.trim();
    const endDate = medication.endDate.trim();

    return {
      productName,
      ingredientName,
      ...(mfdsItemSeq ? { mfdsItemSeq, itemCode: mfdsItemSeq } : {}),
      ...(insuranceCode ? { insuranceCode } : {}),
      doseAmount,
      frequency,
      timing,
      startDate,
      ...(endDate ? { endDate } : {}),
      ...(positiveInteger(medication.supplyDays)
        ? { supplyDays: positiveInteger(medication.supplyDays) }
        : {}),
      sourceRow: positiveInteger(medication.sourceRow) ?? index + 1,
      purposePlain: "처방 목적은 원본 문서와 의료진에게 확인하세요.",
      precautions: [],
      fieldEvidence: medicationEvidence(medication),
    };
  });

  if (documentType === "진단서") {
    return {
      documentType,
      source: "openai",
      summary: diagnoses.length
        ? `${diagnoses.length}개의 진단 정보를 문서에서 추출했습니다.`
        : "문서에서 진단 정보를 확인하지 못했습니다.",
      findings: diagnoses.map((diagnosis) => ({
        label: "확인된 진단명",
        value: diagnosis.code ? `${diagnosis.name} (${diagnosis.code})` : diagnosis.name,
      })),
      carePoints: ["진단명과 코드를 원본 문서와 대조해 주세요."],
      questionsForProfessional: ["추출된 진단 정보가 현재 진료 내용과 일치하나요?"],
      disclaimer: "자동 추출 결과이며 원본 문서와 의료진의 확인을 우선하세요.",
      diagnoses,
      medications: [],
    };
  }

  return {
    documentType,
    source: "openai",
    summary: medications.length
      ? `${medications.length}개의 처방약 정보를 문서에서 추출했습니다.`
      : "문서에서 처방약 정보를 확인하지 못했습니다.",
    findings: medications.flatMap((medication) =>
      medication.productName
        ? [{ label: "확인된 약 이름", value: medication.productName }]
        : [],
    ),
    carePoints: ["약 이름, 복용량, 횟수와 기간을 원본 처방전과 대조해 주세요."],
    questionsForProfessional: ["추출된 복용법과 투약 기간이 현재 처방과 일치하나요?"],
    disclaimer: "자동 추출 결과이며 원본 처방전과 의료진의 확인을 우선하세요.",
    ...(prescriptionDate ? { prescriptionDate } : {}),
    ...(totalSupplyDays ? { totalSupplyDays } : {}),
    diagnoses: [],
    medications,
  };
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
        `첨부된 ${input.documentType}에서 핵심 행과 컬럼의 원문 값만 추출하세요.`,
        "문서에 실제로 적힌 내용만 사용하고, 불명확하거나 없는 값은 추측하지 마세요.",
        "진단서라면 diagnoses에 진단명과 KCD/ICD 코드를 각각 넣고, 코드가 없으면 빈 문자열을 넣으세요.",
        "처방전이라면 diagnoses는 빈 배열로 반환하세요.",
        "처방전이라면 표의 위쪽부터 약 한 행을 medications 한 항목으로 만들고 sourceRow를 1부터 순서대로 넣으세요. 진단서라면 medications는 빈 배열로 반환하세요.",
        "약품명·제품명은 productName, 성분명은 ingredientName에 넣으세요.",
        "품목기준코드는 mfdsItemSeq, 보험코드는 insuranceCode에 숫자만 넣으세요. 두 코드를 서로 바꾸거나 하나로 합치지 마세요.",
        "1회 투약량·복용량은 doseAmount, 1일 투여횟수는 frequency, 용법·복용방법은 timing에 원문대로 넣으세요.",
        "행별 투약일수·총 투여일수가 있으면 supplyDays에 양의 정수로 넣으세요. 확인할 수 없으면 0으로 쓰세요.",
        "처방전의 발행일을 prescriptionDate에 YYYY-MM-DD로 넣고, 확인할 수 없으면 빈 문자열로 쓰세요.",
        "모든 약에 공통인 총 투약일수만 totalSupplyDays에 양의 정수로 넣으세요. 행별 기간이 다르거나 확인할 수 없으면 0으로 쓰세요. 진단서는 prescriptionDate를 빈 문자열, totalSupplyDays를 0으로 쓰세요.",
        "복용 시작일과 종료일은 YYYY-MM-DD로 쓰고, 문서에 종료일이 없으면 endDate를 빈 문자열로 쓰세요.",
        "문서에 없는 문자열 필드는 빈 문자열, 없는 숫자 필드는 0으로 반환하세요.",
        ...(input.retryFocus?.length
          ? [`이전 추출에서 다음 항목이 누락되었습니다. 해당 행과 컬럼만 다시 자세히 확인하세요: ${input.retryFocus.join(", ")}`]
          : []),
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
        name: "clinical_document_extraction",
        strict: true,
        schema: documentExtractionSchema,
      },
    },
  });

  const parsed = parseJson<CoreDocumentExtraction>(
    response.output_text,
    "문서 분석",
  );
  return documentAnalysisFromExtraction(input.documentType, parsed);
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

export async function searchNutritionWithOpenAI(
  condition: ConfirmedCondition,
  medicationIngredients: string[] = [],
): Promise<NutritionInsight[]> {
  const response = await getClient().responses.create({
    model: modelName(),
    store: false,
    reasoning: { effort: "low" },
    tools: [{
      type: "web_search",
      search_context_size: "medium",
      filters: { allowed_domains: [
        "kdca.go.kr", "hira.or.kr", "nhis.or.kr", "mfds.go.kr", "foodsafetykorea.go.kr",
        "nice.org.uk", "ods.od.nih.gov", "who.int", "medlineplus.gov",
      ] },
      user_location: { type: "approximate", country: "KR", timezone: "Asia/Seoul" },
    }],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    input: [
      "다음 확정 질환과 관련해 환자가 식사에서 고려할 영양 주제를 공식 출처에서 검색하세요.",
      `질환: ${condition.standardName} (${condition.code})`,
      medicationIngredients.length > 0
        ? `현재 복용약 성분: ${medicationIngredients.join(", ")}`
        : "현재 복용약 성분: 등록된 정보 없음",
      "근거가 확인되는 영양소 또는 식품군만 최대 3개 제시하세요. 한국 식생활에서 가능한 음식 예시를 쓰세요.",
      "현재 복용약과의 음식·영양 상호작용도 공식 출처로 확인하고, 안전성을 판단할 정보가 부족하거나 충돌 가능성이 있는 주제는 제안에서 제외하세요.",
      "결핍을 진단하거나 치료 효과를 약속하지 마세요. 용량, 제품, 브랜드를 추천하지 마세요.",
      "보충제는 식품보다 우선하지 말고, 복용약·신장/간 기능·검사 결과를 모르므로 반드시 전문가 확인 문구를 포함하세요.",
      "출처에서 질환별 영양 권고를 찾지 못하면 topics를 빈 배열로 반환하세요. 결과는 한국어로 작성하세요.",
    ].join("\n"),
    text: { verbosity: "low", format: { type: "json_schema", name: "nutrition_guidance", strict: true, schema: nutritionSearchSchema } },
  });
  const parsed = parseJson<NutritionSearchPayload>(response.output_text, "영양 정보 검색");
  const references = citationReferences(response);
  if (references.length === 0) throw new Error("AI 영양 정보 검색에서 확인 가능한 출처를 받지 못했습니다.");
  const reviewedAt = new Date().toISOString().slice(0, 10);
  const evidence = references.map((reference) => ({
    ...reference,
    sourceVersion: "검색 시점의 공식 웹 문서",
    evidenceLevel: "ai_web_source" as const,
    lastReviewedAt: reviewedAt,
    reviewer: "AI 검색 결과 · 전문가 검수 전",
  }));
  return parsed.topics.map((topic, index) => ({
    id: `ai-${condition.id}-${index}`,
    kind: "food",
    status: "professional_confirmation",
    source: "ai_web",
    nutrientName: topic.nutrientName,
    title: topic.title,
    summary: topic.summary,
    supplementGuidance: topic.supplementGuidance,
    foodExamples: topic.foodExamples,
    triggerConditions: [condition],
    relatedSupplementIngredientIds: [],
    matchedMedicationIds: [],
    matchedMedicationNames: [],
    currentSupplementNames: [],
    professionalQuestion: topic.professionalQuestion,
    evidence,
    lastReviewedAt: reviewedAt,
  }));
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

export async function simplifyOfficialMedicationSearchItemsWithOpenAI(
  items: OfficialMedicationSearchItem[],
  options: { apiKey?: string; model?: string } = {},
): Promise<OfficialMedicationSearchItem[]> {
  const sourceItems = items.flatMap((item, index) => {
    if (!item.consumerInfo && !item.pharmacogenomicInfo) return [];
    return [{
      index,
      productName: item.productName,
      ingredientName: item.ingredientName,
      classification: item.classification,
      productType: item.productType,
      officialSource: item.consumerInfo?.source ?? "pharmacogenomic",
      efficacy: item.consumerInfo?.efficacy.slice(0, 5_000) ?? "",
      usage: item.consumerInfo?.usage.slice(0, 5_000) ?? "",
      warning: [item.consumerInfo?.warning, item.consumerInfo?.precautions]
        .filter(Boolean)
        .join("\n")
        .slice(0, 7_000),
      interactions: item.consumerInfo?.interactions.slice(0, 3_000) ?? "",
      adverseEffects: item.consumerInfo?.adverseEffects.slice(0, 3_000) ?? "",
      storage: item.consumerInfo?.storage.slice(0, 1_000) ?? "",
      pharmacogenomicGeneral: item.pharmacogenomicInfo?.generalInfo.slice(0, 4_000) ?? "",
      pharmacogenomicGene: item.pharmacogenomicInfo?.geneInfo.slice(0, 4_000) ?? "",
    }];
  });
  if (sourceItems.length === 0) return items;

  const response = await getClient(options.apiKey).responses.create({
    model: modelName(options.model),
    store: false,
    reasoning: { effort: "low" },
    instructions: [
      "식약처 공식 의약품 원문을 고령자와 보호자가 이해하기 쉬운 한국어로 바꾸는 설명자입니다.",
      "입력된 공식 원문 안의 사실만 사용하고 효능, 진단, 부작용, 복용량을 새로 만들거나 추측하지 마세요.",
      "overview에는 대표 효능을 짧게 설명하고, 원문에 효능이 없으면 빈 문자열로 반환하세요.",
      "usagePlain에는 일반 허가 용법의 의미만 설명하세요. 개인이 먹어야 할 양이나 횟수로 단정하지 마세요.",
      "safetyPlain에는 중요한 금기와 주의사항을 쉬운 말로 요약하세요. 원문에 없으면 빈 문자열로 반환하세요.",
      "genePlain에는 약물유전 원문이 있을 때만 타고난 약물 반응 차이를 쉽게 설명하고, 없으면 빈 문자열로 반환하세요.",
      "categoryPlain에는 혈압약, 진통제, 항응고제처럼 짧은 분류를 적고 근거가 부족하면 '분류 확인 필요'라고 적으세요.",
      "caregiverNote에는 처방전의 복용 지시를 우선하고 임의로 중단하거나 양을 바꾸지 말라는 안내를 짧게 적으세요.",
      "전문 용어가 꼭 필요하면 쉬운 뜻을 먼저 쓰고 전문명은 괄호 안에 한 번만 적으세요.",
      "각 필드는 짧은 문장 2~3개 이내로 작성하세요.",
    ].join("\n"),
    input: JSON.stringify(sourceItems),
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "plain_official_medication_search",
        strict: true,
        schema: medicationSearchPlainSchema,
      },
    },
  });

  const parsed = parseJson<MedicationSearchPlainPayload>(
    response.output_text,
    "통합 약 검색 쉬운 설명",
  );
  const explanations = new Map(
    parsed.items
      .filter((item) => sourceItems.some((source) => source.index === item.index))
      .map((item) => [item.index, item]),
  );
  if (sourceItems.some((source) => !explanations.has(source.index))) {
    throw new Error("통합 약 검색 쉬운 설명 일부가 누락됐습니다.");
  }

  return items.map((item, index) => {
    const explanation = explanations.get(index);
    if (!explanation) return item;
    return {
      ...item,
      plainExplanation: {
        categoryPlain: explanation.categoryPlain.trim(),
        overview: explanation.overview.trim(),
        usagePlain: explanation.usagePlain.trim(),
        safetyPlain: explanation.safetyPlain.trim(),
        genePlain: explanation.genePlain.trim(),
        caregiverNote: explanation.caregiverNote.trim(),
      },
    };
  });
}
