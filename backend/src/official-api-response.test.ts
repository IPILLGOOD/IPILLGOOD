import assert from "node:assert/strict";
import test from "node:test";

import {
  OfficialApiResponseError,
  parseOfficialXml,
  readOfficialApiResponse,
  safeOfficialApiErrorCode,
} from "./official-api-response.ts";

function xmlResponse(body: BodyInit, headers: HeadersInit = {}) {
  return new Response(body, {
    headers: { "content-type": "application/xml; charset=utf-8", ...headers },
  });
}

test("예상 Content-Type과 실제 응답 형식이 다른 응답을 거부한다", async () => {
  await assert.rejects(
    readOfficialApiResponse(new Response("<response />", {
      headers: { "content-type": "text/html" },
    }), "xml"),
    (error) => error instanceof OfficialApiResponseError && error.code === "unexpected_content_type",
  );

  await assert.rejects(
    readOfficialApiResponse(new Response("not json", {
      headers: { "content-type": "application/json" },
    }), "json"),
    (error) => error instanceof OfficialApiResponseError && error.code === "unexpected_json_shape",
  );
});

test("Content-Length와 실제 스트림 모두에서 응답 크기 제한을 적용한다", async () => {
  await assert.rejects(
    readOfficialApiResponse(xmlResponse("<response />", { "content-length": "1000" }), "xml", {
      maxBytes: 100,
    }),
    (error) => error instanceof OfficialApiResponseError && error.code === "response_too_large",
  );

  await assert.rejects(
    readOfficialApiResponse(xmlResponse(`<response>${"x".repeat(200)}</response>`), "xml", {
      maxBytes: 100,
    }),
    (error) => error instanceof OfficialApiResponseError && error.code === "response_too_large",
  );
});

test("응답 body가 제한 시간 내 완료되지 않으면 취소한다", async () => {
  const hangingBody = new ReadableStream({ pull: () => new Promise(() => undefined) });
  await assert.rejects(
    readOfficialApiResponse(xmlResponse(hangingBody), "xml", { timeoutMs: 10 }),
    (error) => error instanceof OfficialApiResponseError && error.code === "response_timeout",
  );
});

test("DOCTYPE과 과도한 숫자 엔티티를 parser 실행 전에 거부한다", () => {
  assert.throws(
    () => parseOfficialXml("<!DOCTYPE root [<!ENTITY x 'boom'>]><root>&x;</root>"),
    (error) => error instanceof OfficialApiResponseError && error.code === "xml_dtd_not_allowed",
  );
  assert.throws(
    () => parseOfficialXml(`<root>${"&#65;".repeat(1_001)}</root>`),
    (error) => error instanceof OfficialApiResponseError && error.code === "xml_entity_limit_exceeded",
  );
});

test("관측용 오류 코드는 응답 본문이나 알 수 없는 예외 메시지를 노출하지 않는다", () => {
  assert.equal(safeOfficialApiErrorCode(new Error("secret payload")), "unexpected_official_api_error");
  assert.equal(
    safeOfficialApiErrorCode(new OfficialApiResponseError("response_too_large")),
    "response_too_large",
  );
});
