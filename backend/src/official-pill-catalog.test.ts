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
  assert.deepEqual(item.front, { rawImprint: "TEST", imprint: "TEST", imprintHasDescription: false, scoreLine: "single", mark: null });
  assert.equal(item.back.scoreLine, "cross");
  assert.equal(item.source.changedAt, "2026-08-01");
  assert.equal(item.source.imageRegisteredAt, "2026-01-01");
  assert.equal(item.source.fetchedAt, fetchedAt);
  assert.match(item.source.url, /15057639/);
});

// These are synthetic records carrying expressions observed in the 2026-08-31 live sample.
test("실제 제형 표기의 미분류·괄호와 캡슐 내용물을 구분하고 미상 제형은 추정하지 않는다", () => {
  for (const [raw, expected] of [
    ["정제, 미분류", "tablet"], ["추어블정(저작정)", "tablet"],
    ["서방성다층정", "tablet"], ["구강붕해정", "tablet"],
    ["경질캡슐제, 산제", "capsule"], ["경질캡슐제, 정제", "capsule"],
    ["연질캡슐제, 액상", "capsule"], ["캡슐, 미분류", "capsule"],
    ["스팬슐", "unknown"], ["산제", "unknown"], ["액상", "unknown"],
    ["새로운정", "unknown"], ["캡슐이 아닌 제형", "unknown"], ["", "unknown"],
  ]) {
    const item = parseOfficialPillPage(pillEnvelope([pillRecord({ FORM_CODE_NAME: raw })]), "json", fetchedAt).items[0]!;
    assert.equal(item.form, expected, raw);
    assert.equal(item.formName, raw || null);
  }
});

test("쉼표와 파이프 색상 목록을 정리하되 투명·혼합색 정보를 버리지 않는다", () => {
  const item = parseOfficialPillPage(pillEnvelope([pillRecord({
    COLOR_CLASS1: "노랑， 투명 | 하양", COLOR_CLASS2: "하양, 노랑,, ",
  })]), "json", fetchedAt).items[0]!;
  assert.deepEqual(item.colors, ["노랑", "투명", "하양"]);
});

test("분할선·십자분할선 설명은 글자 각인과 분리하고 원문과 미상 상태를 보존한다", () => {
  for (const [raw, imprint] of [
    ["분할선", null], ["십자분할선", null], ["V분할선T", "V T"],
    ["Λ+분할선16", "Λ+ 16"], ["R분할선0.5", "R 0.5"],
    ["L분할선1분할선1분할선L", "L 1 1 L"],
  ]) {
    const side = parseOfficialPillPage(pillEnvelope([pillRecord({ PRINT_FRONT: raw, LINE_FRONT: "" })]), "json", fetchedAt).items[0]!.front;
    assert.equal(side.rawImprint, raw);
    assert.equal(side.imprint, imprint);
    assert.equal(side.imprintHasDescription, true);
    assert.equal(side.scoreLine, "unknown");
  }
  const conflicting = parseOfficialPillPage(pillEnvelope([pillRecord({ PRINT_FRONT: "십자분할선", LINE_FRONT: "-" })]), "json", fetchedAt).items[0]!.front;
  assert.equal(conflicting.scoreLine, "single", "PRINT_* must not override LINE_*");
});

test("마크 설명에서 비교 가능한 글자는 보존하되 마크 존재를 지우지 않는다", () => {
  for (const [raw, imprint] of [["마크", null], ["마크분할선C8", "C8"], ["TONEX-F 마크", "TONEX-F"]]) {
    const side = parseOfficialPillPage(pillEnvelope([pillRecord({ PRINT_FRONT: raw })]), "json", fetchedAt).items[0]!.front;
    assert.equal(side.rawImprint, raw);
    assert.equal(side.imprint, imprint);
    assert.equal(side.mark, "마크");
    assert.equal(side.imprintHasDescription, true);
  }
  const side = parseOfficialPillPage(pillEnvelope([pillRecord({ PRINT_FRONT: "마크분할선C8", MARK_CODE_FRONT_ANAL: "P,d" })]), "json", fetchedAt).items[0]!.front;
  assert.equal(side.mark, "P,d");
});

test("한글 각인·기호·소수점·0/O는 설명문으로 지우거나 치환하지 않는다", () => {
  for (const imprint of ["깅코탄", "마이에신 마이에신", "마크론", "40/20", "T/A ER", "Λ+", "0.5", "O0", "-", "+"]) {
    const side = parseOfficialPillPage(pillEnvelope([pillRecord({ PRINT_FRONT: imprint })]), "json", fetchedAt).items[0]!.front;
    assert.equal(side.imprint, imprint);
    assert.equal(side.rawImprint, imprint);
    assert.equal(side.imprintHasDescription, false);
  }
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
