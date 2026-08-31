import assert from "node:assert/strict";
import test from "node:test";
import { parseOfficialPillPage } from "./official-pill-catalog.ts";
import { searchPillCandidates, type PillCatalog } from "./pill-identification.ts";
import { pillEnvelope, pillObservation, pillRecord } from "../test-support/pill-fixtures.ts";

function catalog(records = [pillRecord()]): PillCatalog {
  return {
    ...parseOfficialPillPage(pillEnvelope(records), "json", "2026-08-31T00:00:00.000Z"),
    completeness: "complete", version: "synthetic-fixture-v1",
  };
}

test("온전한 단일 정제의 특징 일치 근거를 반환하고 검색은 입력을 변경하지 않는다", () => {
  const input = pillObservation();
  const data = catalog();
  const before = JSON.stringify({ input, data });
  const result = searchPillCandidates(input, data);
  assert.equal(result.status, "candidates_found");
  assert.equal(result.candidates[0]?.itemSeq, "209900001");
  assert.equal(result.candidates[0]?.matchType, "exact");
  assert.equal(result.candidates[0]?.variants[0]?.orientation, "direct");
  assert.equal(result.metrics.candidateCount, 1);
  assert.equal(JSON.stringify({ input, data }), before);
  assert.match(result.notice, /후보/);
  assert.equal("medicationPlan" in result, false);
});

test("제형·색상·모양·각인·분할선 단계별 후보 수와 결정적인 순서를 반환한다", () => {
  const records = [
    pillRecord({ ITEM_SEQ: "209900008", PRINT_FRONT: "TESTABC" }),
    pillRecord({ ITEM_SEQ: "209900002" }), pillRecord(),
    pillRecord({ ITEM_SEQ: "209900003", FORM_CODE_NAME: "경질캡슐제" }),
    pillRecord({ ITEM_SEQ: "209900004", COLOR_CLASS1: "노랑" }),
    pillRecord({ ITEM_SEQ: "209900005", DRUG_SHAPE: "타원형" }),
    pillRecord({ ITEM_SEQ: "209900006", PRINT_FRONT: "OTHER" }),
    pillRecord({ ITEM_SEQ: "209900007", LINE_FRONT: "+" }),
  ];
  const result = searchPillCandidates(pillObservation(), catalog(records));
  assert.deepEqual(result.metrics.stages.map((step) => step.remaining), [7, 6, 5, 4, 3]);
  assert.deepEqual(result.candidates.map((item) => item.itemSeq), ["209900001", "209900002", "209900008"]);
  assert.equal(result.candidates[2]?.matchType, "partial");
  assert.deepEqual(searchPillCandidates(pillObservation(), catalog([...records].reverse())), result);
});

test("앞뒤 뒤집힘은 각인과 분할선을 함께 바꿔 대조한다", () => {
  const input = pillObservation({
    front: { imprint: "10", scoreLine: "cross" },
    back: { imprint: "TEST", scoreLine: "single" },
  });
  const found = searchPillCandidates(input, catalog());
  assert.equal(found.candidates[0]?.variants[0]?.orientation, "swapped");
  const mixed = searchPillCandidates(pillObservation({
    front: { imprint: "10", scoreLine: "single" },
    back: { imprint: "TEST", scoreLine: "cross" },
  }), catalog());
  assert.equal(mixed.status, "unidentified");
});

test("한 방향의 각인이 같아도 분할선에 맞는 다른 방향을 검사한다", () => {
  const records = catalog([pillRecord({ PRINT_FRONT: "TEST", PRINT_BACK: "TEST" })]);
  const result = searchPillCandidates(pillObservation({
    front: { imprint: "TEST", scoreLine: "cross" }, back: { imprint: "TEST", scoreLine: "single" },
  }), records);
  assert.equal(result.candidates[0]?.variants[0]?.orientation, "swapped");
});

test("캡슐의 양쪽 색상을 지원하고 각인의 0/O와 부호를 임의로 바꾸지 않는다", () => {
  const data = catalog([pillRecord({ FORM_CODE_NAME: "경질캡슐제", COLOR_CLASS1: "하양", COLOR_CLASS2: "파랑", PRINT_FRONT: "T0+" })]);
  const input = pillObservation({ form: "capsule", colors: ["파랑", "하양"], front: { imprint: "T0+", scoreLine: "single" } });
  assert.equal(searchPillCandidates(input, data).status, "candidates_found");
  assert.equal(searchPillCandidates({ ...input, front: { imprint: "TO+", scoreLine: "single" } }, data).status, "unidentified");
});

test("공식 특징 누락은 완전 일치가 아니며 같은 품목의 식별 변형을 보존한다", () => {
  const data = catalog([pillRecord(), pillRecord({ LINE_FRONT: "", IMG_REGIST_TS: "20260201" })]);
  const result = searchPillCandidates(pillObservation(), data);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.variants.length, 2);
  assert.equal(result.candidates[0]?.variants[1]?.matchType, "incomplete");
});

test("외형을 모두 모르는 공식 레코드는 모든 약의 후보로 제시하지 않는다", () => {
  const data = catalog([pillRecord({ FORM_CODE_NAME: "", DRUG_SHAPE: "", COLOR_CLASS1: "", PRINT_FRONT: "", PRINT_BACK: "", LINE_FRONT: "", LINE_BACK: "" })]);
  assert.equal(searchPillCandidates(pillObservation(), data).status, "unidentified");
});

test("사진 상태 메타데이터에 따라 미지원·재확인 상태를 반환한다 (이미지 인식 테스트 아님)", () => {
  for (const form of ["powder", "granule", "liquid", "other"] as const) {
    assert.equal(searchPillCandidates(pillObservation({ form }), undefined).status, "unsupported_form");
  }
  for (const integrity of ["split", "damaged"] as const) {
    assert.equal(searchPillCandidates(pillObservation({ integrity }), undefined).status, "unsupported_form");
  }
  for (const patch of [
    { count: 2 }, { overlapping: true }, { quality: "blurred" as const }, { quality: "dark" as const },
    { integrity: "unknown" as const }, { front: null }, { back: null },
    { front: { imprint: null, scoreLine: "unknown" as const } }, { shape: null }, { colors: [] },
  ]) assert.equal(searchPillCandidates(pillObservation(patch), undefined).status, "needs_retake");
  assert.equal(searchPillCandidates(pillObservation({ count: 0 }), undefined).status, "unidentified");
});

test("잘못된 입력·미설정·불완전 카탈로그와 정상 무결과를 구분한다", () => {
  assert.equal(searchPillCandidates({}, catalog()).status, "invalid_input");
  assert.equal(searchPillCandidates({ ...pillObservation(), image: "sensitive" }, catalog()).status, "invalid_input");
  assert.equal(searchPillCandidates(pillObservation(), undefined).status, "not_configured");
  const partial = searchPillCandidates(pillObservation(), { ...catalog(), completeness: "partial" });
  assert.equal(partial.status, "unavailable");
  assert.equal(searchPillCandidates(pillObservation(), { ...catalog(), totalCount: 100 }).status, "unavailable");
  assert.equal(searchPillCandidates(pillObservation(), catalog([])).status, "unidentified");
});

test("결과 제한 시에도 전체 후보 수를 유지하고 확정 상태를 만들지 않는다", () => {
  const data = catalog([pillRecord(), pillRecord({ ITEM_SEQ: "209900002" })]);
  const result = searchPillCandidates(pillObservation(), data, { limit: 1 });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.metrics.candidateCount, 2);
  assert.equal(result.truncated, true);
  assert.equal(result.status, "candidates_found");
  assert.deepEqual(Object.keys(result.metrics).sort(), ["candidateCount", "catalogRecords", "returnedCount", "stages"]);
});

test("글자 없음 관찰과 공식 필드 누락·마크 존재를 구분한다", () => {
  const input = pillObservation({ front: { imprint: "", scoreLine: "single" } });
  const missing = searchPillCandidates(input, catalog([pillRecord({ PRINT_FRONT: "" })]));
  assert.equal(missing.candidates[0]?.matchType, "incomplete");
  const marked = searchPillCandidates(input, catalog([pillRecord({ PRINT_FRONT: "", MARK_CODE_FRONT_ANAL: "로고" })]));
  assert.equal(marked.status, "unidentified");
});

test("다른 종류의 기타 분할선을 완전 일치로 처리하지 않는다", () => {
  const input = pillObservation({ front: { imprint: "TEST", scoreLine: "other" } });
  const result = searchPillCandidates(input, catalog([pillRecord({ LINE_FRONT: "Y" })]));
  assert.equal(result.candidates[0]?.matchType, "incomplete");
});

test("유니코드·공백 정규화는 양쪽 입력에 같게 적용하고 두 출처는 같은 후보를 반환한다", () => {
  const input = pillObservation({ front: { imprint: "ｔｅｓｔ", scoreLine: "single" }, back: { imprint: "1 0", scoreLine: "cross" } });
  const manual = searchPillCandidates(input, catalog());
  assert.equal(manual.candidates[0]?.matchType, "exact");
  assert.deepEqual(searchPillCandidates({ ...input, source: "image_features" }, catalog()), manual);
});

test("분할선이 섞인 실제 표기에서 글자로 검색하되 완전 일치로 승격하지 않는다", () => {
  const data = catalog([pillRecord({ PRINT_FRONT: "V분할선T" })]);
  const input = pillObservation({ front: { imprint: "VT", scoreLine: "single" } });
  const result = searchPillCandidates(input, data);
  assert.equal(result.status, "candidates_found");
  assert.equal(result.candidates[0]?.matchType, "incomplete");
  assert.equal(result.candidates[0]?.variants[0]?.item.front.rawImprint, "V분할선T");
  assert.equal(result.candidates[0]?.variants[0]?.evidence.find((item) => item.field === "front.imprint")?.match, "exact");
  assert.equal(result.candidates[0]?.variants[0]?.evidence.find((item) => item.field === "front.imprintDescription")?.match, "unknown");
  assert.equal(searchPillCandidates({ ...input, front: { imprint: "VX", scoreLine: "single" } }, data).status, "unidentified");
  assert.equal(searchPillCandidates({ ...input, front: { imprint: "VT", scoreLine: "cross" } }, data).status, "unidentified");
  const swapped = searchPillCandidates({ ...input, front: input.back, back: input.front }, data);
  assert.equal(swapped.candidates[0]?.variants[0]?.orientation, "swapped");
});

test("설명만 있는 면은 글자 없음의 확정이 아니며 마크도 완전 일치 근거가 아니다", () => {
  const blank = pillObservation({ front: { imprint: "", scoreLine: "single" } });
  assert.equal(searchPillCandidates(blank, catalog([pillRecord({ PRINT_FRONT: "분할선" })])).candidates[0]?.matchType, "incomplete");
  assert.equal(searchPillCandidates(blank, catalog([pillRecord({ PRINT_FRONT: "마크" })])).status, "unidentified");
  const marked = catalog([pillRecord({ PRINT_FRONT: "마크분할선C8" })]);
  assert.equal(searchPillCandidates(pillObservation({ front: { imprint: "C8", scoreLine: "single" } }), marked).candidates[0]?.matchType, "incomplete");
  assert.equal(searchPillCandidates(pillObservation(), catalog([pillRecord({ MARK_CODE_FRONT_ANAL: "로고" })])).candidates[0]?.matchType, "incomplete");
});

test("쉼표로 나뉜 색상은 개별 특징으로 검색하고 투명 누락은 부분 일치다", () => {
  const data = catalog([pillRecord({ COLOR_CLASS1: "노랑, 투명" })]);
  assert.equal(searchPillCandidates(pillObservation({ colors: ["노랑", "투명"] }), data).candidates[0]?.matchType, "exact");
  assert.equal(searchPillCandidates(pillObservation({ colors: ["노랑"] }), data).candidates[0]?.matchType, "partial");
  assert.equal(searchPillCandidates(pillObservation({ colors: ["하양"] }), data).status, "unidentified");
});

test("기타 모양은 같은 외형으로 확정하거나 다른 구체적 모양과 불일치로 단정하지 않는다", () => {
  for (const [observed, official] of [["기타", "기타"], ["원형", "기타"], ["기타", "원형"]]) {
    const result = searchPillCandidates(pillObservation({ shape: observed }), catalog([pillRecord({ DRUG_SHAPE: official })]));
    assert.equal(result.candidates[0]?.matchType, "incomplete");
    assert.equal(result.candidates[0]?.variants[0]?.evidence.find((item) => item.field === "shape")?.match, "unknown");
  }
});

test("정제 세부표기로 정규화한 후보도 가루약·반쪽 관찰에는 제시하지 않는다", () => {
  const data = catalog([pillRecord({ FORM_CODE_NAME: "정제, 미분류" })]);
  assert.equal(searchPillCandidates(pillObservation(), data).status, "candidates_found");
  assert.equal(searchPillCandidates(pillObservation({ form: "powder" }), data).status, "unsupported_form");
  assert.equal(searchPillCandidates(pillObservation({ integrity: "split" }), data).status, "unsupported_form");
});
