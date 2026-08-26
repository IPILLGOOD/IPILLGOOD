import assert from "node:assert/strict";
import test from "node:test";

import {
  parseOfficialDiseaseResponse,
  searchOfficialDiseaseInfo,
  selectOfficialDiseaseMatch,
} from "./official-disease-api.ts";

const successXml = `<?xml version="1.0" encoding="UTF-8"?>
  <response>
    <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
    <body>
      <items>
        <item><sickCd>I10</sickCd><sickNm>본태성(원발성) 고혈압</sickNm><sickEngNm>Essential hypertension</sickEngNm></item>
        <item><sickCd>I11.9</sickCd><sickNm>고혈압성 심장병</sickNm><sickEngNm>Hypertensive heart disease</sickEngNm></item>
      </items>
    </body>
  </response>`;

test("건강보험심사평가원 XML 응답을 질병 목록으로 정규화한다", () => {
  const items = parseOfficialDiseaseResponse(successXml);

  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    code: "I10",
    koreanName: "본태성(원발성) 고혈압",
    englishName: "Essential hypertension",
  });
});

test("질병코드가 있으면 이름보다 정확한 코드 매칭을 우선한다", () => {
  const items = parseOfficialDiseaseResponse(successXml);
  const match = selectOfficialDiseaseMatch(items, "고혈압", "I10");

  assert.equal(match?.code, "I10");
});

test("관련 없는 검색 결과는 매칭으로 간주하지 않는다", () => {
  const items = parseOfficialDiseaseResponse(successXml);
  const match = selectOfficialDiseaseMatch(items, "당뇨병");

  assert.equal(match, undefined);
});

test("API 키가 없으면 네트워크를 호출하지 않고 폴백 가능한 상태를 반환한다", async () => {
  let called = false;
  const result = await searchOfficialDiseaseInfo("고혈압", undefined, {
    apiKey: "",
    fetcher: async () => {
      called = true;
      return new Response();
    },
  });

  assert.equal(called, false);
  assert.equal(result.status, "not_configured");
});

test("진단명 검색 파라미터를 전달하고 공식 일치 결과를 반환한다", async () => {
  let requestUrl = "";
  const result = await searchOfficialDiseaseInfo("본태성 고혈압", undefined, {
    apiKey: "secret-key",
    fetcher: async (input) => {
      requestUrl = String(input);
      return new Response(successXml, {
        status: 200,
        headers: { "content-type": "application/xml" },
      });
    },
  });

  const requested = new URL(requestUrl);
  assert.equal(requested.searchParams.get("diseaseType"), "SICK_NM");
  assert.equal(requested.searchParams.get("searchText"), "본태성 고혈압");
  assert.equal(result.status, "matched");
  assert.equal(JSON.stringify(result).includes("secret-key"), false);
});
