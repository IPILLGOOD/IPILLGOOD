import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeMedicationDocument,
  DocumentAnalysisIncompleteError,
  DocumentAnalysisNotConfiguredError,
} from "./ai/medication-analyzer.ts";
import type { DocumentAnalysis } from "./types.ts";

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

test("낮은 OCR 신뢰도나 식약처 제품명 불일치는 확인 전 복약 활성화를 막는다", async (context) => {
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
            productName: "다른약 5mg",
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
  assert.equal(medication?.reviewStatus, "needs_review");
  assert.equal(medication?.verification?.status, "mismatch");
  assert.ok(medication?.verification?.warnings.some((warning) => warning.includes("55%")));
  assert.ok(medication?.verification?.warnings.some((warning) => warning.includes("제품명")));
});

test("OpenAI 재시도 후에도 필수 정보가 없으면 불완전 결과를 저장하지 않는다", async (context) => {
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
  await assert.rejects(
    analyzeMedicationDocument(
      {
        documentType: "처방전",
        fileName: "prescription.png",
        contentType: "image/png",
        contentBase64: "aW1hZ2U=",
      },
      {
        async analyzeClinicalDocumentWithOpenAI() {
          attempts += 1;
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
    ),
    DocumentAnalysisIncompleteError,
  );
  assert.equal(attempts, 2);
});
