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
