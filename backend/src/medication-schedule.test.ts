import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceMedicationReminderSchedule,
  buildMedicationReminderSchedules,
  createMedicationSchedule,
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
