import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRecipientProfile,
  collectCompleteDoseResponses,
  profileSchema,
} from "../src/lib/form-validation.ts";

const validProfileForm = {
  displayName: "김데모",
  ageBand: "77",
  heightCm: "",
  weightKg: "",
  allergies: "",
  conditions: "혈압 관리 중",
  confirmedConditions: "[]",
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

test("나이는 1세부터 120세 사이의 정수만 허용한다", () => {
  assert.equal(profileSchema.safeParse({ ...validProfileForm, ageBand: "75" }).success, true);
  assert.equal(profileSchema.safeParse({ ...validProfileForm, ageBand: "75–79세" }).success, false);
  assert.equal(profileSchema.safeParse({ ...validProfileForm, ageBand: "75.5" }).success, false);
  assert.equal(profileSchema.safeParse({ ...validProfileForm, ageBand: "0" }).success, false);
  assert.equal(profileSchema.safeParse({ ...validProfileForm, ageBand: "121" }).success, false);
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

const savedCondition = {
  id: "condition-document-diabetes", standardName: "제2형 당뇨병", code: "E11",
  sourceDocumentId: "diagnosis-1", sourceLabel: "진단서 확인", confirmedAt: "2026-01-01T00:00:00.000Z",
};
const currentWithConditions = { confirmedConditions: [savedCondition] };
const submittedCondition = { id: savedCondition.id, standardName: savedCondition.standardName, code: savedCondition.code, confirmed: true };
const parseConditions = (items) => profileSchema.parse({ ...validProfileForm, confirmedConditions: JSON.stringify(items) });

test("고정 목록 밖의 질환을 추가하며 미확인 입력과 중복 질환을 거부한다", () => {
  const added = buildRecipientProfile(currentWithConditions, parseConditions([
    submittedCondition, { standardName: "천식", code: "", confirmed: true },
  ]));
  assert.deepEqual(added.confirmedConditions[0], savedCondition);
  assert.equal(added.confirmedConditions[1].standardName, "천식");
  assert.equal(added.confirmedConditions[1].code, "코드 미기재");
  assert.equal(added.confirmedConditions[1].sourceDocumentId, undefined);
  assert.match(added.confirmedConditions[1].id, /^condition-/);
  for (const items of [
    [{ standardName: "천식", code: "", confirmed: false }],
    [{ standardName: " ", code: "", confirmed: true }],
    [submittedCondition, { standardName: "제2형당뇨병", code: "", confirmed: true }],
    [submittedCondition, { ...submittedCondition, standardName: "다른 이름" }],
    [{ standardName: "a".repeat(121), code: "", confirmed: true }],
  ]) assert.equal(profileSchema.safeParse({ ...validProfileForm, confirmedConditions: JSON.stringify(items) }).success, false);
});

test("수정하지 않은 문서 질환의 출처와 ID를 보존하고 수정 시 새 확인 정보로 분리한다", () => {
  const unchanged = buildRecipientProfile(currentWithConditions, parseConditions([submittedCondition]));
  assert.deepEqual(unchanged.confirmedConditions, [savedCondition]);
  const edited = buildRecipientProfile(currentWithConditions, parseConditions([{ ...submittedCondition, standardName: "의료진이 정정한 질환명", code: "" }]));
  assert.notEqual(edited.confirmedConditions[0].id, savedCondition.id);
  assert.equal(edited.confirmedConditions[0].sourceDocumentId, undefined);
  assert.equal(edited.confirmedConditions[0].standardName, "의료진이 정정한 질환명");
  assert.notEqual(edited.confirmedConditions[0].confirmedAt, savedCondition.confirmedAt);
});

test("명시적으로 뺀 질환은 삭제하고 질환 목록 누락이나 잘못된 JSON은 저장하지 않는다", () => {
  assert.deepEqual(buildRecipientProfile(currentWithConditions, parseConditions([])).confirmedConditions, []);
  for (const value of [undefined, null, "{", "null", "{}"])
    assert.equal(profileSchema.safeParse({ ...validProfileForm, confirmedConditions: value }).success, false);
});

test("외부 질환 ID를 거부하고 클라이언트가 문서 출처를 위조할 수 없다", () => {
  assert.throws(() => buildRecipientProfile(currentWithConditions, parseConditions([{ ...submittedCondition, id: "another-person-condition" }])));
  const profile = buildRecipientProfile(currentWithConditions, parseConditions([{
    standardName: "천식", code: "J45", confirmed: true,
    sourceDocumentId: "forged", sourceLabel: "forged", confirmedAt: "forged",
  }]));
  assert.equal(profile.confirmedConditions[0].sourceDocumentId, undefined);
  assert.notEqual(profile.confirmedConditions[0].sourceLabel, "forged");
});

test("저장 후 서버가 발급한 ID로 재저장하면 동일한 질환이 유지된다", () => {
  const first = buildRecipientProfile(currentWithConditions, parseConditions([{ standardName: "천식", code: "", confirmed: true }]));
  const saved = first.confirmedConditions[0];
  const second = buildRecipientProfile(first, parseConditions([{ id: saved.id, standardName: saved.standardName, code: "", confirmed: true }]));
  assert.deepEqual(second.confirmedConditions, first.confirmedConditions);
});
