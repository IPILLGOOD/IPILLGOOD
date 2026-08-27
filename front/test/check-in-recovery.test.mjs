import assert from "node:assert/strict";
import test from "node:test";
import { changeDraft, questionRecoveryDraft } from "../src/lib/check-in-recovery.ts";

test("recovering identical questions preserves every entered value", () => {
  const draft = { answeredBy: ["recipient"], symptoms: ["두통", "어지러움"], severity: ["7"], note: ["작성한 메모"], dose_abc: ["partial"], question_abc: ["unknown"] };
  assert.deepEqual(questionRecoveryDraft(draft, true), draft);
  const { question_abc, ...unchanged } = draft;
  assert.deepEqual(questionRecoveryDraft(draft, false), unchanged);
  assert.deepEqual(question_abc, ["unknown"]);
});

test("draft handles multiple symptoms without retaining server identifiers", () => {
  let draft = changeDraft({}, "symptoms", "두통", true);
  draft = changeDraft(draft, "symptoms", "어지러움", true);
  draft = changeDraft(draft, "symptoms", "두통", false);
  assert.deepEqual(draft.symptoms, ["어지러움"]);
  assert.deepEqual(changeDraft(draft, "questionSetId", "forged"), draft);
});
