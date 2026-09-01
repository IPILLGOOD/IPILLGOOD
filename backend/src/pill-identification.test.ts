import assert from "node:assert/strict";
import test from "node:test";
import { parseOfficialPillPage } from "./official-pill-catalog.ts";
import { migratePillObservationV1, observedPillSideSchema, PILL_OBSERVATION_SCHEMA_VERSION, pillObservationSchema, pillObservationV1Schema, searchPillCandidates, type PillCatalog } from "./pill-identification.ts";
import { observedSide, pillEnvelope, pillObservation, pillRecord } from "../test-support/pill-fixtures.ts";

function catalog(records = [pillRecord()]): PillCatalog {
  return {
    ...parseOfficialPillPage(pillEnvelope(records), "json", "2026-08-31T00:00:00.000Z"),
    completeness: "complete", version: "synthetic-fixture-v1",
  };
}

test("v2 계약은 원문 복수 각인을 보존하고 무각인·부분 판독·판독 불가의 모순을 거절한다", () => {
  const raw = " A5 / AS ";
  const parsed = pillObservationSchema.parse({ ...pillObservation(), front: {
    imprintCandidates: [raw, "45"], noImprintObserved: false, imprintVisibility: "partial", scoreLine: "unknown",
  } });
  assert.equal(parsed.schemaVersion, PILL_OBSERVATION_SCHEMA_VERSION);
  assert.deepEqual(parsed.front?.imprintCandidates, [raw, "45"], "검색 정규화 전 관찰 원문은 바꾸지 않는다");
  assert.equal(observedPillSideSchema.safeParse({ imprintCandidates: [], noImprintObserved: false, imprintVisibility: "partial", scoreLine: "unknown" }).success, true);
  for (const side of [
    { imprintCandidates: ["A"], noImprintObserved: true, imprintVisibility: "clear", scoreLine: "none" },
    { imprintCandidates: [], noImprintObserved: true, imprintVisibility: "partial", scoreLine: "none" },
    { imprintCandidates: ["A"], noImprintObserved: false, imprintVisibility: "unreadable", scoreLine: "none" },
    { imprintCandidates: [], noImprintObserved: false, imprintVisibility: "clear", scoreLine: "none" },
    { imprintCandidates: ["A", "B", "C", "D", "E", "F"], noImprintObserved: false, imprintVisibility: "partial", scoreLine: "none" },
    { imprintCandidates: ["   "], noImprintObserved: false, imprintVisibility: "partial", scoreLine: "none" },
  ]) assert.equal(observedPillSideSchema.safeParse(side).success, false);
});

test("역사적 v1 관찰은 원본을 변경하지 않고 v2의 무각인·판독 불가 상태로 결정적으로 변환한다", () => {
  const legacy = {
    source: "image_features", form: "tablet", integrity: "intact", count: 1, overlapping: false,
    quality: "clear", shape: "원형", colors: ["하양"],
    front: { imprint: null, scoreLine: "unknown" }, back: { imprint: "", scoreLine: "none" },
  };
  const before = JSON.stringify(legacy);
  assert.equal(pillObservationV1Schema.safeParse(legacy).success, true);
  assert.equal(pillObservationSchema.safeParse(legacy).success, false);
  const migrated = migratePillObservationV1(legacy);
  assert.equal(JSON.stringify(legacy), before);
  assert.deepEqual(migrated.front, observedSide(null, "unknown"));
  assert.deepEqual(migrated.back, observedSide("", "none"));
  assert.equal(migrated.schemaVersion, PILL_OBSERVATION_SCHEMA_VERSION);
  assert.equal(pillObservationV1Schema.safeParse(migrated).success, false);
});

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
  assert.equal(result.observationSchemaVersion, PILL_OBSERVATION_SCHEMA_VERSION);
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
    front: observedSide("10", "cross"),
    back: observedSide("TEST", "single"),
  });
  const found = searchPillCandidates(input, catalog());
  assert.equal(found.candidates[0]?.variants[0]?.orientation, "swapped");
  const mixed = searchPillCandidates(pillObservation({
    front: observedSide("10", "single"),
    back: observedSide("TEST", "cross"),
  }), catalog());
  assert.equal(mixed.status, "unidentified");
});

test("한 방향의 각인이 같아도 분할선에 맞는 다른 방향을 검사한다", () => {
  const records = catalog([pillRecord({ PRINT_FRONT: "TEST", PRINT_BACK: "TEST" })]);
  const result = searchPillCandidates(pillObservation({
    front: observedSide("TEST", "cross"), back: observedSide("TEST", "single"),
  }), records);
  assert.equal(result.candidates[0]?.variants[0]?.orientation, "swapped");
});

test("캡슐의 양쪽 색상을 지원하고 각인의 0/O와 부호를 임의로 바꾸지 않는다", () => {
  const data = catalog([pillRecord({ FORM_CODE_NAME: "경질캡슐제", COLOR_CLASS1: "하양", COLOR_CLASS2: "파랑", PRINT_FRONT: "T0+" })]);
  const input = pillObservation({ form: "capsule", colors: ["파랑", "하양"], front: observedSide("T0+", "single") });
  assert.equal(searchPillCandidates(input, data).status, "candidates_found");
  assert.equal(searchPillCandidates({ ...input, front: observedSide("TO+", "single") }, data).status, "unidentified");
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
    { front: observedSide(null, "unknown") }, { shape: null }, { colors: [] },
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
  assert.deepEqual(Object.keys(result.metrics).sort(), ["candidateCount", "catalogRecords", "heldCandidateCount", "heldReturnedCount", "matchedItemCount", "returnedCount", "stages", "unsupportedCatalogRecords"]);
});

test("글자 없음 관찰과 공식 필드 누락·마크 존재를 구분한다", () => {
  const input = pillObservation({ front: observedSide("", "single") });
  const missing = searchPillCandidates(input, catalog([pillRecord({ PRINT_FRONT: "" })]));
  assert.equal(missing.candidates[0]?.matchType, "incomplete");
  const marked = searchPillCandidates(input, catalog([pillRecord({ PRINT_FRONT: "", MARK_CODE_FRONT_ANAL: "로고" })]));
  assert.equal(marked.status, "unidentified");
});

test("다른 종류의 기타 분할선을 완전 일치로 처리하지 않는다", () => {
  const input = pillObservation({ front: observedSide("TEST", "other") });
  const result = searchPillCandidates(input, catalog([pillRecord({ LINE_FRONT: "Y" })]));
  assert.equal(result.candidates[0]?.matchType, "incomplete");
});

test("유니코드·공백 정규화는 양쪽 입력에 같게 적용하고 두 출처는 같은 후보를 반환한다", () => {
  const input = pillObservation({ front: observedSide("ｔｅｓｔ", "single"), back: observedSide("1 0", "cross") });
  const manual = searchPillCandidates(input, catalog());
  assert.equal(manual.candidates[0]?.matchType, "exact");
  assert.deepEqual(searchPillCandidates({ ...input, source: "image_features" }, catalog()), manual);
});

test("분할선이 섞인 실제 표기에서 글자로 검색하되 완전 일치로 승격하지 않는다", () => {
  const data = catalog([pillRecord({ PRINT_FRONT: "V분할선T" })]);
  const input = pillObservation({ front: observedSide("VT", "single") });
  const result = searchPillCandidates(input, data);
  assert.equal(result.status, "candidates_found");
  assert.equal(result.candidates[0]?.matchType, "incomplete");
  assert.equal(result.candidates[0]?.variants[0]?.item.front.rawImprint, "V분할선T");
  assert.equal(result.candidates[0]?.variants[0]?.evidence.find((item) => item.field === "front.imprint")?.match, "exact");
  assert.equal(result.candidates[0]?.variants[0]?.evidence.find((item) => item.field === "front.imprintDescription")?.match, "unknown");
  assert.equal(searchPillCandidates({ ...input, front: observedSide("VX", "single") }, data).status, "unidentified");
  assert.equal(searchPillCandidates({ ...input, front: observedSide("VT", "cross") }, data).status, "unidentified");
  const swapped = searchPillCandidates({ ...input, front: input.back, back: input.front }, data);
  assert.equal(swapped.candidates[0]?.variants[0]?.orientation, "swapped");
});

test("설명만 있는 면은 글자 없음의 확정이 아니며 마크도 완전 일치 근거가 아니다", () => {
  const blank = pillObservation({ front: observedSide("", "single") });
  assert.equal(searchPillCandidates(blank, catalog([pillRecord({ PRINT_FRONT: "분할선" })])).candidates[0]?.matchType, "incomplete");
  assert.equal(searchPillCandidates(blank, catalog([pillRecord({ PRINT_FRONT: "마크" })])).status, "unidentified");
  const marked = catalog([pillRecord({ PRINT_FRONT: "마크분할선C8" })]);
  assert.equal(searchPillCandidates(pillObservation({ front: observedSide("C8", "single") }), marked).candidates[0]?.matchType, "incomplete");
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

test("각인 근거가 있는 후보와 보류 항목은 표시 제한·건수를 독립적으로 유지한다", () => {
  const records = [
    ...Array.from({ length: 25 }, (_, index) => pillRecord({ ITEM_SEQ: String(209900000 + index), PRINT_FRONT: "", PRINT_BACK: "", LINE_FRONT: "", LINE_BACK: "" })),
    pillRecord({ ITEM_SEQ: "209900999", LINE_FRONT: "", LINE_BACK: "" }),
  ];
  const result = searchPillCandidates(pillObservation(), catalog(records), { limit: 1 });
  assert.equal(result.candidates[0]!.itemSeq, "209900999");
  assert.equal(result.candidates[0]!.matchType, "incomplete", "정렬을 바꿔도 확정이나 완전 일치로 승격하지 않는다");
  assert.equal(result.metrics.candidateCount, 1);
  assert.equal(result.metrics.heldCandidateCount, 25, "정보가 부족한 항목은 삭제하지 않고 보류로 분리한다");
  assert.equal(result.metrics.matchedItemCount, 26);
  assert.equal(result.heldCandidates.length, 1);
  assert.equal(result.truncated, false);
  assert.equal(result.heldTruncated, true);
  assert.deepEqual(searchPillCandidates(pillObservation(), catalog([...records].reverse()), { limit: 1 }), result);
});

test("등급을 유지하면서 일치한 면 수·각인 완전 일치 근거 순으로 안정적으로 정렬한다", () => {
  const records = [
    pillRecord({ ITEM_SEQ: "209900001", PRINT_FRONT: "", PRINT_BACK: "", LINE_FRONT: "", LINE_BACK: "" }),
    pillRecord({ ITEM_SEQ: "209900555", PRINT_BACK: "", LINE_FRONT: "", LINE_BACK: "" }),
    pillRecord({ ITEM_SEQ: "209900777", PRINT_FRONT: "TEST-X", PRINT_BACK: "10-X", LINE_FRONT: "", LINE_BACK: "" }),
    pillRecord({ ITEM_SEQ: "209900999", LINE_FRONT: "", LINE_BACK: "" }),
    pillRecord({ ITEM_SEQ: "209900888" }),
    pillRecord({ ITEM_SEQ: "209900666", PRINT_FRONT: "TEST-X" }),
  ];
  const result = searchPillCandidates(pillObservation(), catalog(records));
  assert.deepEqual(result.candidates.map((candidate) => candidate.itemSeq), ["209900888", "209900666", "209900999", "209900777", "209900555"]);
  assert.deepEqual(result.candidates.map((candidate) => candidate.matchType), ["exact", "partial", "incomplete", "incomplete", "incomplete"]);
  assert.deepEqual(result.heldCandidates.map((candidate) => candidate.itemSeq), ["209900001"]);
  assert.deepEqual(result.metrics.stages.map((entry) => entry.remaining), [6, 6, 6, 6, 6]);
});

test("알 수 없는 시험 각인에 공식 각인 누락 항목만 남으면 찾았다고 하지 않고 보류한다", () => {
  const input = pillObservation({ front: observedSide("NOT-A-REAL-IMPRINT", "single"), back: observedSide("NO-MATCH", "cross") });
  const result = searchPillCandidates(input, catalog([pillRecord({ PRINT_FRONT: "", PRINT_BACK: "" }), pillRecord({ ITEM_SEQ: "209900002" })]));
  assert.equal(result.status, "needs_review");
  assert.equal(result.reason, "insufficient_official_evidence");
  assert.deepEqual(result.candidates, []);
  assert.equal(result.metrics.candidateCount, 0);
  assert.equal(result.metrics.heldCandidateCount, 1);
  assert.deepEqual(result.heldCandidates[0]!.variants[0]!.reviewReasons, ["no_imprint_evidence"]);
  assert.match(result.message, /찾았다는 뜻이 아니며/);
});

test("양면 글자 없음·설명만 있음·빈 문자열 일치는 문자 각인 근거로 승격하지 않는다", () => {
  const input = pillObservation({ front: observedSide("", "single"), back: observedSide("", "cross") });
  for (const description of ["", "분할선"]) {
    const result = searchPillCandidates(input, catalog([pillRecord({ PRINT_FRONT: description, PRINT_BACK: "" })]));
    assert.equal(result.status, "needs_review");
    assert.equal(result.heldCandidates[0]!.variants[0]!.reviewReasons.includes("no_imprint_evidence"), true);
  }
  const explicitBlank = catalog();
  explicitBlank.items[0]!.front.imprint = "";
  explicitBlank.items[0]!.back.imprint = "";
  const result = searchPillCandidates(input, explicitBlank);
  assert.equal(result.status, "needs_review", "형식상 exact 등급이어도 글자 없는 면 두 개는 식별 근거가 아니다");
  assert.deepEqual(result.candidates, []);
});

test("한 면 문자 근거는 다른 면의 공식 정보 누락 때문에 삭제하지 않되 불충분 등급을 유지한다", () => {
  const result = searchPillCandidates(pillObservation(), catalog([pillRecord({ PRINT_BACK: "" })]));
  assert.equal(result.status, "candidates_found");
  assert.equal(result.candidates[0]!.matchType, "incomplete");
  assert.deepEqual(result.candidates[0]!.variants[0]!.reviewReasons, []);
  assert.deepEqual(result.heldCandidates, []);
});

test("확인되지 않은 공식 제형은 각인이 맞아도 보류하며 저장된 거친 form 값을 맹신하지 않는다", () => {
  for (const label of ["스팬슐", "트로키제", "부착정", "새로운정", null]) {
    const data = catalog([pillRecord({ FORM_CODE_NAME: label })]);
    data.items[0]!.form = "tablet";
    const result = searchPillCandidates(pillObservation(), data);
    assert.equal(result.status, "needs_review");
    assert.deepEqual(result.heldCandidates[0]!.variants[0]!.reviewReasons, ["unknown_official_form"]);
    assert.equal(result.heldCandidates[0]!.variants[0]!.formAssessment.status, "unknown");
  }
  const both = searchPillCandidates(pillObservation(), catalog([pillRecord({ FORM_CODE_NAME: "", PRINT_FRONT: "", PRINT_BACK: "" })]));
  assert.deepEqual(both.heldCandidates[0]!.variants[0]!.reviewReasons, ["unknown_official_form", "no_imprint_evidence"]);
});

test("비지원 공식 제형은 다른 특징이 같아도 후보·보류 양쪽에서 제외한다", () => {
  for (const label of ["구강붕해필름", "흡입제, 미분류", "정량흡입제, 분말제", "질정", "질연질캡슐제", "산제", "경질캡슐제, 공캡슐"]) {
    const data = catalog([pillRecord({ FORM_CODE_NAME: label })]);
    data.items[0]!.form = "tablet";
    const result = searchPillCandidates(pillObservation(), data);
    assert.equal(result.status, "unidentified");
    assert.deepEqual(result.candidates, []);
    assert.deepEqual(result.heldCandidates, []);
    assert.equal(result.metrics.unsupportedCatalogRecords, 1);
    assert.equal(result.metrics.stages[0]!.remaining, 0);
  }
});

test("새로 확인한 제형은 구 스냅샷의 unknown 값을 덮어쓰지 않고 검색 시 분류한다", () => {
  const data = catalog([pillRecord({ FORM_CODE_NAME: "장용정" })]);
  assert.equal(data.items[0]!.form, "unknown");
  const before = JSON.stringify(data);
  const result = searchPillCandidates(pillObservation(), data);
  assert.equal(result.status, "candidates_found");
  assert.equal(result.candidates[0]!.variants[0]!.formAssessment.form, "tablet");
  assert.equal(JSON.stringify(data), before);
  assert.equal(searchPillCandidates(pillObservation({ form: "capsule" }), data).status, "unidentified");
});

test("같은 품목의 강한 외형과 보류 외형을 섞어 승격하지 않고 각각 보존한다", () => {
  const records = [pillRecord(), pillRecord({ PRINT_FRONT: "", PRINT_BACK: "", IMG_REGIST_TS: "20260201" })];
  const result = searchPillCandidates(pillObservation(), catalog(records));
  assert.equal(result.status, "candidates_found");
  assert.equal(result.candidates[0]!.variants.length, 1);
  assert.equal(result.heldCandidates[0]!.variants.length, 1);
  assert.equal(result.candidates[0]!.itemSeq, result.heldCandidates[0]!.itemSeq);
  assert.equal(result.metrics.candidateCount, 1);
  assert.equal(result.metrics.heldCandidateCount, 1);
  assert.equal(result.metrics.matchedItemCount, 1, "같은 품목을 두 번 합산하지 않는다");
  assert.deepEqual(searchPillCandidates(pillObservation(), catalog([...records].reverse())), result);
});

test("보류 전용 결과의 표시 제한과 정책 버전도 반환하고 실패를 보류로 위장하지 않는다", () => {
  const data = catalog([pillRecord({ PRINT_FRONT: "", PRINT_BACK: "" }), pillRecord({ ITEM_SEQ: "209900002", PRINT_FRONT: "", PRINT_BACK: "" })]);
  const result = searchPillCandidates(pillObservation(), data, { limit: 1 });
  assert.equal(result.status, "needs_review");
  assert.equal(result.heldTruncated, true);
  assert.equal(result.truncated, false);
  assert.equal(result.metrics.heldReturnedCount, 1);
  assert.equal(result.searchRulesVersion, "pill-structured-v3-evidence-gate");
  assert.equal(result.formPolicyVersion, "pill-form-policy-v1");
  for (const [input, source, expected] of [
    [{}, data, "invalid_input"], [pillObservation(), undefined, "not_configured"],
    [pillObservation(), { ...data, completeness: "partial" as const }, "unavailable"],
    [pillObservation({ quality: "blurred" }), data, "needs_retake"],
  ] as const) {
    const failure = searchPillCandidates(input, source);
    assert.equal(failure.status, expected);
    assert.deepEqual(failure.heldCandidates, []);
  }
});

test("같은 정보 불충분 등급의 양면 방향도 실제 각인 일치 근거가 더 많은 쪽을 선택한다", () => {
  const input = pillObservation({ front: observedSide("A", "unknown"), back: observedSide("AB", "unknown") });
  const result = searchPillCandidates(input, catalog([pillRecord({ PRINT_FRONT: "AB", PRINT_BACK: "", LINE_FRONT: "", LINE_BACK: "" })]));
  assert.equal(result.candidates[0]!.variants[0]!.orientation, "swapped");
  assert.equal(result.candidates[0]!.matchType, "incomplete");
  assert.equal(result.candidates[0]!.variants[0]!.evidence.find((entry) => entry.field === "back.imprint")!.match, "exact");
});
