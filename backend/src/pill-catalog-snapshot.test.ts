import assert from "node:assert/strict";
import test from "node:test";
import { collectPillCatalogSnapshot, snapshotSearchCatalog, validatePillCatalogSnapshot, type PillCatalogSnapshot } from "./pill-catalog-snapshot.ts";
import { parseOfficialPillPage, type OfficialPillPageRequest, type OfficialPillPageResult } from "./official-pill-catalog.ts";
import { searchPillCandidates } from "./pill-identification.ts";
import { pillEnvelope, pillObservation, pillRecord } from "../test-support/pill-fixtures.ts";

const NOW = "2026-08-31T00:00:00.000Z";
const clock = () => new Date(NOW);
const records = (count: number) => Array.from({ length: count }, (_, index) => pillRecord({ ITEM_SEQ: String(209900000 + index) }));
function page(data: unknown[], request: OfficialPillPageRequest, fetchedAt = NOW): OfficialPillPageResult {
  const pageNo = request.pageNo!;
  return { status: "connected", ...parseOfficialPillPage(pillEnvelope(data.slice((pageNo - 1) * 100, pageNo * 100), {
    pageNo, numOfRows: 100, totalCount: data.length,
  }), "json", fetchedAt) };
}
async function fixtureSnapshot(data = [pillRecord()]): Promise<PillCatalogSnapshot> {
  const result = await collectPillCatalogSnapshot({ now: clock, readPage: async (request) => page(data, request) });
  assert.equal(result.status, "collected");
  return result.snapshot;
}

test("전체 페이지를 두 번 읽고 같은 내용일 때만 완전 카탈로그로 검색한다", async () => {
  const data = records(205);
  const calls: number[] = [];
  const progress: number[] = [];
  const result = await collectPillCatalogSnapshot({ now: clock,
    readPage: async (request) => { calls.push(request.pageNo!); return page(data, request); },
    onProgress: (event) => progress.push(event.requests),
  });
  assert.equal(result.status, "collected");
  if (result.status !== "collected") return;
  assert.deepEqual(calls, [1, 2, 3, 1, 2, 3]);
  assert.deepEqual(progress, [1, 2, 3, 4, 5, 6]);
  assert.equal(result.requests, 6);
  assert.equal(result.snapshot.totalCount, 205);
  const ready = snapshotSearchCatalog(result.snapshot, { now: clock(), maxAgeHours: 24 });
  assert.equal(ready.ok, true);
  if (ready.ok) {
    const found = searchPillCandidates(pillObservation(), ready.catalog, { limit: 2 });
    assert.equal(found.status, "candidates_found");
    assert.equal(found.metrics.catalogRecords, 205);
    assert.equal(found.metrics.candidateCount, 205);
    assert.equal(found.truncated, true);
  }
});

test("순회 사이 순서와 조회 시각이 바뀌어도 같은 공식 내용은 같은 버전이다", async () => {
  const data = records(105);
  let calls = 0;
  const first = await fixtureSnapshot(data);
  const result = await collectPillCatalogSnapshot({ now: clock, readPage: async (request) => {
    calls++;
    return page(calls <= 2 ? data : [...data].reverse(), request, calls <= 2 ? NOW : "2026-08-31T00:00:01.000Z");
  } });
  assert.equal(result.status, "collected");
  if (result.status === "collected") assert.equal(result.snapshot.version, first.version);
});

test("같은 행 수에서 공식 내용이 바뀌면 파일에 쓸 스냅샷을 반환하지 않는다", async () => {
  let calls = 0;
  const result = await collectPillCatalogSnapshot({ now: clock, readPage: async (request) => {
    calls++;
    return page([pillRecord({ PRINT_FRONT: calls === 1 ? "A" : "B" })], request);
  } });
  assert.deepEqual(result, { status: "incomplete", reason: "content_changed_between_passes", requests: 2, pass: 2, pageNo: 1 });
  assert.equal("snapshot" in result, false);
});

test("행 수 변화·빈 전체 응답·마지막 페이지 누락·잘못된 페이지는 공개하지 않는다", async () => {
  for (const mode of ["changed", "missing", "wrong-page", "empty"] as const) {
    let calls = 0;
    const result = await collectPillCatalogSnapshot({ now: clock, readPage: async (request) => {
      calls++;
      const response = page(mode === "empty" ? [] : records(101), request);
      if (response.status === "connected" && calls === 2) {
        if (mode === "changed") response.totalCount++;
        if (mode === "missing") response.items = [];
        if (mode === "wrong-page") response.pageNo = 1;
      }
      return response;
    } });
    assert.equal(result.status, "incomplete", mode);
    if (result.status === "incomplete") assert.equal(result.reason, mode === "changed" ? "total_count_changed" : mode === "empty" ? "empty_catalog_review_required" : "invalid_page");
    assert.equal("snapshot" in result, false);
  }
});

test("완전히 같은 행은 검토를 요구하지만 같은 품목의 다른 외형은 모두 보존한다", async () => {
  const duplicate = await collectPillCatalogSnapshot({ now: clock, readPage: async (request) => page([pillRecord(), pillRecord()], request) });
  assert.equal(duplicate.status, "incomplete");
  if (duplicate.status === "incomplete") assert.equal(duplicate.reason, "duplicate_records_review_required");
  const snapshot = await fixtureSnapshot([pillRecord(), pillRecord({ PRINT_FRONT: "TEST-V2" })]);
  assert.equal(snapshot.totalCount, 2);
  assert.equal(new Set(snapshot.items.map((item) => item.itemSeq)).size, 1);
});

test("접근 거절·호출 제한·통신 실패는 재시도하거나 키·원문을 반사하지 않는다", async () => {
  for (const reason of ["access_denied", "rate_limited", "api_error", "throw"] as const) {
    let calls = 0;
    const result = await collectPillCatalogSnapshot({ now: clock, readPage: async () => {
      calls++;
      if (reason === "throw") throw new Error("https://api.example/?key=secret");
      return { status: "unavailable", reason, items: [], sourceUrl: "https://example.test/secret" };
    } });
    assert.equal(result.status, "incomplete");
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(result).includes("secret"), false);
    assert.equal("snapshot" in result, false);
  }
});

test("2회 수집 요청 예산·시간·행 수 상한을 넘으면 안전하게 중단한다", async () => {
  let calls = 0;
  const overBudget = await collectPillCatalogSnapshot({ now: clock, maxRequests: 3, readPage: async (request) => { calls++; return page(records(101), request); } });
  assert.equal(overBudget.status, "incomplete");
  assert.equal(calls, 1);
  if (overBudget.status === "incomplete") assert.equal(overBudget.reason, "request_budget_exceeded");
  let time = Date.parse(NOW);
  const timeout = await collectPillCatalogSnapshot({ now: () => new Date(time), maxDurationMs: 1,
    beforeRequest: async () => { time += 2; }, readPage: async (request) => page([pillRecord()], request),
  });
  assert.equal(timeout.status, "incomplete");
  if (timeout.status === "incomplete") assert.equal(timeout.reason, "time_budget_exceeded");
  const invalid = await collectPillCatalogSnapshot({ maxRequests: NaN, readPage: async () => { throw new Error("must not request"); } });
  assert.equal(invalid.requests, 0);
  const tooMany = await collectPillCatalogSnapshot({ now: clock, readPage: async (request) => ({ ...page([pillRecord()], request), totalCount: 50_001 } as OfficialPillPageResult) });
  assert.equal(tooMany.status, "incomplete");
  if (tooMany.status === "incomplete") assert.equal(tooMany.reason, "record_budget_exceeded");
});

test("로컬 파일의 버전·행·검증 메타데이터 변조나 미완성 구조는 거절한다", async () => {
  const snapshot = await fixtureSnapshot();
  for (const mutate of [
    (copy: PillCatalogSnapshot) => { copy.items[0]!.front.imprint = "different"; },
    (copy: PillCatalogSnapshot) => { copy.items.pop(); },
    (copy: PillCatalogSnapshot) => { copy.totalCount++; },
    (copy: PillCatalogSnapshot) => { copy.verification.passes[1].pages++; },
    (copy: PillCatalogSnapshot) => { copy.verifiedAt = "2026-08-31T00:01:00.000Z"; },
    (copy: PillCatalogSnapshot) => { copy.items[0]!.source.fetchedAt = "2025-01-01T00:00:00.000Z"; },
    (copy: PillCatalogSnapshot) => { copy.items[0]!.imageUrl = "https://example.invalid/not-official"; },
  ]) {
    const copy = structuredClone(snapshot);
    mutate(copy);
    assert.equal(validatePillCatalogSnapshot(copy).ok, false);
  }
  assert.equal(validatePillCatalogSnapshot({ ...snapshot, status: "partial" }).ok, false);
  assert.equal(validatePillCatalogSnapshot({ items: snapshot.items, completeness: "complete" }).ok, false);
});

test("최신성 정책을 명시하고 만료·미래 시각의 카탈로그로는 검색하지 않는다", async () => {
  const snapshot = await fixtureSnapshot();
  assert.equal(snapshotSearchCatalog(snapshot, { now: new Date(Date.parse(NOW) + 3_600_000), maxAgeHours: 1 }).ok, true);
  for (const now of [new Date(Date.parse(NOW) - 1), new Date(Date.parse(NOW) + 3_600_001)]) {
    assert.deepEqual(snapshotSearchCatalog(snapshot, { now, maxAgeHours: 1 }), { ok: false, reason: "snapshot_expired_or_future" });
  }
  for (const maxAgeHours of [0, 0.5, -1, Infinity, NaN, 169]) assert.equal(snapshotSearchCatalog(snapshot, { now: clock(), maxAgeHours }).ok, false);
});
