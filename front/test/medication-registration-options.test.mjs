import assert from "node:assert/strict";
import test from "node:test";
import {
  parseMedicationRegistrationSelection,
} from "../src/lib/medication-registration-options.ts";
import { createMedicationSchedule } from "../../backend/src/medication-schedule.ts";

test("하루 2회 선택을 캘린더가 해석할 수 있는 고정 문자열로 만든다", () => {
  assert.deepEqual(
    parseMedicationRegistrationSelection({
      doseQuantity: "1",
      doseUnit: "정",
      frequency: "하루 2회",
      timings: ["아침 식사 후 08:30", "저녁 식사 후 19:00"],
    }),
    {
      doseAmount: "1정",
      frequency: "하루 2회",
      timing: "아침 식사 후 08:30·저녁 식사 후 19:00",
    },
  );
});

test("자유 입력, 회차 누락, 중복 시점을 거부한다", () => {
  assert.equal(parseMedicationRegistrationSelection({ doseQuantity: "한 알", doseUnit: "정", frequency: "하루 1회", timings: ["아침 식사 후 08:30"] }), null);
  assert.equal(parseMedicationRegistrationSelection({ doseQuantity: "1", doseUnit: "정", frequency: "하루 2회", timings: ["아침 식사 후 08:30"] }), null);
  assert.equal(parseMedicationRegistrationSelection({ doseQuantity: "1", doseUnit: "정", frequency: "하루 2회", timings: ["아침 식사 후 08:30", "아침 식사 후 08:30"] }), null);
});

test("필요시 복용은 고정 캘린더 회차 없이 저장한다", () => {
  assert.deepEqual(
    parseMedicationRegistrationSelection({ doseQuantity: "1", doseUnit: "포", frequency: "필요할 때", timings: [] }),
    { doseAmount: "1포", frequency: "필요할 때", timing: "증상이 있을 때" },
  );
});

test("선택한 두 시각이 시작일부터 실제 캘린더 회차로 생성된다", () => {
  const selection = parseMedicationRegistrationSelection({
    doseQuantity: "1",
    doseUnit: "정",
    frequency: "하루 2회",
    timings: ["아침 식사 후 08:30", "저녁 식사 후 19:00"],
  });
  assert.ok(selection);
  const tasks = createMedicationSchedule([
    {
      id: "selected-medication",
      productName: "테스트 약",
      ingredientName: "테스트 성분",
      categoryPlain: "테스트",
      purposePlain: "테스트",
      descriptionPlain: "테스트",
      ...selection,
      startDate: "2026-09-09",
      status: "active",
      isNew: true,
      sourceLabel: "테스트",
      watchFor: [],
    },
  ], [], new Date("2026-09-09T03:00:00Z"));
  assert.deepEqual(tasks.map((task) => task.timeLabel), ["08:30", "19:00"]);
});
