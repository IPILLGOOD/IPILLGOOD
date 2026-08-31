import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { pillSamplePages, profilePillCatalog, serializePillProfile } from "../scripts/profile-pill-catalog.ts";
import { pillEnvelope, pillRecord } from "../test-support/pill-fixtures.ts";

const response = (payload: string) => new Response(payload, { headers: { "content-type": "application/json" } });

test("표본 페이지는 앞·중간·끝을 포함하되 중복 없이 최대 여섯 페이지만 조회한다", () => {
  assert.deepEqual(pillSamplePages(25387), [1, 2, 64, 127, 190, 254]);
  assert.deepEqual(pillSamplePages(0), [1]);
  assert.deepEqual(pillSamplePages(1), [1]);
  assert.deepEqual(pillSamplePages(100), [1]);
  assert.deepEqual(pillSamplePages(101), [1, 2]);
  for (const invalid of [-1, 1.5, NaN, Infinity]) assert.throws(() => pillSamplePages(invalid));
});

test("표본 점검은 실제 페이지 검증을 거치며 이미지를 요청하거나 검색용 complete를 발행하지 않는다", async () => {
  const requested: number[] = [];
  const report = await profilePillCatalog({ apiKey: "test-key", fetcher: async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://apis.data.go.kr");
    assert.equal(init?.redirect, "error");
    assert.equal(url.searchParams.get("numOfRows"), "100");
    const pageNo = Number(url.searchParams.get("pageNo"));
    requested.push(pageNo);
    const totalCount = 905;
    const count = Math.min(100, totalCount - (pageNo - 1) * 100);
    const records = Array.from({ length: count }, (_, i) => pillRecord({ ITEM_SEQ: String(209900000 + (pageNo - 1) * 100 + i) }));
    return response(pillEnvelope(records, { pageNo, numOfRows: 100, totalCount }));
  } });
  assert.deepEqual(requested, [1, 2, 3, 5, 7, 10]);
  assert.equal(report.status, "sampled");
  assert.equal(report.sampledRecords, 505);
  assert.equal(report.uniqueItemSeqs, 505);
  assert.equal(report.images.downloaded, 0);
  assert.equal(report.initialTotalCount, 905);
  assert.equal("items" in report, false);
  assert.equal("completeness" in report, false);
});

test("누락·설명문·미상 제형·중복과 동일 품목의 변형을 별도로 집계한다", async () => {
  const original = pillRecord({ PRINT_FRONT: "마크분할선C8", FORM_CODE_NAME: "스팬슐", CHANGE_DATE: "20260230", ITEM_IMAGE: "http://example.invalid/image.png" });
  const report = await profilePillCatalog({ apiKey: "test", fetcher: async () => response(pillEnvelope([
    original, original,
    pillRecord({ PRINT_FRONT: "깅코탄", PRINT_BACK: "", LINE_BACK: null, ITEM_IMAGE: null, IMG_REGIST_TS: "bad", CHANGE_DATE: "" }),
  ])) });
  assert.equal(report.status, "sampled");
  assert.equal(report.sampledRecords, 3);
  assert.equal(report.exactDuplicateRows, 1);
  assert.deepEqual(report.repeatedItemSeqs, [{ itemSeq: "209900001", records: 3, distinctAppearances: 2 }]);
  assert.deepEqual(report.unknownForms, [{ value: "스팬슐", count: 2 }]);
  assert.deepEqual(report.imprintDescriptionCounts, { scoreLine: 2, mark: 2, otherHangul: 1 });
  assert.equal(report.missingFields.PRINT_BACK, 1);
  assert.equal(report.images.missingImageUrls, 1);
  assert.equal(report.images.rejectedImageUrls, 2);
  assert.equal(report.dates.invalidChangedDates, 2);
  assert.equal(report.dates.invalidImageDates, 1);
});

test("표본 수집 도중 totalCount가 달라지면 혼합 스냅샷을 성공으로 표시하지 않는다", async () => {
  let calls = 0;
  const report = await profilePillCatalog({ apiKey: "test", fetcher: async (input) => {
    calls++;
    const pageNo = Number(new URL(String(input)).searchParams.get("pageNo"));
    return response(pillEnvelope(Array.from({ length: 100 }, () => pillRecord()), { pageNo, totalCount: pageNo === 1 ? 200 : 201 }));
  } });
  assert.equal(calls, 2);
  assert.equal(report.status, "incomplete");
  assert.deepEqual(report.failure, { pageNo: 2, reason: "total_count_changed" });
  assert.equal(report.sampledRecords, 100);
});

test("접근 거절·제한·잘못된 페이지·초과 크기를 재시도하거나 정상 표본으로 바꾸지 않는다", async () => {
  for (const failureResponse of [
    new Response("url?serviceKey=secret", { status: 403 }),
    new Response("url?serviceKey=secret", { status: 429 }),
    response(pillEnvelope([pillRecord()], { pageNo: 2 })),
    new Response("secret", { headers: { "content-type": "application/json", "content-length": String(2 * 1024 * 1024) } }),
    response("{broken secret"),
  ]) {
    let calls = 0;
    const report = await profilePillCatalog({ apiKey: "secret", fetcher: async () => { calls++; return failureResponse; } });
    assert.equal(calls, 1);
    assert.equal(report.status, "incomplete");
    assert.equal(report.sampledRecords, 0);
    assert.equal(JSON.stringify(report).includes("secret"), false);
  }
});

test("키 미설정·네트워크 실패·정상 빈 응답을 구분하고 원문 오류를 출력하지 않는다", async (context) => {
  const logs = context.mock.method(console, "log", () => {});
  const errors = context.mock.method(console, "error", () => {});
  const noKey = await profilePillCatalog({ apiKey: "", fetcher: async () => { throw new Error("must not fetch"); } });
  assert.equal(noKey.failure?.reason, "not_configured");
  const failed = await profilePillCatalog({ apiKey: "secret", fetcher: async () => { throw new Error("url?serviceKey=secret"); } });
  assert.equal(failed.status, "incomplete");
  assert.equal(JSON.stringify(failed).includes("secret"), false);
  const empty = await profilePillCatalog({ apiKey: "test", fetcher: async () => response(pillEnvelope([])) });
  assert.equal(empty.status, "sampled");
  assert.equal(empty.sampledRecords, 0);
  assert.equal(empty.initialTotalCount, 0);
  assert.equal(logs.mock.calls.length, 0);
  assert.equal(errors.mock.calls.length, 0);
});

test("명시적인 --live 없이는 CLI가 외부 API를 실행하지 않는다", () => {
  const script = fileURLToPath(new URL("../scripts/profile-pill-catalog.ts", import.meta.url));
  const result = spawnSync(process.execPath, ["--experimental-strip-types", script], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Explicit --live is required/);
  assert.equal(result.stdout, "");
});

test("점검 출력의 키 반사값은 인코딩·따옴표 여부와 무관하게 마스킹하고 JSON 구조를 유지한다", () => {
  const report = { count: 1, examples: ['key+="abc"', 'key%2B%3D%22abc%22', "1"], safe: "정상" };
  const serialized = serializePillProfile(report, { MFDS_PILL_API_KEY: 'key+="abc"', OTHER_SECRET: "1", IGNORE_VALUE: "정상" });
  assert.deepEqual(JSON.parse(serialized), { count: 1, examples: ["[REDACTED]", "[REDACTED]", "[REDACTED]"], safe: "정상" });
  assert.equal(serializePillProfile({ value: "test+key=" }, { MFDS_PILL_API_KEY: "test%2Bkey%3D" }).includes("test+key"), false);
});
