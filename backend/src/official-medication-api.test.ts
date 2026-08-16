import assert from "node:assert/strict";
import test from "node:test";

import {
  parsePharmacogenomicResponse,
  searchPharmacogenomicInfo,
} from "./official-medication-api.ts";

test("JSON 배열 응답을 약물 정보 목록으로 정규화한다", () => {
  const result = parsePharmacogenomicResponse(
    JSON.stringify({
      header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
      body: {
        totalCount: 1,
        items: [
          {
            item: {
              DRFSTF_KOR_NM: "와파린",
              DRFSTF_ENG_NM: "Warfarin",
              BASC_INFO: "유전 정보",
              GNRL_INFO: "일반 정보",
              PRDLST_NM: "제품 정보",
            },
          },
        ],
      },
    }),
    "json",
  );

  assert.equal(result.status, "connected");
  assert.equal(result.totalCount, 1);
  assert.deepEqual(result.items[0], {
    koreanName: "와파린",
    englishName: "Warfarin",
    pharmacogenomicInfo: "유전 정보",
    generalInfo: "일반 정보",
    productInfo: "제품 정보",
    source: "mfds_pharmacogenomic",
  });
});

test("XML 단일 항목 응답도 같은 모델로 정규화한다", () => {
  const result = parsePharmacogenomicResponse(
    `<?xml version="1.0" encoding="UTF-8"?>
      <response>
        <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body>
          <totalCount>1</totalCount>
          <items><item><DRFSTF_KOR_NM>클로피도그렐</DRFSTF_KOR_NM><DRFSTF_ENG_NM>Clopidogrel</DRFSTF_ENG_NM><BASC_INFO>유전 정보</BASC_INFO><GNRL_INFO>일반 정보</GNRL_INFO><PRDLST_NM>제품 정보</PRDLST_NM></item></items>
        </body>
      </response>`,
    "xml",
  );

  assert.equal(result.totalCount, 1);
  assert.equal(result.items[0]?.koreanName, "클로피도그렐");
});

test("키가 없으면 네트워크를 호출하지 않고 로컬 복용약을 검색한다", async () => {
  let called = false;
  const result = await searchPharmacogenomicInfo("암로디핀", {
    apiKey: "",
    fetcher: async () => {
      called = true;
      return new Response();
    },
  });

  assert.equal(called, false);
  assert.equal(result.status, "local_fallback");
  assert.equal(result.items[0]?.englishName, "Amlodipine");
  assert.equal(result.items[0]?.categoryPlain, "혈압약");
  assert.equal(result.items[0]?.pharmacogenomicInfo, "");
});

test("로컬 복용약은 제품명과 영문 성분명으로도 검색한다", async () => {
  const byProduct = await searchPharmacogenomicInfo("리피토", { apiKey: "" });
  const byEnglishName = await searchPharmacogenomicInfo("celecoxib", { apiKey: "" });

  assert.equal(byProduct.items[0]?.englishName, "Atorvastatin");
  assert.equal(byEnglishName.items[0]?.koreanName, "세레콕시브");
});

test("한글 검색어와 키를 URL 쿼리로 전달하고 키를 결과에 노출하지 않는다", async () => {
  let requestUrl = "";
  const result = await searchPharmacogenomicInfo(" 와파린 ", {
    apiKey: "secret-key",
    fetcher: async (input) => {
      requestUrl = String(input);
      return new Response(
        JSON.stringify({
          header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
          body: { totalCount: 0, items: "" },
        }),
        { status: 200 },
      );
    },
  });

  const requested = new URL(requestUrl);
  assert.equal(requested.searchParams.get("DRFSTF_KOR_NM"), "와파린");
  assert.equal(requested.searchParams.get("serviceKey"), "secret-key");
  assert.equal(JSON.stringify(result).includes("secret-key"), false);
});

test("공식 약물 유전 정보에 없는 암로디핀은 검증된 예시 정보로 폴백한다", async () => {
  const result = await searchPharmacogenomicInfo("암로디핀", {
    apiKey: "mfds-key",
    fetcher: async () =>
      new Response(
        JSON.stringify({
          header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
          body: { totalCount: 0, items: "" },
        }),
        { status: 200 },
      ),
  });

  assert.equal(result.status, "local_fallback");
  assert.equal(result.totalCount, 1);
  assert.equal(result.items[0]?.koreanName, "암로디핀");
  assert.equal(result.items[0]?.englishName, "Amlodipine");
  assert.match("message" in result ? result.message : "", /약물 유전 정보에 일치/);
});

test("공식 정보와 예시 목록에 없는 약은 OpenAI 웹 검색으로 폴백한다", async () => {
  let searchedQuery = "";
  const result = await searchPharmacogenomicInfo("아목시실린", {
    apiKey: "mfds-key",
    openAiApiKey: "openai-key",
    fetcher: async () =>
      new Response(
        JSON.stringify({
          header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
          body: { totalCount: 0, items: "" },
        }),
        { status: 200 },
      ),
    webSearcher: async (query) => {
      searchedQuery = query;
      return {
        koreanName: "아목시실린",
        englishName: "Amoxicillin",
        pharmacogenomicInfo: "",
        generalInfo: "세균 감염 치료에 쓰이는 항생제예요.",
        productInfo: "아목시실린 성분의 허가 제품이 있어요.",
        source: "openai_web",
        references: [{ title: "DailyMed", url: "https://dailymed.nlm.nih.gov/" }],
      };
    },
  });

  assert.equal(searchedQuery, "아목시실린");
  assert.equal(result.status, "openai_fallback");
  assert.equal(result.items[0]?.englishName, "Amoxicillin");
  assert.equal(result.items[0]?.references?.length, 1);
});

test("식약처 API 키가 없어도 예시 목록에 없으면 OpenAI를 호출한다", async () => {
  let searched = false;
  const result = await searchPharmacogenomicInfo("가바펜틴", {
    apiKey: "",
    openAiApiKey: "openai-key",
    webSearcher: async () => {
      searched = true;
      return {
        koreanName: "가바펜틴",
        englishName: "Gabapentin",
        pharmacogenomicInfo: "",
        generalInfo: "공식 출처 기반 설명",
        productInfo: "",
        source: "openai_web",
        references: [{ title: "DailyMed", url: "https://dailymed.nlm.nih.gov/" }],
      };
    },
  });

  assert.equal(searched, true);
  assert.equal(result.status, "openai_fallback");
});

test("식약처 API가 오류를 반환하면 마지막으로 OpenAI를 호출한다", async (context) => {
  context.mock.method(console, "error", () => undefined);
  let searched = false;
  const result = await searchPharmacogenomicInfo("푸로세미드", {
    apiKey: "mfds-key",
    openAiApiKey: "openai-key",
    fetcher: async () => new Response("gateway error", { status: 503 }),
    webSearcher: async () => {
      searched = true;
      return {
        koreanName: "푸로세미드",
        englishName: "Furosemide",
        pharmacogenomicInfo: "",
        generalInfo: "공식 출처 기반 설명",
        productInfo: "",
        source: "openai_web",
        references: [{ title: "DailyMed", url: "https://dailymed.nlm.nih.gov/" }],
      };
    },
  });

  assert.equal(searched, true);
  assert.equal(result.status, "openai_fallback");
  assert.match("message" in result ? result.message : "", /API 호출에 실패/);
});

test("공식 검색 결과를 쉬운 설명 생성기에 전달한다", async () => {
  let simplified = false;
  const result = await searchPharmacogenomicInfo("와파린", {
    apiKey: "mfds-key",
    openAiApiKey: "openai-key",
    fetcher: async () =>
      new Response(
        JSON.stringify({
          header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
          body: {
            totalCount: 1,
            items: {
              item: {
                DRFSTF_KOR_NM: "와파린",
                DRFSTF_ENG_NM: "Warfarin",
                BASC_INFO: "유전 정보 원문",
                GNRL_INFO: "일반 정보 원문",
                PRDLST_NM: "제품 정보 원문",
              },
            },
          },
        }),
        { status: 200 },
      ),
    simplifier: async (items) => {
      simplified = true;
      return items.map((item) => ({
        ...item,
        plainExplanation: {
          categoryPlain: "항응고제",
          overview: "피가 굳는 속도를 조절하는 데 쓰이는 약의 정보예요.",
          geneInfo: "사람마다 약에 반응하는 정도가 다를 수 있다는 뜻이에요.",
          productInfo: "와파린 성분이 든 제품 목록이에요.",
          caregiverNote: "복용량은 의료진과 확인하세요.",
        },
      }));
    },
  });

  assert.equal(simplified, true);
  assert.equal(result.status, "connected");
  if (result.status !== "connected") return;
  assert.equal(result.plainLanguageStatus, "complete");
  assert.equal(result.items[0]?.plainExplanation?.categoryPlain, "항응고제");
  assert.match(result.items[0]?.plainExplanation?.overview ?? "", /굳는 속도/);
});

test("쉬운 설명 생성 실패 시 식약처 원문은 유지한다", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const result = await searchPharmacogenomicInfo("와파린", {
    apiKey: "mfds-key",
    openAiApiKey: "openai-key",
    fetcher: async () =>
      new Response(
        JSON.stringify({
          header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
          body: {
            totalCount: 1,
            items: { item: { DRFSTF_KOR_NM: "와파린", GNRL_INFO: "공식 원문" } },
          },
        }),
        { status: 200 },
      ),
    simplifier: async () => {
      throw new Error("temporary failure");
    },
  });

  assert.equal(result.status, "connected");
  if (result.status !== "connected") return;
  assert.equal(result.plainLanguageStatus, "unavailable");
  assert.equal(result.items[0]?.generalInfo, "공식 원문");
});
