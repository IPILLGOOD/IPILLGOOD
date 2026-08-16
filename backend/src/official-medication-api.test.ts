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

test("키가 없으면 네트워크를 호출하지 않고 설정 상태를 반환한다", async () => {
  let called = false;
  const result = await searchPharmacogenomicInfo("와파린", {
    apiKey: "",
    fetcher: async () => {
      called = true;
      return new Response();
    },
  });

  assert.equal(called, false);
  assert.equal(result.status, "not_configured");
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
