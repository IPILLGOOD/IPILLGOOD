import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeMedicationDocument,
  DocumentAnalysisNotConfiguredError,
} from "./ai/medication-analyzer.ts";

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
