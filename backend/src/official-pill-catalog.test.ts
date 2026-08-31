import assert from "node:assert/strict";
import test from "node:test";
import { fetchOfficialPillPage, parseOfficialPillPage } from "./official-pill-catalog.ts";
import { pillEnvelope, pillRecord } from "../test-support/pill-fixtures.ts";

const fetchedAt = "2026-08-31T00:00:00.000Z";

test("낱알 JSON을 정규화하고 공식 변경일과 조회 시각을 구분한다", () => {
  const page = parseOfficialPillPage(pillEnvelope([pillRecord()]), "json", fetchedAt);
  const item = page.items[0]!;
  assert.equal(item.itemSeq, "209900001");
  assert.equal(item.form, "tablet");
  assert.equal(item.formName, "필름코팅정");
  assert.deepEqual(item.colors, ["하양"]);
  assert.deepEqual(item.front, { imprint: "TEST", scoreLine: "single", mark: null });
  assert.equal(item.back.scoreLine, "cross");
  assert.equal(item.source.changedAt, "2026-08-01");
  assert.equal(item.source.imageRegisteredAt, "2026-01-01");
  assert.equal(item.source.fetchedAt, fetchedAt);
  assert.match(item.source.url, /15057639/);
});

test("빈 공식 필드는 각인·분할선 없음으로 단정하지 않고 unknown으로 남긴다", () => {
  const item = parseOfficialPillPage(pillEnvelope([pillRecord({
    FORM_CODE_NAME: "", PRINT_BACK: "", LINE_BACK: "", CHANGE_DATE: "20260230",
    ITEM_IMAGE: "javascript:alert(1)", MARK_CODE_BACK_ANAL: "회사 마크",
  })]), "json", fetchedAt).items[0]!;
  assert.equal(item.form, "unknown");
  assert.equal(item.back.imprint, null);
  assert.equal(item.back.scoreLine, "unknown");
  assert.equal(item.back.mark, "회사 마크");
  assert.equal(item.source.changedAt, null);
  assert.equal(item.imageUrl, null);
});

test("XML 단일 항목, JSON 중첩 항목, 무결과를 처리한다", () => {
  const page = parseOfficialPillPage(`<response><header><resultCode>00</resultCode></header>
    <body><pageNo>1</pageNo><numOfRows>100</numOfRows><totalCount>1</totalCount><items><item>
    <ITEM_SEQ>209900001</ITEM_SEQ><ITEM_NAME>테스트</ITEM_NAME><FORM_CODE_NAME>경질캡슐제</FORM_CODE_NAME>
    <PRINT_FRONT>001</PRINT_FRONT></item></items></body></response>`, "xml", fetchedAt);
  assert.equal(page.items[0]?.front.imprint, "001");
  assert.equal(page.items[0]?.form, "capsule");
  const nested = JSON.stringify({ response: JSON.parse(pillEnvelope([], { items: { item: pillRecord() }, totalCount: 1 })) });
  assert.equal(parseOfficialPillPage(nested, "json", fetchedAt).items.length, 1);
  assert.equal(parseOfficialPillPage(pillEnvelope([]), "json", fetchedAt).totalCount, 0);
});

test("오류, 잘못된 필수값·페이지·items를 정상 무결과로 바꾸지 않는다", () => {
  for (const payload of [
    "{}", pillEnvelope([pillRecord({ ITEM_SEQ: "wrong" })]),
    pillEnvelope([pillRecord({ ITEM_NAME: "" })]),
    pillEnvelope([], { totalCount: "invalid" }),
    pillEnvelope([], { totalCount: 10 }),
    pillEnvelope([], { items: "broken" }),
    pillEnvelope([], { pageNo: 0 }),
    pillEnvelope([pillRecord()], { numOfRows: 0 }),
  ]) assert.throws(() => parseOfficialPillPage(payload, "json", fetchedAt));
  assert.throws(() => parseOfficialPillPage("<!DOCTYPE response><response/>", "xml", fetchedAt));
});

test("같은 품목의 여러 식별표시 버전을 버리지 않는다", () => {
  const page = parseOfficialPillPage(pillEnvelope([
    pillRecord(), pillRecord({ PRINT_FRONT: "NEW", CHANGE_DATE: "20260831" }),
  ]), "json", fetchedAt);
  assert.equal(page.items.length, 2);
});

test("공식 최신 v03에만 키를 보내며 지원되지 않는 외형 파라미터는 보내지 않는다", async () => {
  const result = await fetchOfficialPillPage({ pageNo: 2, numOfRows: 3, itemSeq: "209900001" }, {
    apiKey: "test%2Bkey%3D", now: new Date(fetchedAt),
    fetcher: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://apis.data.go.kr");
      assert.equal(url.pathname, "/1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03");
      assert.equal(url.searchParams.get("serviceKey"), "test+key=");
      assert.equal(url.searchParams.get("item_seq"), "209900001");
      assert.equal(url.searchParams.get("pageNo"), "2");
      assert.equal(url.searchParams.has("drug_shape"), false);
      assert.equal(init?.redirect, "error");
      return new Response(pillEnvelope([pillRecord()], { pageNo: 2, numOfRows: 3, totalCount: 4 }), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(result.status, "connected");
});

test("미설정, 접근 거절, 제한, 통신·파싱 실패는 무결과와 분리한다", async () => {
  const none = await fetchOfficialPillPage({}, { apiKey: "", fetcher: async () => { throw new Error("must not fetch"); } });
  assert.equal(none.status, "not_configured");
  for (const [status, reason] of [[403, "access_denied"], [429, "rate_limited"], [500, "api_error"]] as const) {
    const result = await fetchOfficialPillPage({}, { apiKey: "secret", fetcher: async () => new Response("secret reflected", { status }) });
    assert.equal(result.status, "unavailable");
    if (result.status === "unavailable") assert.equal(result.reason, reason);
    assert.equal(JSON.stringify(result).includes("secret"), false);
  }
  const failed = await fetchOfficialPillPage({}, { apiKey: "secret", fetcher: async () => { throw new Error("url?serviceKey=secret"); } });
  assert.equal(failed.status, "unavailable");
  assert.equal(JSON.stringify(failed).includes("secret"), false);
  const malformed = await fetchOfficialPillPage({}, { apiKey: "secret", fetcher: async () => new Response("{}", { headers: { "content-type": "application/json" } }) });
  assert.equal(malformed.status, "unavailable");
});

test("페이지 범위와 응답 페이지 불일치를 검증한다", async () => {
  const invalid = await fetchOfficialPillPage({ numOfRows: 10000 }, { apiKey: "test", fetcher: async () => { throw new Error("must not fetch"); } });
  assert.equal(invalid.status, "invalid_input");
  const wrongPage = await fetchOfficialPillPage({ pageNo: 2 }, { apiKey: "test", fetcher: async () => new Response(pillEnvelope([pillRecord()]), { headers: { "content-type": "application/json" } }) });
  assert.equal(wrongPage.status, "unavailable");
});

test("성공 HTTP라도 잘못된 응답 타입·초과 크기·다른 품목은 후보 데이터로 받지 않는다", async () => {
  for (const response of [
    new Response("<html>upstream error</html>", { headers: { "content-type": "text/html" } }),
    new Response(pillEnvelope([pillRecord()]), { headers: { "content-type": "application/json", "content-length": String(2 * 1024 * 1024) } }),
    new Response(pillEnvelope([pillRecord({ ITEM_SEQ: "209900099" })]), { headers: { "content-type": "application/json" } }),
  ]) {
    const result = await fetchOfficialPillPage({ itemSeq: "209900001" }, { apiKey: "test", fetcher: async () => response });
    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.items, []);
  }
});

test("공식 빈 결과는 연결 성공으로 유지하고 실제 키·원문·오류 URL은 로그에 남기지 않는다", async (context) => {
  const errors = context.mock.method(console, "error", () => {});
  const logs = context.mock.method(console, "log", () => {});
  const result = await fetchOfficialPillPage({}, {
    apiKey: "secret", fetcher: async () => new Response(pillEnvelope([]), { headers: { "content-type": "application/json" } }),
  });
  assert.equal(result.status, "connected");
  assert.deepEqual(result.items, []);
  await fetchOfficialPillPage({}, { apiKey: "secret", fetcher: async () => { throw new Error("request?serviceKey=secret"); } });
  assert.equal(errors.mock.calls.length, 0);
  assert.equal(logs.mock.calls.length, 0);
});
