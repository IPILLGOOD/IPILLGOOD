import assert from "node:assert/strict";
import test from "node:test";
import { adherenceSummary, careTimelineItems, recentCareRecords, uniqueSymptomDays } from "../src/lib/recent-care-records.ts";

const now = new Date("2026-08-28T03:00:00Z");
const dose = (id, scheduledAt, response = "completed") => ({ id, scheduledAt, response });
const symptom = (id, occurredAt, symptomType = "두통") => ({ id, occurredAt, symptomType, severity: 2, dailyLifeImpact: "기록" });
const records = (overrides = {}) => ({ medications: [], doseEvents: [], symptomEvents: [], ...overrides });

test("seven Seoul dates include both midnight boundaries, not eight days ago or tomorrow", () => {
  const input = records({ doseEvents: [
    dose("old", "2026-08-21T14:59:59.999Z"),
    dose("first", "2026-08-21T15:00:00Z"),
    dose("last", "2026-08-28T14:59:59.999Z"),
    dose("future", "2026-08-28T15:00:00Z"),
    dose("invalid", "not-a-date"),
  ] });
  const before = structuredClone(input);
  const recent = recentCareRecords(input, now);
  assert.equal(recent.range.startDate, "2026-08-22");
  assert.deepEqual(recent.doseEvents.map((event) => event.id), ["first", "last"]);
  assert.deepEqual(input, before);
});

test("period is determined by scheduled time, not delayed answer time", () => {
  const recent = recentCareRecords(records({ doseEvents: [
    { ...dose("old", "2026-08-10T08:00:00+09:00"), answeredAt: now.toISOString() },
    dose("recent", "2026-08-27T08:00:00+09:00", "skipped"),
  ] }), now);
  assert.deepEqual(adherenceSummary(recent.doseEvents), { confirmed: 0, total: 1, rate: 0 });
});

test("no response is not a zero percent response rate", () => {
  assert.deepEqual(adherenceSummary([]), { confirmed: 0, total: 0, rate: null });
  assert.equal(adherenceSummary([dose("planned", "", "not_yet")]).rate, null);
  assert.deepEqual(adherenceSummary([dose("a", ""), dose("b", "", "partial")]), { confirmed: 1, total: 2, rate: 50 });
});

test("symptom days use Seoul dates and retain actual symptom types", () => {
  const recent = recentCareRecords(records({ symptomEvents: [
    symptom("old", "2026-08-01T08:00:00+09:00", "어지러움"),
    symptom("a", "2026-08-26T15:01:00Z"),
    symptom("b", "2026-08-27T10:00:00+09:00", "기침"),
    symptom("c", "2026-08-27T15:00:00Z"),
  ] }), now);
  assert.equal(uniqueSymptomDays(recent.symptomEvents), 2);
  assert.equal(recent.symptomEvents.filter((event) => event.symptomType === "어지러움").length, 0);
  assert.match(careTimelineItems([], recent.symptomEvents)[0].title, /두통/);
});

test("year and leap-month boundaries use calendar arithmetic", () => {
  assert.equal(recentCareRecords(records(), new Date("2025-12-31T15:00:00Z")).range.startDate, "2025-12-26");
  assert.equal(recentCareRecords(records(), new Date("2024-03-01T00:00:00Z")).range.startDate, "2024-02-24");
});

test("timeline filters medication dates without removing old current medication from its source", () => {
  const input = records({ medications: [
    { id: "old-active", startDate: "2026-01-01", status: "active", isNew: true },
    { id: "recent-ended", startDate: "2026-08-25", status: "ended", isNew: true },
    { id: "future", startDate: "2026-08-29", status: "active", isNew: true },
  ] });
  assert.deepEqual(recentCareRecords(input, now).medications.map((item) => item.id), ["recent-ended"]);
  assert.equal(input.medications.length, 3);
});

test("timeline sorts all records before limiting and compares dates as Seoul instants", () => {
  const symptoms = Array.from({ length: 7 }, (_, i) => symptom(String(i), `2026-08-2${i + 1}T19:00:00+09:00`));
  assert.equal(careTimelineItems([], symptoms)[0].id, "symptom-6");
  assert.equal(careTimelineItems([], symptoms).length, 5);
  const items = careTimelineItems([{ id: "m", isNew: true, startDate: "2026-08-28" }], [symptom("s", "2026-08-27T16:00:00Z")]);
  assert.equal(items[0].id, "symptom-s");
});
