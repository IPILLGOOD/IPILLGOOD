import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import {
  analyzeMedicationDocument,
  DocumentAnalysisNotConfiguredError,
} from "./ai/medication-analyzer.ts";
import type { DocumentAnalysis, PrescriptionMedication } from "./types.ts";

const evidence = (confidence = 0.98) => ([
  { field: "productName" as const, sourceText: "노바스크정 5mg", confidence },
  { field: "ingredientName" as const, sourceText: "암로디핀베실산염", confidence },
  { field: "doseAmount" as const, sourceText: "1정", confidence },
  { field: "frequency" as const, sourceText: "1일 1회", confidence },
  { field: "timing" as const, sourceText: "아침 식후", confidence },
]);

const matchedOfficialMedication = {
  status: "matched" as const,
  sourceUrl: "https://www.data.go.kr/data/15095677/openapi.do",
  item: {
    itemSeq: "200001234",
    productName: "노바스크정 5mg",
    englishName: "Norvasc Tab. 5mg",
    ingredientName: "암로디핀베실산염",
    manufacturer: "한국화이자제약(주)",
    classification: "전문의약품",
    productType: "혈압강하제",
    matchType: "product_name" as const,
    sources: [],
  },
};

test("외부 문서 분석 API의 구조화 응답을 실제 분석 결과로 사용한다", async (context) => {
  const previousEndpoint = process.env.AI_ANALYSIS_ENDPOINT;
  const previousApiKey = process.env.AI_API_KEY;
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  process.env.AI_ANALYSIS_ENDPOINT = "https://analysis.example.test/v1/document";
  process.env.AI_API_KEY = "test-analysis-key";
  delete process.env.OPENAI_API_KEY;
  context.after(() => {
    if (previousEndpoint === undefined) delete process.env.AI_ANALYSIS_ENDPOINT;
    else process.env.AI_ANALYSIS_ENDPOINT = previousEndpoint;
    if (previousApiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousApiKey;
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
  });

  let receivedAuthorization = "";
  context.mock.method(globalThis, "fetch", async (_input, init) => {
    receivedAuthorization = String(new Headers(init?.headers).get("authorization"));
    return new Response(
      JSON.stringify({
        analysis: {
          summary: "처방전에서 약 1개를 확인했어요.",
          findings: [{ label: "약 이름", value: "테스트정 5mg" }],
          carePoints: ["원본과 비교하세요."],
          questionsForProfessional: ["복용 시간을 확인해주세요."],
          disclaimer: "의료진 확인이 필요합니다.",
          diagnoses: [],
          medications: [
            {
              productName: "테스트정 5mg",
              ingredientName: "테스트 성분",
              doseAmount: "한 번에 1정",
              frequency: "하루 1회",
              timing: "아침 식사 후",
              startDate: "2026-08-16",
              endDate: "",
              purposePlain: "혈압 관리",
              precautions: [],
            },
          ],
        },
      }),
      { status: 200 },
    );
  });

  const result = await analyzeMedicationDocument({
    documentType: "처방전",
    fileName: "prescription.png",
    contentType: "image/png",
    contentBase64: "aW1hZ2U=",
  });

  assert.equal(result.analysis.source, "api");
  assert.equal(result.analysis.findings[0]?.value, "테스트정 5mg");
  assert.equal(result.analysis.medications?.[0]?.frequency, "하루 1회");
  assert.equal(receivedAuthorization, "Bearer test-analysis-key");
});

test("실제 파일인데 API가 없으면 데모 결과로 위장하지 않는다", async () => {
  const previousEndpoint = process.env.AI_ANALYSIS_ENDPOINT;
  const previousApiKey = process.env.AI_API_KEY;
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  delete process.env.AI_ANALYSIS_ENDPOINT;
  delete process.env.AI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(
      analyzeMedicationDocument({
        documentType: "진단서",
        fileName: "diagnosis.jpg",
        contentType: "image/jpeg",
        contentBase64: "aW1hZ2U=",
      }),
      DocumentAnalysisNotConfiguredError,
    );
  } finally {
    if (previousEndpoint !== undefined) process.env.AI_ANALYSIS_ENDPOINT = previousEndpoint;
    if (previousApiKey !== undefined) process.env.AI_API_KEY = previousApiKey;
    if (previousOpenAiKey !== undefined) process.env.OPENAI_API_KEY = previousOpenAiKey;
  }
});

test("OpenAI가 처방약을 누락하면 한 번 재시도하고 약 이름 finding을 보강한다", async (context) => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousEndpoint = process.env.AI_ANALYSIS_ENDPOINT;
  const previousApiKey = process.env.AI_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-key";
  delete process.env.AI_ANALYSIS_ENDPOINT;
  delete process.env.AI_API_KEY;
  context.after(() => {
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
    if (previousEndpoint === undefined) delete process.env.AI_ANALYSIS_ENDPOINT;
    else process.env.AI_ANALYSIS_ENDPOINT = previousEndpoint;
    if (previousApiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousApiKey;
  });

  const baseAnalysis = {
    documentType: "처방전",
    summary: "처방전 분석",
    findings: [{ label: "복용 안내", value: "원본과 확인하세요." }],
    carePoints: [],
    questionsForProfessional: [],
    disclaimer: "의료진 확인이 필요합니다.",
    source: "openai",
  } satisfies DocumentAnalysis;
  let attempts = 0;

  const result = await analyzeMedicationDocument(
    {
      documentType: "처방전",
      fileName: "prescription.png",
      contentType: "image/png",
      contentBase64: "aW1hZ2U=",
    },
    {
      async analyzeClinicalDocumentWithOpenAI() {
        attempts += 1;
        if (attempts === 1) return { ...baseAnalysis, medications: [] };
        return {
          ...baseAnalysis,
          medications: [
            {
              productName: "노바스크정 5mg",
              ingredientName: "암로디핀",
              doseAmount: "1정",
              frequency: "하루 1회",
              timing: "아침 식사 후",
              startDate: "2026-08-12",
              purposePlain: "혈압 관리",
              precautions: [],
            },
          ],
        };
      },
    },
  );

  assert.equal(attempts, 2);
  assert.ok(result.analysis.findings.some((finding) => finding.value.includes("노바스크정 5mg")));
  assert.equal(result.analysis.medications?.[0]?.reviewStatus, "needs_review");
});

test("높은 OCR 신뢰도와 식약처 품목코드·제품명이 일치하면 복약 후보를 검증 완료한다", async (context) => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousEndpoint = process.env.AI_ANALYSIS_ENDPOINT;
  const previousApiKey = process.env.AI_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-key";
  delete process.env.AI_ANALYSIS_ENDPOINT;
  delete process.env.AI_API_KEY;
  context.after(() => {
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
    if (previousEndpoint === undefined) delete process.env.AI_ANALYSIS_ENDPOINT;
    else process.env.AI_ANALYSIS_ENDPOINT = previousEndpoint;
    if (previousApiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousApiKey;
  });

  const result = await analyzeMedicationDocument(
    {
      documentType: "처방전",
      fileName: "prescription.png",
      contentType: "image/png",
      contentBase64: "aW1hZ2U=",
    },
    {
      async analyzeClinicalDocumentWithOpenAI() {
        return {
          documentType: "처방전",
          summary: "처방전 분석",
          findings: [],
          carePoints: [],
          questionsForProfessional: [],
          disclaimer: "원본 확인",
          source: "openai",
          medications: [{
            productName: "노바스크정 5mg",
            ingredientName: "암로디핀베실산염",
            itemCode: "200001234",
            doseAmount: "1정",
            frequency: "하루 1회",
            timing: "아침 식사 후",
            startDate: "2026-08-12",
            purposePlain: "혈압 관리",
            precautions: [],
            fieldEvidence: evidence(),
          }],
        };
      },
      async verifyOfficialMedicationCode() {
        return matchedOfficialMedication;
      },
    },
  );

  assert.equal(result.analysis.medications?.[0]?.reviewStatus, "verified");
  assert.equal(result.analysis.medications?.[0]?.verification?.status, "verified");
  assert.deepEqual(result.analysis.medications?.[0]?.verification?.warnings, []);
});

test("높은 OCR 신뢰도여도 품목코드가 다른 약이면 원본을 보존하고 검토를 요구한다", async (context) => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousEndpoint = process.env.AI_ANALYSIS_ENDPOINT;
  const previousApiKey = process.env.AI_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-key";
  delete process.env.AI_ANALYSIS_ENDPOINT;
  delete process.env.AI_API_KEY;
  context.after(() => {
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
    if (previousEndpoint === undefined) delete process.env.AI_ANALYSIS_ENDPOINT;
    else process.env.AI_ANALYSIS_ENDPOINT = previousEndpoint;
    if (previousApiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousApiKey;
  });

  const result = await analyzeMedicationDocument(
    {
      documentType: "처방전",
      fileName: "prescription.png",
      contentType: "image/png",
      contentBase64: "aW1hZ2U=",
    },
    {
      async analyzeClinicalDocumentWithOpenAI() {
        return {
          documentType: "처방전",
          summary: "처방전 분석",
          findings: [],
          carePoints: [],
          questionsForProfessional: [],
          disclaimer: "원본 확인",
          source: "openai",
          medications: [{
            productName: "다른약정 5mg",
            ingredientName: "암로디핀베실산염",
            itemCode: "200001234",
            doseAmount: "1정",
            frequency: "하루 1회",
            timing: "아침 식사 후",
            startDate: "2026-08-12",
            purposePlain: "혈압 관리",
            precautions: [],
            fieldEvidence: evidence(),
          }],
        };
      },
      async verifyOfficialMedicationCode() {
        return matchedOfficialMedication;
      },
    },
  );

  assert.equal(result.analysis.medications?.[0]?.productName, "다른약정 5mg");
  assert.equal(result.analysis.medications?.[0]?.reviewStatus, "needs_review");
  assert.equal(result.analysis.medications?.[0]?.verification?.status, "mismatch");
  assert.ok(result.analysis.medications?.[0]?.reviewReasons?.includes("official_mismatch"));
});

test("보험코드를 식약처 품목기준코드로 오인해 공식 조회하지 않는다", async (context) => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousEndpoint = process.env.AI_ANALYSIS_ENDPOINT;
  const previousApiKey = process.env.AI_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-key";
  delete process.env.AI_ANALYSIS_ENDPOINT;
  delete process.env.AI_API_KEY;
  context.after(() => {
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
    if (previousEndpoint === undefined) delete process.env.AI_ANALYSIS_ENDPOINT;
    else process.env.AI_ANALYSIS_ENDPOINT = previousEndpoint;
    if (previousApiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousApiKey;
  });

  let verificationCalls = 0;
  const result = await analyzeMedicationDocument(
    {
      documentType: "처방전",
      fileName: "prescription.png",
      contentType: "image/png",
      contentBase64: "aW1hZ2U=",
    },
    {
      async analyzeClinicalDocumentWithOpenAI() {
        return {
          documentType: "처방전",
          summary: "처방전 분석",
          findings: [],
          carePoints: [],
          questionsForProfessional: [],
          disclaimer: "원본 확인",
          source: "openai",
          medications: [{
            productName: "노바스크정 5mg",
            ingredientName: "암로디핀베실산염",
            insuranceCode: "648900030",
            doseAmount: "1정",
            frequency: "하루 1회",
            timing: "아침 식사 후",
            startDate: "2026-08-12",
            purposePlain: "혈압 관리",
            precautions: [],
          }],
        };
      },
      async verifyOfficialMedicationCode() {
        verificationCalls += 1;
        return matchedOfficialMedication;
      },
    },
  );

  assert.equal(verificationCalls, 0);
  assert.equal(result.analysis.medications?.[0]?.insuranceCode, "648900030");
  assert.equal(result.analysis.medications?.[0]?.reviewStatus, "needs_review");
});

test("낮은 OCR 신뢰도와 다른 제품명은 원본을 보존하고 복약 활성화를 막는다", async (context) => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousEndpoint = process.env.AI_ANALYSIS_ENDPOINT;
  const previousApiKey = process.env.AI_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-key";
  delete process.env.AI_ANALYSIS_ENDPOINT;
  delete process.env.AI_API_KEY;
  context.after(() => {
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
    if (previousEndpoint === undefined) delete process.env.AI_ANALYSIS_ENDPOINT;
    else process.env.AI_ANALYSIS_ENDPOINT = previousEndpoint;
    if (previousApiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousApiKey;
  });

  const result = await analyzeMedicationDocument(
    {
      documentType: "처방전",
      fileName: "prescription.png",
      contentType: "image/png",
      contentBase64: "aW1hZ2U=",
    },
    {
      async analyzeClinicalDocumentWithOpenAI() {
        return {
          documentType: "처방전",
          summary: "처방전 분석",
          findings: [],
          carePoints: [],
          questionsForProfessional: [],
          disclaimer: "원본 확인",
          source: "openai",
          medications: [{
            productName: "노바스그정 5mg",
            ingredientName: "다른성분",
            itemCode: "200001234",
            doseAmount: "1정",
            frequency: "하루 1회",
            timing: "아침 식사 후",
            startDate: "2026-08-12",
            purposePlain: "혈압 관리",
            precautions: [],
            fieldEvidence: evidence(0.55),
          }],
        };
      },
      async verifyOfficialMedicationCode() {
        return matchedOfficialMedication;
      },
    },
  );

  const medication = result.analysis.medications?.[0];
  assert.equal(medication?.productName, "노바스그정 5mg");
  assert.equal(medication?.reviewStatus, "needs_review");
  assert.equal(medication?.verification?.status, "mismatch");
  assert.ok(medication?.verification?.warnings.some((warning) => warning.includes("55%")));
  assert.ok(medication?.verification?.warnings.some((warning) => warning.includes("제품명")));
});

test("OpenAI 재시도 후에도 필수 정보가 없으면 누락 항목을 표시한 검토 초안을 반환한다", async (context) => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousEndpoint = process.env.AI_ANALYSIS_ENDPOINT;
  const previousApiKey = process.env.AI_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-key";
  delete process.env.AI_ANALYSIS_ENDPOINT;
  delete process.env.AI_API_KEY;
  context.after(() => {
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
    if (previousEndpoint === undefined) delete process.env.AI_ANALYSIS_ENDPOINT;
    else process.env.AI_ANALYSIS_ENDPOINT = previousEndpoint;
    if (previousApiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousApiKey;
  });

  let attempts = 0;
  let retryFocus: string[] | undefined;
  const result = await analyzeMedicationDocument(
    {
      documentType: "처방전",
      fileName: "prescription.png",
      contentType: "image/png",
      contentBase64: "aW1hZ2U=",
    },
    {
      async analyzeClinicalDocumentWithOpenAI(input) {
        attempts += 1;
        retryFocus = input.retryFocus;
        return {
          documentType: "처방전",
          summary: "읽기 실패",
          findings: [],
          carePoints: [],
          questionsForProfessional: [],
          disclaimer: "의료진 확인이 필요합니다.",
          source: "openai",
          medications: [],
        };
      },
    },
  );
  assert.equal(attempts, 2);
  assert.deepEqual(retryFocus, ["medications"]);
  assert.equal(result.analysis.extraction?.status, "failed");
  assert.deepEqual(result.analysis.extraction?.issues, ["medication_not_found"]);
});

const retryMedication = (
  productName: string,
  sourceRow: number,
  doseAmount: string,
  timing: string,
): PrescriptionMedication => ({
  productName,
  sourceRow,
  doseAmount,
  timing,
  ingredientName: "",
  mfdsItemSeq: productName === "합성약A" ? "200000001" : "200000002",
  frequency: "하루 1회",
  startDate: "2026-09-01",
  endDate: "2026-09-05",
  supplyDays: 5,
  purposePlain: "원본 확인",
  precautions: [],
});

async function analyzeRetryResponses(
  context: TestContext,
  responses: Array<PrescriptionMedication[] | Error>,
) {
  const previous = new Map(["OPENAI_API_KEY", "AI_ANALYSIS_ENDPOINT", "AI_API_KEY"]
    .map((key) => [key, process.env[key]]));
  process.env.OPENAI_API_KEY = "synthetic-retry-key";
  delete process.env.AI_ANALYSIS_ENDPOINT;
  delete process.env.AI_API_KEY;
  context.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  let attempts = 0;
  const result = await analyzeMedicationDocument({
    documentType: "처방전",
    fileName: "synthetic.png",
    contentType: "image/png",
    contentBase64: "c3ludGhldGlj",
  }, {
    async analyzeClinicalDocumentWithOpenAI() {
      const response = responses[attempts++];
      if (response instanceof Error) throw response;
      assert.ok(response, "unexpected extraction attempt");
      return {
        documentType: "처방전", source: "openai", summary: "합성 문서",
        findings: [], carePoints: [], questionsForProfessional: [], disclaimer: "원본 확인",
        medications: response,
      };
    },
    async verifyOfficialMedicationCode(code) {
      return {
        ...matchedOfficialMedication,
        item: {
          ...matchedOfficialMedication.item,
          itemSeq: code,
          productName: code === "200000001" ? "합성약A" : "합성약B",
          ingredientName: "",
        },
      };
    },
  });
  assert.equal(attempts, 2);
  return result;
}

test("재시도가 앞 행을 누락해도 다른 약의 복용량을 붙이거나 검증 완료하지 않는다", async (context) => {
  const result = await analyzeRetryResponses(context, [
    [retryMedication("합성약A", 1, "1정", ""), retryMedication("합성약B", 2, "2정", "저녁")],
    [retryMedication("합성약B", 2, "", "저녁")],
  ]);
  assert.deepEqual(result.analysis.medications?.map((medication) => [
    medication.productName, medication.doseAmount, medication.sourceRow, medication.reviewStatus,
  ]), [["합성약A", "1정", 1, "needs_review"], ["합성약B", "2정", 2, "verified"]]);
});

test("재시도 행이 재정렬돼도 같은 약의 누락 필드만 보완하고 첫 값과 근거를 보존한다", async (context) => {
  const first = retryMedication("합성약A", 1, "1정", "");
  first.fieldEvidence = [{ field: "doseAmount", sourceText: "1정", confidence: 0.9 }];
  const retried = retryMedication("합성약A", 1, "9정", "아침");
  retried.fieldEvidence = [
    { field: "doseAmount", sourceText: "9정", confidence: 0.99 },
    { field: "timing", sourceText: "아침", confidence: 0.9 },
  ];
  const result = await analyzeRetryResponses(context, [
    [first, retryMedication("합성약B", 2, "2정", "저녁")],
    [retryMedication("합성약B", 2, "", "저녁"), retried],
  ]);
  assert.deepEqual(result.analysis.medications?.map((medication) => [
    medication.productName, medication.doseAmount, medication.timing,
  ]), [["합성약A", "1정", "아침"], ["합성약B", "2정", "저녁"]]);
  assert.equal(result.analysis.medications?.[0]?.fieldEvidence?.find((field) => field.field === "doseAmount")?.sourceText, "1정");
  assert.equal(result.analysis.medications?.[0]?.fieldEvidence?.find((field) => field.field === "timing")?.sourceText, "아침");
});

test("같은 약의 여러 행은 원본 행으로 구분하고 서로 다른 투약량을 섞지 않는다", async (context) => {
  const result = await analyzeRetryResponses(context, [
    [retryMedication("합성약A", 1, "1정", ""), retryMedication("합성약A", 2, "2정", "저녁")],
    [retryMedication("합성약A", 2, "", "저녁"), retryMedication("합성약A", 1, "", "아침")],
  ]);
  assert.deepEqual(result.analysis.medications?.map((medication) => [
    medication.sourceRow, medication.doseAmount, medication.timing,
  ]), [[1, "1정", "아침"], [2, "2정", "저녁"]]);
});

test("원본 행이 같아도 다른 약이나 다른 코드의 재추출을 기존 약에 병합하지 않는다", async (context) => {
  const differentCode = { ...retryMedication("합성약A", 1, "", "저녁"), mfdsItemSeq: "200000003" };
  const result = await analyzeRetryResponses(context, [
    [retryMedication("합성약A", 1, "1정", "")],
    [retryMedication("합성약B", 1, "", "저녁"), differentCode],
  ]);
  assert.deepEqual(result.analysis.medications?.map((medication) => medication.doseAmount), ["1정", "", ""]);
  assert.ok(result.analysis.medications?.every((medication) => medication.reviewStatus === "needs_review"));
});

test("여러 추출에서 합쳐진 동일 보험코드는 품목기준코드로 검증하지 않는다", async (context) => {
  const retried = { ...retryMedication("합성약A", 1, "", "아침"), mfdsItemSeq: undefined, insuranceCode: "200000001" };
  const result = await analyzeRetryResponses(context, [[retryMedication("합성약A", 1, "1정", "")], [retried]]);
  const medication = result.analysis.medications?.[0];
  assert.equal(medication?.insuranceCode, "200000001");
  assert.equal(medication?.mfdsItemSeq, undefined);
  assert.equal(medication?.itemCode, undefined);
  assert.equal(medication?.reviewStatus, "needs_review");
});

test("보완 추출이 실패해도 첫 부분 분석을 검토 초안으로 반환한다", async (context) => {
  const result = await analyzeRetryResponses(context, [
    [retryMedication("합성약A", 1, "1정", "")],
    new Error("synthetic retry timeout"),
  ]);
  assert.equal(result.analysis.medications?.[0]?.doseAmount, "1정");
  assert.equal(result.analysis.medications?.[0]?.reviewStatus, "needs_review");
  assert.equal(result.analysis.extraction?.status, "partial");
  assert.deepEqual(result.analysis.extraction?.missingFields, ["medications[1].timing"]);
});
