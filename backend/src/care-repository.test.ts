import assert from "node:assert/strict";
import test from "node:test";

import demoSeed from "./data/demo-seed.json" with { type: "json" };
import {
  applyDailyCheckInToSnapshot,
  currentDailyCheckIn,
} from "./care-read-model.ts";
import type { CareSnapshot } from "./types.ts";

const snapshot = {
  ...demoSeed,
  todayCheckIn: null,
  dataSource: "firestore",
} as CareSnapshot;

test("당일 체크인은 read model에서 같은 날짜 기록을 교체하고 과거 기록을 보존한다", () => {
  const update = applyDailyCheckInToSnapshot(
    snapshot,
    {
      doseResponses: [
        {
          medicationPlanId: "med-amlodipine",
          scheduledAt: "2026-08-16T08:00:00+09:00",
          response: "completed",
        },
      ],
      symptoms: ["두통"],
      severity: 3,
      note: "오후에는 괜찮아졌어요.",
      answeredBy: "caregiver",
    },
    new Date("2026-08-16T06:30:00.000Z"),
  );

  assert.equal(update.checkIn.id, "2026-08-16");
  assert.deepEqual(update.replacedSymptomEvents.map((event) => event.id), ["symptom-0816"]);
  assert.equal(update.nextSnapshot.symptomEvents.some((event) => event.id === "symptom-0816"), false);
  assert.equal(update.nextSnapshot.symptomEvents.some((event) => event.id === "symptom-0815"), true);
  assert.equal(update.nextSnapshot.symptomEvents[0]?.symptomType, "두통");
  assert.equal(update.nextSnapshot.todayCheckIn?.note, "오후에는 괜찮아졌어요.");
});

test("같은 복약 체크인을 다시 저장해도 read model에 중복 이벤트가 생기지 않는다", () => {
  const input = {
    doseResponses: [
      {
        medicationPlanId: "med-amlodipine",
        scheduledAt: "2026-08-16T08:00:00+09:00",
        response: "completed" as const,
      },
    ],
    symptoms: [],
    severity: 0,
    note: "",
    answeredBy: "recipient" as const,
  };
  const now = new Date("2026-08-16T07:00:00.000Z");
  const first = applyDailyCheckInToSnapshot(snapshot, input, now);
  const second = applyDailyCheckInToSnapshot(first.nextSnapshot, input, now);
  const id = "2026-08-16-med-amlodipine-0800";

  assert.equal(second.nextSnapshot.doseEvents.filter((event) => event.id === id).length, 1);
});

test("read model의 체크인은 서울 날짜가 오늘과 일치할 때만 반환한다", () => {
  const checkIn = {
    id: "2026-08-16",
    completedAt: "2026-08-16T07:00:00.000Z",
    completedBy: "caregiver" as const,
    medicationResponses: [],
    symptoms: [],
    note: "확인",
  };

  assert.equal(currentDailyCheckIn(checkIn, new Date("2026-08-16T14:59:00.000Z")), checkIn);
  assert.equal(currentDailyCheckIn(checkIn, new Date("2026-08-16T15:01:00.000Z")), null);
});
