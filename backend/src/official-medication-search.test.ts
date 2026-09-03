import assert from "node:assert/strict";
import test from "node:test";

import {
  parseEasyDrugResponse,
  parseProductPermitDetailResponse,
  parseProductPermitResponse,
  searchOfficialMedicationInfo,
  verifyOfficialMedicationCode,
} from "./official-medication-search.ts";

function officialResponse(items: unknown[], totalCount = items.length) {
  return new Response(JSON.stringify({
    header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
    body: { totalCount, items: { item: items } },
  }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function productItem(overrides: Record<string, unknown> = {}) {
  return {
    ITEM_SEQ: "200001234",
    ITEM_NAME: "노바스크정5밀리그램(암로디핀베실산염)",
    ITEM_ENG_NAME: "Norvasc Tab. 5mg",
    ITEM_INGR_NAME: "암로디핀베실산염",
    ENTP_NAME: "한국화이자제약(주)",
    SPCLTY_PBLC: "전문의약품",
    PRDUCT_TYPE: "혈압강하제",
    ...overrides,
  };
}

function emptyOfficialResponse() {
  return officialResponse([], 0);
}

test("제품 허가정보 JSON을 품목기준코드가 있는 검색 항목으로 정규화한다", () => {
  const result = parseProductPermitResponse(
    JSON.stringify({
      header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
      body: { totalCount: 1, items: { item: productItem() } },
    }),
    "json",
    "product_name",
  );

  assert.equal(result.totalCount, 1);
  assert.deepEqual(result.items[0], {
    itemSeq: "200001234",
    productName: "노바스크정5밀리그램(암로디핀베실산염)",
    englishName: "Norvasc Tab. 5mg",
    ingredientName: "암로디핀베실산염",
    manufacturer: "한국화이자제약(주)",
    classification: "전문의약품",
    productType: "혈압강하제",
    matchType: "product_name",
    sources: [{
      kind: "product_permit",
      label: "식약처 의약품 제품 허가정보",
      url: "https://www.data.go.kr/data/15095677/openapi.do",
    }],
  });
});

test("제품 허가정보 XML 단일 항목도 같은 모델로 정규화한다", () => {
  const result = parseProductPermitResponse(
    `<?xml version="1.0" encoding="UTF-8"?>
      <response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
      <body><totalCount>1</totalCount><items><item>
        <ITEM_SEQ>200001234</ITEM_SEQ><ITEM_NAME>노바스크정5밀리그램</ITEM_NAME>
        <ITEM_INGR_NAME>암로디핀베실산염</ITEM_INGR_NAME><SPCLTY_PBLC>전문의약품</SPCLTY_PBLC>
      </item></items></body></response>`,
    "xml",
    "ingredient",
  );

  assert.equal(result.items[0]?.itemSeq, "200001234");
  assert.equal(result.items[0]?.matchType, "ingredient");
});

test("e약은요 응답의 소비자용 항목을 안전한 일반 텍스트로 정규화한다", () => {
  const result = parseEasyDrugResponse(
    JSON.stringify({
      header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
      body: {
        totalCount: 1,
        items: { item: {
          itemSeq: "200009999",
          itemName: "테스트일반정",
          entpName: "테스트제약",
          efcyQesitm: "<p>통증을 줄이는 데 사용합니다.</p>",
          useMethodQesitm: "<p>정해진 용법을 따르세요.<br/>과량 사용하지 마세요.</p>",
          atpnWarnQesitm: "경고",
          atpnQesitm: "주의사항",
          intrcQesitm: "상호작용",
          seQesitm: "이상반응",
          depositMethodQesitm: "실온 보관",
          itemImage: "javascript:alert(1)",
          openDe: "20200101",
          updateDe: "20260801",
        } },
      },
    }),
    "json",
  );

  assert.equal(result.items[0]?.efficacy, "통증을 줄이는 데 사용합니다.");
  assert.equal(
    result.items[0]?.usage,
    "정해진 용법을 따르세요.\n과량 사용하지 마세요.",
  );
  assert.equal(result.items[0]?.imageUrl, undefined);
});

test("전문의약품 상세 허가 XML 문서를 효능·용법·주의사항 일반 텍스트로 정규화한다", () => {
  const result = parseProductPermitDetailResponse(
    JSON.stringify({
      header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
      body: {
        totalCount: 1,
        items: { item: {
          ITEM_SEQ: "200001234",
          EE_DOC_DATA: '<DOC title="효능효과"><ARTICLE title="1. 고혈압" /></DOC>',
          UD_DOC_DATA: '<DOC title="용법용량"><PARAGRAPH><![CDATA[처방에 따라 복용합니다.]]></PARAGRAPH></DOC>',
          NB_DOC_DATA: '<DOC title="사용상의주의사항"><ARTICLE title="어지러움에 주의" /></DOC>',
          STORAGE_METHOD: "기밀용기, 실온보관",
        } },
      },
    }),
    "json",
  );

  assert.equal(result.totalCount, 1);
  assert.match(result.items[0]?.efficacy ?? "", /고혈압/);
  assert.match(result.items[0]?.usage ?? "", /처방에 따라 복용/);
  assert.match(result.items[0]?.precautions ?? "", /어지러움에 주의/);
  assert.equal(result.items[0]?.storage, "기밀용기, 실온보관");
  assert.equal(JSON.stringify(result).includes("<DOC"), false);
});

test("API 키가 없으면 예시나 웹 검색으로 대체하지 않고 미설정 상태를 반환한다", async () => {
  let called = false;
  const result = await searchOfficialMedicationInfo("노바스크", {
    apiKey: "",
    fetcher: async () => {
      called = true;
      return emptyOfficialResponse();
    },
  });

  assert.equal(called, false);
  assert.equal(result.status, "not_configured");
  assert.deepEqual(result.items, []);
});

test("OCR 품목코드를 정확 일치 조건으로 식약처 허가정보에서 확인한다", async () => {
  let requested: URL | undefined;
  const result = await verifyOfficialMedicationCode("200001234", {
    apiKey: "official-key",
    fetcher: async (input) => {
      requested = new URL(String(input));
      return officialResponse([productItem()]);
    },
  });

  assert.equal(requested?.searchParams.get("item_seq"), "200001234");
  assert.equal(requested?.searchParams.has("item_name"), false);
  assert.equal(result.status, "matched");
  if (result.status === "matched") {
    assert.equal(result.item.itemSeq, "200001234");
    assert.match(result.item.productName, /노바스크/);
  }
});

test("식약처 API가 필터를 무시해 다른 품목을 반환해도 코드 일치로 오인하지 않는다", async () => {
  const result = await verifyOfficialMedicationCode("650201700", {
    apiKey: "official-key",
    fetcher: async () => officialResponse([productItem({ ITEM_SEQ: "195500005" })]),
  });

  assert.equal(result.status, "not_found");
});

test("품목코드가 없거나 API 키가 없으면 네트워크 없이 확인 필요 상태를 반환한다", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return emptyOfficialResponse();
  };

  assert.equal((await verifyOfficialMedicationCode("코드없음", { apiKey: "key", fetcher })).status, "not_found");
  assert.equal((await verifyOfficialMedicationCode("200001234", { apiKey: "", fetcher })).status, "not_configured");
  assert.equal(calls, 0);
});

test("제품명과 성분명을 각각 공식 조회하고 itemSeq로 중복을 제거한다", async () => {
  const requested: URL[] = [];
  const result = await searchOfficialMedicationInfo("노바스크", {
    apiKey: "official-key",
    fetcher: async (input) => {
      const url = new URL(String(input));
      requested.push(url);
      if (url.pathname.endsWith("/getDrugPrdtPrmsnInq07")) {
        if (url.searchParams.has("item_name")) return officialResponse([productItem()]);
        return emptyOfficialResponse();
      }
      return emptyOfficialResponse();
    },
  });

  assert.equal(result.status, "connected");
  if (result.status !== "connected") return;
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.itemSeq, "200001234");
  assert.equal(result.items[0]?.matchType, "product_name");
  const productRequests = requested.filter((url) =>
    url.pathname.endsWith("/getDrugPrdtPrmsnInq07")
  );
  assert.equal(productRequests.length, 2);
  assert.equal(productRequests.some((url) => url.searchParams.get("item_name") === "노바스크"), true);
  assert.equal(
    productRequests.some((url) => url.searchParams.get("item_ingr_name") === "노바스크"),
    true,
  );
});

test("공공데이터포털 Encoding 키를 URL에서 한 번만 인코딩한다", async () => {
  const requestedKeys: string[] = [];
  await searchOfficialMedicationInfo("노바스크", {
    apiKey: "sample%2Bkey%3D%3D",
    fetcher: async (input) => {
      const url = new URL(String(input));
      requestedKeys.push(url.searchParams.get("serviceKey") ?? url.searchParams.get("ServiceKey") ?? "");
      return emptyOfficialResponse();
    },
  });

  assert.equal(requestedKeys.length, 4);
  assert.deepEqual(new Set(requestedKeys), new Set(["sample+key=="]));
});

test("제품·e약은요 키와 약물유전정보 키를 서비스별로 분리한다", async () => {
  const requestedKeys = new Map<string, string>();
  await searchOfficialMedicationInfo("노바스크", {
    apiKey: "medication-key",
    pharmacogenomicApiKey: "pharmacogenomic-key",
    fetcher: async (input) => {
      const url = new URL(String(input));
      requestedKeys.set(
        url.pathname,
        url.searchParams.get("serviceKey") ?? url.searchParams.get("ServiceKey") ?? "",
      );
      return emptyOfficialResponse();
    },
  });

  assert.equal(
    requestedKeys.get("/1471000/DrugPrdtPrmsnInfoService07/getDrugPrdtPrmsnInq07"),
    "medication-key",
  );
  assert.equal(
    requestedKeys.get("/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList"),
    "medication-key",
  );
  assert.equal(
    requestedKeys.get("/1471000/ParmgenService/getParmgen"),
    "pharmacogenomic-key",
  );
});

test("성분명 조회에도 잡힌 동일 품목은 성분 매칭으로 우선 표시하고 고정 복용법을 만들지 않는다", async () => {
  const result = await searchOfficialMedicationInfo("암로디핀", {
    apiKey: "official-key",
    fetcher: async (input) => {
      const url = new URL(String(input));
      if (!url.pathname.endsWith("/getDrugPrdtPrmsnInq07")) return emptyOfficialResponse();
      return officialResponse([productItem()]);
    },
  });

  assert.equal(result.status, "connected");
  if (result.status !== "connected") return;
  assert.equal(result.items[0]?.matchType, "ingredient");
  assert.equal("doseAmount" in (result.items[0] ?? {}), false);
  assert.equal("frequency" in (result.items[0] ?? {}), false);
  assert.equal("timing" in (result.items[0] ?? {}), false);
});

test("제품명 응답의 괄호 속 한글 성분과 검색어가 일치하면 성분 매칭으로 표시한다", async () => {
  const result = await searchOfficialMedicationInfo("암로디핀", {
    apiKey: "official-key",
    fetcher: async (input) => {
      const url = new URL(String(input));
      if (!url.pathname.endsWith("/getDrugPrdtPrmsnInq07")) return emptyOfficialResponse();
      if (url.searchParams.has("item_name")) return officialResponse([productItem()]);
      return emptyOfficialResponse();
    },
  });

  assert.equal(result.status, "connected");
  if (result.status !== "connected") return;
  assert.equal(result.items[0]?.matchType, "ingredient");
});

test("제품명 검색 결과가 10건이어도 성분명 검색 결과를 먼저 보여준다", async () => {
  const result = await searchOfficialMedicationInfo("암로디핀", {
    apiKey: "official-key",
    fetcher: async (input) => {
      const url = new URL(String(input));
      if (!url.pathname.endsWith("/getDrugPrdtPrmsnInq07")) return emptyOfficialResponse();
      if (url.searchParams.has("item_name")) {
        return officialResponse(Array.from({ length: 10 }, (_, index) => productItem({
          ITEM_SEQ: `product-${index}`,
        })));
      }
      return officialResponse([productItem({ ITEM_SEQ: "ingredient-first" })]);
    },
  });

  assert.equal(result.status, "connected");
  if (result.status !== "connected") return;
  assert.equal(result.items.length, 10);
  assert.equal(result.items[0]?.itemSeq, "ingredient-first");
  assert.equal(result.items[0]?.matchType, "ingredient");
});

test("e약은요와 약물유전정보를 품목·성분에 맞을 때만 보강한다", async () => {
  const result = await searchOfficialMedicationInfo("와파린", {
    apiKey: "official-key",
    fetcher: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/getDrugPrdtPrmsnInq07")) {
        if (url.searchParams.has("item_name")) return emptyOfficialResponse();
        return officialResponse([productItem({
          ITEM_SEQ: "200008888",
          ITEM_NAME: "와파린정5밀리그램",
          ITEM_INGR_NAME: "와파린나트륨",
        })]);
      }
      if (url.pathname.endsWith("/getDrbEasyDrugList")) {
        return officialResponse([{
          itemSeq: "200008888",
          itemName: "와파린정5밀리그램",
          entpName: "테스트제약",
          efcyQesitm: "공식 효능",
          useMethodQesitm: "공식 일반 사용법",
          atpnQesitm: "공식 주의사항",
          updateDe: "20260801",
        }]);
      }
      if (url.pathname.endsWith("/getParmgen")) {
        return officialResponse([{
          DRFSTF_KOR_NM: "와파린",
          DRFSTF_ENG_NM: "Warfarin",
          BASC_INFO: "유전 정보",
          GNRL_INFO: "일반 정보",
          PRDLST_NM: "제품 정보",
        }]);
      }
      throw new Error(`unexpected request: ${url}`);
    },
  });

  assert.equal(result.status, "connected");
  if (result.status !== "connected") return;
  assert.equal(result.easyDrugStatus, "complete");
  assert.equal(result.consumerInformationStatus, "complete");
  assert.equal(result.pharmacogenomicStatus, "complete");
  assert.equal(result.items[0]?.consumerInfo?.efficacy, "공식 효능");
  assert.equal(result.items[0]?.consumerInfo?.source, "easy_drug");
  assert.equal(result.items[0]?.pharmacogenomicInfo?.geneInfo, "유전 정보");
  assert.deepEqual(result.items[0]?.sources.map((source) => source.kind), [
    "product_permit",
    "easy_drug",
    "pharmacogenomic",
  ]);
});

test("e약은요가 없는 전문의약품은 상세 허가 원문을 사용해 OpenAI 쉬운 설명을 만든다", async () => {
  let detailRequest: URL | undefined;
  let simplifiedSource = "";
  const result = await searchOfficialMedicationInfo("노바스크", {
    apiKey: "official-key",
    openAiApiKey: "openai-key",
    fetcher: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/getDrugPrdtPrmsnInq07")) {
        return url.searchParams.has("item_name")
          ? officialResponse([productItem()])
          : emptyOfficialResponse();
      }
      if (url.pathname.endsWith("/getDrugPrdtPrmsnDtlInq06")) {
        detailRequest = url;
        return officialResponse([{
          ITEM_SEQ: "200001234",
          EE_DOC_DATA: '<DOC title="효능효과"><ARTICLE title="고혈압 치료" /></DOC>',
          UD_DOC_DATA: '<DOC title="용법용량"><PARAGRAPH><![CDATA[의사의 지시에 따라 복용]]></PARAGRAPH></DOC>',
          NB_DOC_DATA: '<DOC title="사용상의주의사항"><ARTICLE title="어지러움 주의" /></DOC>',
          STORAGE_METHOD: "실온보관",
        }]);
      }
      return emptyOfficialResponse();
    },
    simplifier: async (items) => {
      simplifiedSource = items[0]?.consumerInfo?.source ?? "";
      return items.map((item) => ({
        ...item,
        plainExplanation: {
          categoryPlain: "혈압약",
          overview: "높은 혈압을 낮추는 데 사용하는 약이에요.",
          usagePlain: "복용량은 처방전을 확인하세요.",
          safetyPlain: "어지러울 수 있어요.",
          genePlain: "",
          caregiverNote: "임의로 양을 바꾸지 마세요.",
        },
      }));
    },
  });

  assert.equal(result.status, "connected");
  if (result.status !== "connected") return;
  assert.equal(detailRequest?.searchParams.get("item_seq"), "200001234");
  assert.equal(simplifiedSource, "product_permit");
  assert.equal(result.easyDrugStatus, "no_match");
  assert.equal(result.consumerInformationStatus, "complete");
  assert.equal(result.plainLanguageStatus, "complete");
  assert.match(result.items[0]?.consumerInfo?.efficacy ?? "", /고혈압 치료/);
  assert.equal(result.items[0]?.plainExplanation?.categoryPlain, "혈압약");
});

test("OpenAI 쉬운 설명 생성이 실패해도 전문의약품 공식 원문을 유지한다", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const result = await searchOfficialMedicationInfo("노바스크", {
    apiKey: "official-key",
    openAiApiKey: "openai-key",
    fetcher: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/getDrugPrdtPrmsnInq07")) {
        return url.searchParams.has("item_name")
          ? officialResponse([productItem()])
          : emptyOfficialResponse();
      }
      if (url.pathname.endsWith("/getDrugPrdtPrmsnDtlInq06")) {
        return officialResponse([{
          ITEM_SEQ: "200001234",
          EE_DOC_DATA: '<DOC title="효능효과"><ARTICLE title="고혈압 치료" /></DOC>',
        }]);
      }
      return emptyOfficialResponse();
    },
    simplifier: async () => {
      throw new Error("temporary failure");
    },
  });

  assert.equal(result.status, "connected");
  if (result.status !== "connected") return;
  assert.equal(result.plainLanguageStatus, "unavailable");
  assert.match(result.items[0]?.consumerInfo?.efficacy ?? "", /고혈압 치료/);
  assert.equal(result.items[0]?.plainExplanation, undefined);
});

test("보강 API 응답이 공식 제품과 조인되지 않으면 완료로 표시하지 않는다", async () => {
  const result = await searchOfficialMedicationInfo("노바스크", {
    apiKey: "official-key",
    fetcher: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/getDrugPrdtPrmsnInq07")) {
        return url.searchParams.has("item_name")
          ? officialResponse([productItem()])
          : emptyOfficialResponse();
      }
      if (url.pathname.endsWith("/getDrbEasyDrugList")) {
        return officialResponse([{
          itemSeq: "999999999",
          itemName: "다른제품",
          efcyQesitm: "다른 제품의 정보",
        }]);
      }
      if (url.pathname.endsWith("/getParmgen")) {
        return officialResponse([{
          DRFSTF_KOR_NM: "와파린",
          DRFSTF_ENG_NM: "Warfarin",
          BASC_INFO: "다른 성분의 정보",
        }]);
      }
      if (url.pathname.endsWith("/getDrugPrdtPrmsnDtlInq06")) {
        return emptyOfficialResponse();
      }
      throw new Error(`unexpected request: ${url}`);
    },
  });

  assert.equal(result.status, "connected");
  if (result.status !== "connected") return;
  assert.equal(result.easyDrugStatus, "no_match");
  assert.equal(result.pharmacogenomicStatus, "no_match");
  assert.equal(result.items[0]?.consumerInfo, undefined);
  assert.equal(result.items[0]?.pharmacogenomicInfo, undefined);
});

test("제품명과 성분명 조회가 모두 실패하면 e약은요 결과로 조용히 대체하지 않는다", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const result = await searchOfficialMedicationInfo("테스트약", {
    apiKey: "official-key",
    fetcher: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/getDrugPrdtPrmsnInq07")) {
        return new Response("unavailable", { status: 503 });
      }
      return officialResponse([{
        itemSeq: "200009999",
        itemName: "테스트약",
        efcyQesitm: "공식 효능",
      }]);
    },
  });

  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.items, []);
});

test("제품명 또는 성분명 조회 하나만 성공하면 공식 결과와 부분 성공 상태를 유지한다", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const result = await searchOfficialMedicationInfo("노바스크", {
    apiKey: "official-key",
    fetcher: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/getDrugPrdtPrmsnInq07")) {
        if (url.searchParams.has("item_name")) return officialResponse([productItem()]);
        return new Response("unavailable", { status: 503 });
      }
      return emptyOfficialResponse();
    },
  });

  assert.equal(result.status, "connected");
  if (result.status !== "connected") return;
  assert.equal(result.productQueryStatus, "partial");
  assert.equal(result.items.length, 1);
});

test("정상 공식 조회의 무결과와 API 장애를 서로 다른 상태로 반환한다", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const empty = await searchOfficialMedicationInfo("없는약", {
    apiKey: "official-key",
    fetcher: async () => emptyOfficialResponse(),
  });
  const unavailable = await searchOfficialMedicationInfo("없는약", {
    apiKey: "official-key",
    fetcher: async () => new Response("unavailable", { status: 503 }),
  });

  assert.equal(empty.status, "connected");
  assert.deepEqual(empty.items, []);
  assert.equal(unavailable.status, "unavailable");
});
