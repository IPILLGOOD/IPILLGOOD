import assert from "node:assert/strict";
import test from "node:test";
import { gettingStartedGuide } from "../src/lib/getting-started.ts";

const empty = (consentConfirmed = false) => ({
  recipient: { displayName: "", ageBand: "", consentConfirmed },
  medications: [], documents: [], doseEvents: [], symptomEvents: [], todayCheckIn: null,
});

test("new account is guided to profile without fabricated age or name", () => {
  const input = empty();
  const before = structuredClone(input);
  assert.deepEqual(gettingStartedGuide(input), { consentConfirmed: false, nextHref: "/profile", nextLabel: "프로필과 동의 확인하기" });
  assert.deepEqual(input, before);
});

test("saved consent changes only the suggested next link, not authentication", () => {
  assert.deepEqual(gettingStartedGuide(empty(true)), { consentConfirmed: true, nextHref: "/documents", nextLabel: "첫 문서 등록하기" });
});

test("existing care records and demo retain the normal today screen", () => {
  for (const key of ["medications", "documents", "doseEvents", "symptomEvents"]) {
    assert.equal(gettingStartedGuide({ ...empty(true), [key]: [{ id: "existing" }] }), null);
  }
  assert.equal(gettingStartedGuide({ ...empty(), todayCheckIn: { id: "today" } }), null);
  assert.equal(gettingStartedGuide(empty(), true), null);
});
