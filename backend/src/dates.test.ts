import assert from "node:assert/strict";
import test from "node:test";
import { addCalendarDays, calendarDayDifference, dateKeyInSeoul, dateKeyInTimeZone, formatInSeoul, seoulDateRange, seoulTimeLabel } from "./dates.ts";

test("Seoul midnight and calendar input are independent of the host time zone", () => {
  const original = process.env.TZ;
  try {
    for (const zone of ["UTC", "America/Los_Angeles", "Pacific/Honolulu", "Asia/Seoul"]) {
      process.env.TZ = zone;
      assert.equal(dateKeyInSeoul("2026-08-23T14:59:59.999Z"), "2026-08-23");
      assert.equal(dateKeyInSeoul("2026-08-23T15:00:00.000Z"), "2026-08-24");
      assert.equal(dateKeyInSeoul("2026-08-24"), "2026-08-24");
      assert.equal(formatInSeoul("2026-08-23T18:26:00Z", { month: "numeric", day: "numeric" }), "8. 24.");
      assert.equal(formatInSeoul("2026-08-24", { month: "numeric", day: "numeric" }), "8. 24.");
      assert.equal(seoulTimeLabel("2026-08-23T15:00:00Z"), "00:00");
      assert.equal(dateKeyInTimeZone(new Date("2026-08-23T15:00:00Z"), "UTC"), "2026-08-23");
    }
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

test("month, year and leap boundaries use calendar arithmetic", () => {
  assert.equal(addCalendarDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addCalendarDays("2024-02-29", 1), "2024-03-01");
  assert.equal(addCalendarDays("2025-12-31", 1), "2026-01-01");
  assert.equal(calendarDayDifference("2024-02-28", "2024-03-01"), 2);
  assert.equal(calendarDayDifference("2026-01-02", "2026-01-01"), -1);
  assert.deepEqual(seoulDateRange("2026-01-01", 7), { startDate: "2025-12-26", endDate: "2026-01-01", startInclusive: "2025-12-25T15:00:00.000Z", endExclusive: "2026-01-01T15:00:00.000Z" });
});

test("ambiguous or invalid inputs cannot silently become another date", () => {
  for (const input of ["2026-02-30", "2026-08-28T03:00:00", "", "invalid"]) assert.throws(() => dateKeyInSeoul(input), RangeError);
  assert.throws(() => seoulDateRange("2026-08-28", 0), RangeError);
  assert.throws(() => addCalendarDays("2026-08-28", 0.5), RangeError);
});
