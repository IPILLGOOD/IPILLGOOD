import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRecipientProfile,
  collectCompleteDoseResponses,
  profileSchema,
} from "../src/lib/form-validation.ts";

const validProfileForm = {
  displayName: "김영희 어르신",
  ageBand: "75–79세",
  heightCm: "",
  weightKg: "",
  allergies: "",
  conditions: "혈압 관리 중",
  mobilityNote: "",
  caregiverNote: "",
  consentConfirmed: "on",
};

test("프로필 필수값의 공백 입력과 동의 누락을 거부한다", () => {
  assert.equal(
    profileSchema.safeParse({ ...validProfileForm, displayName: "  " }).success,
    false,
  );
  const withoutConsent = { ...validProfileForm };
  delete withoutConsent.consentConfirmed;
  assert.equal(profileSchema.safeParse(withoutConsent).success, false);
});

test("비어 있는 선택 측정값을 Firestore 문서에서 제거한다", () => {
  const parsed = profileSchema.parse(validProfileForm);
  const recipient = buildRecipientProfile(
    {
      id: "demo",
      displayName: "이전 이름",
      ageBand: "70–74세",
      heightCm: 165,
      weightKg: 58,
      allergies: [],
      conditions: [],
      mobilityNote: "",
      accessibilityPreferences: [],
      caregiverNote: "",
      consentConfirmed: true,
      lastConfirmedAt: "2026-01-01T00:00:00.000Z",
    },
    parsed,
  );

  assert.equal("heightCm" in recipient, false);
  assert.equal("weightKg" in recipient, false);
});

test("모든 복약 일정에 유효한 답변이 있을 때만 완전한 응답으로 만든다", () => {
  const schedule = new Map([
    [
      "morning",
      { id: "morning", medicationPlanId: "med-a", scheduledAt: "2026-08-16T08:00:00+09:00" },
    ],
    [
      "evening",
      { id: "evening", medicationPlanId: "med-b", scheduledAt: "2026-08-16T20:00:00+09:00" },
    ],
  ]);
  const formData = new FormData();
  formData.set("dose_morning", "completed");
  formData.set("dose_evening", "unconfirmed");

  const result = collectCompleteDoseResponses(formData, schedule);
  assert.equal(result.responses.length, 2);
  assert.deepEqual(result.missingTaskIds, []);
});

test("일부 복약 일정이 없거나 값이 유효하지 않으면 누락으로 처리한다", () => {
  const schedule = new Map([
    [
      "morning",
      { id: "morning", medicationPlanId: "med-a", scheduledAt: "2026-08-16T08:00:00+09:00" },
    ],
    [
      "evening",
      { id: "evening", medicationPlanId: "med-b", scheduledAt: "2026-08-16T20:00:00+09:00" },
    ],
  ]);
  const formData = new FormData();
  formData.append("dose_morning", "completed");
  formData.append("dose_morning", "completed");
  formData.set("dose_evening", "invalid");

  const result = collectCompleteDoseResponses(formData, schedule);
  assert.equal(result.responses.length, 1);
  assert.deepEqual(result.missingTaskIds, ["evening"]);
});
