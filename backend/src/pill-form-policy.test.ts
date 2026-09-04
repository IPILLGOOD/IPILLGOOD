import assert from "node:assert/strict";
import test from "node:test";
import { classifyPillForm, summarizePillFormPolicy } from "./pill-form-policy.ts";

test("명시한 정제 세부 표기는 제형만 분류하며 투여 방법을 생성하지 않는다", () => {
  for (const label of [
    "정제", "정제, 미분류", "필름코팅정", "장용정", "서방성장용필름코팅정", "장용성당의정",
    "장용성필름코팅당의정", "설하정", "박칼정", "발포정", "분산정(현탁정)", "유핵정",
  ]) assert.deepEqual(classifyPillForm(label), { status: "supported", form: "tablet", reason: "listed_tablet" }, label);
});

test("온전한 캡슐 표기의 산제·액상은 내용물이며 가루약·액상 관찰과 구분한다", () => {
  for (const label of [
    "캡슐", "캡슐, 미분류", "경질캡슐제, 산제", "경질캡슐제, 과립제정제",
    "경질캡슐제, 정제", "경질캡슐제, 서방성장용성펠렛", "경질캡슐제, 장용성과립제",
    "서방성캡슐제, 펠렛", "장용성캡슐제, 정제", "연질캡슐제, 액상", "연질캡슐제, 현탁상",
    "장용성필름코팅캡슐제", "젤라틴코팅성경질캡슐제",
  ]) assert.deepEqual(classifyPillForm(label), { status: "supported", form: "capsule", reason: "listed_capsule" }, label);
  assert.equal(classifyPillForm("산제").status, "unsupported");
  assert.equal(classifyPillForm("액제").status, "unsupported");
});

test("필름·흡입·외용·가루·공캡슐 표기는 정제나 캡슐이라는 부분 문자열로 지원하지 않는다", () => {
  for (const label of [
    "구강붕해필름", "껌제", "산제", "과립제", "액제", "시럽제", "흡입제, 미분류",
    "정량흡입제, 분말제", "정량분말분무제", "지지체가있는첩부제", "질정", "질연질캡슐제", "질좌제, 일반",
  ]) assert.deepEqual(classifyPillForm(label), { status: "unsupported", form: null, reason: "outside_mvp_form" }, label);
  assert.deepEqual(classifyPillForm("경질캡슐제, 공캡슐"), { status: "unsupported", form: null, reason: "empty_capsule" });
});

test("미검토 표기·접미사·복수 표기는 알 수 없음으로 남기고 임의 확대하지 않는다", () => {
  for (const label of ["스팬슐", "트로키제", "부착정", "새로운정", "새로운캡슐", "정제, 흡입용", "캡슐, 새제형", "캡슐, 산제, 새제형", "정제,", "__proto__"]) {
    assert.deepEqual(classifyPillForm(label), { status: "unknown", form: null, reason: "unreviewed_form_label" }, label);
  }
  for (const label of [null, "", "  "]) assert.equal(classifyPillForm(label).reason, "missing_form_label");
  assert.equal(classifyPillForm("  경질캡슐제， 산제  ").form, "capsule");
});

test("정책 집계는 미상과 비지원을 분리하고 입력·프로토타입을 변경하지 않는다", () => {
  const items = ["장용정", "경질캡슐제, 산제", "질정", "경질캡슐제, 공캡슐", "스팬슐", null, "__proto__"].map((formName) => ({ formName }));
  const before = JSON.stringify(items);
  const summary = summarizePillFormPolicy(items);
  assert.deepEqual(summary.counts, { tablet: 1, capsule: 1, unsupported: 2, unknown: 3 });
  assert.equal(summary.unknownForms.__proto__, 1);
  assert.equal(summary.unsupportedForms["질정"], 1);
  assert.equal(summary.version, "pill-form-policy-v1");
  assert.equal(JSON.stringify(items), before);
  assert.deepEqual(summarizePillFormPolicy([...items].reverse()), summary);
});
