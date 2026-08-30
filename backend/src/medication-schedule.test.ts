import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceMedicationReminderSchedule,
  buildMedicationReminderSchedules,
  createMedicationSchedule,
  medicationFrequencyRule,
} from "./medication-schedule.ts";
import type { MedicationPlan } from "./types.ts";

const medications: MedicationPlan[] = [
  {
    id: "med-twice",
    productName: "테스트정",
    ingredientName: "테스트 성분",
    categoryPlain: "테스트",
    purposePlain: "테스트",
    descriptionPlain: "테스트",
    doseAmount: "한 번에 1정",
    frequency: "하루 2회",
    timing: "아침·저녁 식사 후",
    startDate: "2026-08-20",
    status: "active",
    isNew: false,
    sourceLabel: "테스트",
    watchFor: [],
  },
  {
    id: "med-interval",
    productName: "격일정",
    ingredientName: "격일 성분",
    categoryPlain: "테스트",
    purposePlain: "테스트",
    descriptionPlain: "테스트",
    doseAmount: "한 번에 1정",
    frequency: "2일 1회",
    timing: "아침 식사 후",
    startDate: "2026-08-20",
    status: "active",
    isNew: false,
    sourceLabel: "테스트",
    watchFor: [],
  },
];

test("화면 복약 일정과 알림 일정이 같은 슬롯 시각을 사용한다", () => {
  const now = new Date("2026-08-24T00:00:00.000Z");
  const tasks = createMedicationSchedule(medications, [], now);
  const reminders = buildMedicationReminderSchedules("recipient-1", medications, now);

  assert.deepEqual(
    tasks.map((task) => `${task.medicationPlanId}:${task.timeLabel}`),
    ["med-twice:08:00", "med-interval:08:00", "med-twice:19:00"],
  );
  assert.deepEqual(
    reminders.map((reminder) => `${reminder.medicationPlanId}:${reminder.timeLabel}`),
    ["med-twice:08:00", "med-twice:19:00", "med-interval:08:00"],
  );
  assert.equal("endDate" in reminders[0]!, false);
});

test("지나간 복약 시각은 다음 유효 복약일로 예약한다", () => {
  const now = new Date("2026-08-24T00:01:00.000Z"); // 서울 09:01
  const reminders = buildMedicationReminderSchedules("recipient-1", medications, now);
  const twiceMorning = reminders.find(
    (reminder) => reminder.medicationPlanId === "med-twice" && reminder.timeLabel === "08:00",
  );
  const intervalMorning = reminders.find(
    (reminder) => reminder.medicationPlanId === "med-interval",
  );

  assert.equal(twiceMorning?.nextDueAt, "2026-08-24T23:00:00.000Z");
  assert.equal(intervalMorning?.nextDueAt, "2026-08-25T23:00:00.000Z");
});

test("발송된 일정은 다음 복약 시각으로 한 번만 전진한다", () => {
  const [morning] = buildMedicationReminderSchedules(
    "recipient-1",
    [medications[0]!],
    new Date("2026-08-23T22:00:00.000Z"),
  );
  assert.equal(morning?.nextDueAt, "2026-08-23T23:00:00.000Z");

  const advanced = advanceMedicationReminderSchedule(
    morning!,
    new Date("2026-08-23T23:00:30.000Z"),
  );
  assert.equal(advanced.nextDueAt, "2026-08-24T23:00:00.000Z");
  assert.equal(advanced.status, "active");
});


test("UTC와 KST로 표현한 같은 복약 회차는 동일한 응답으로 연결한다", () => {
  for (const scheduledAt of ["2026-08-23T23:00:00.000Z", "2026-08-24T08:00:00+09:00"]) {
    const tasks = createMedicationSchedule([medications[0]!], [{ id: "dose-utc", medicationPlanId: "med-twice", scheduledAt, response: "completed", answeredBy: "caregiver" }], new Date("2026-08-24T00:00:00Z"));
    assert.equal(tasks.find((task) => task.timeLabel === "08:00")?.response, "completed");
    assert.equal(tasks.find((task) => task.timeLabel === "08:00")?.hasRecordedResponse, true);
    assert.equal(tasks.find((task) => task.timeLabel === "19:00")?.response, "not_yet");
    assert.equal(tasks.find((task) => task.timeLabel === "19:00")?.hasRecordedResponse, false);
  }
});

test("명시적 아직 복용 전 응답과 시스템 기본 상태를 구분한다", () => {
  const withoutResponse = createMedicationSchedule([medications[0]!], [], new Date("2026-08-24T00:00:00Z"));
  assert.equal(withoutResponse[0]?.response, "not_yet");
  assert.equal(withoutResponse[0]?.hasRecordedResponse, false);

  const recorded = createMedicationSchedule([medications[0]!], [{
    id: "dose-not-yet",
    medicationPlanId: "med-twice",
    scheduledAt: "2026-08-24T08:00:00+09:00",
    response: "not_yet",
    answeredBy: "recipient",
    answeredAt: "2026-08-24T00:30:00.000Z",
  }], new Date("2026-08-24T00:00:00Z"));
  assert.equal(recorded[0]?.response, "not_yet");
  assert.equal(recorded[0]?.hasRecordedResponse, true);
});

test("필요시·주간·알 수 없는 주기를 매일 일정으로 추정하지 않는다", () => {
  for (const frequency of ["필요시", "하루 1회 필요시", "통증이 있을 때", "주 1회", "매주 월요일", "격주", "복용 횟수 확인 필요"]) {
    const medication = { ...medications[0]!, id: `unsupported-${frequency}`, frequency };
    assert.equal(medicationFrequencyRule(frequency), null);
    assert.deepEqual(createMedicationSchedule([medication], [], new Date("2026-08-24T00:00:00Z")), []);
    assert.deepEqual(buildMedicationReminderSchedules("recipient-1", [medication], new Date("2026-08-24T00:00:00Z")), []);
  }
});

test("인식할 수 없는 복용 시각을 09시로 만들지 않는다", () => {
  const medication = { ...medications[0]!, id: "unknown-time", frequency: "하루 1회", timing: "복용 시간 확인 필요" };
  assert.deepEqual(createMedicationSchedule([medication], [], new Date("2026-08-24T00:00:00Z")), []);
  assert.deepEqual(buildMedicationReminderSchedules("recipient-1", [medication], new Date("2026-08-24T00:00:00Z")), []);
});

test("명시된 24시간제 복용 시각은 그대로 사용한다", () => {
  const medication = { ...medications[0]!, id: "clock-time", frequency: "매일", timing: "08:30" };
  assert.equal(createMedicationSchedule([medication], [], new Date("2026-08-24T00:00:00Z"))[0]?.timeLabel, "08:30");
  assert.equal(buildMedicationReminderSchedules("recipient-1", [medication], new Date("2026-08-24T00:00:00Z"))[0]?.timeLabel, "08:30");
});
