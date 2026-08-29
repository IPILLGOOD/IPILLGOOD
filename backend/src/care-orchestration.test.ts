import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFirestore } from "../test-support/memory-firestore.ts";
import { getOrCreateQuestionSet } from "./care-orchestration-service.ts";

import { careInputRevision, runCareAgent } from "./ai/care-agent.ts";
import {
  buildPatientQuestionSet,
  questionSetIdFor,
} from "./ai/questions/generate-question-set.ts";
import { buildPatientQuestionResponse } from "./ai/questions/apply-question-response.ts";
import type { CareAgentOutput, CareSnapshot } from "./types.ts";

const snapshot: CareSnapshot = {
  recipient: {
    id: "recipient-1",
    displayName: "테스트 대상자",
    ageBand: "70대",
    allergies: [],
    conditions: [],
    mobilityNote: "",
    accessibilityPreferences: [],
    caregiverNote: "",
    consentConfirmed: true,
    lastConfirmedAt: "2026-08-15T00:00:00+09:00",
  },
  medications: [
    {
      id: "med-1",
      productName: "테스트정",
      ingredientName: "테스트성분",
      purposePlain: "",
      descriptionPlain: "",
      doseAmount: "1정",
      frequency: "하루 1회",
      timing: "아침",
      startDate: "2026-08-12",
      status: "active",
      isNew: true,
      sourceLabel: "테스트",
      watchFor: [],
    },
  ],
  doseEvents: [
    {
      id: "dose-1",
      medicationPlanId: "med-1",
      scheduledAt: "2026-08-15T08:00:00+09:00",
      response: "unconfirmed",
      answeredBy: "caregiver",
    },
  ],
  symptomEvents: [
    {
      id: "symptom-1",
      symptomType: "어지러움",
      occurredAt: "2026-08-15T10:00:00+09:00",
      severity: 3,
      dailyLifeImpact: "잠시 쉬었어요.",
      reporterType: "caregiver_observed",
    },
  ],
  documents: [],
  clinicianQuestions: [],
  dataSource: "local-fallback",
  revision: 0,
};

const analysis: CareAgentOutput = {
  schema_version: "care-agent.v1",
  analysis_id: "analysis-1",
  generated_at: "2026-08-16T08:00:00+09:00",
  timezone: "Asia/Seoul",
  status: "completed",
  findings: [
    {
      finding_id: "finding-1",
      type: "symptom_repeated",
      summary: "최근 어지러움 기록이 있어요.",
      symptom_type: "어지러움",
      medication_plan_id: "",
      event_refs: ["symptom-1"],
    },
    {
      finding_id: "finding-2",
      type: "medication_unconfirmed",
      summary: "복용 확인이 필요해요.",
      symptom_type: "",
      medication_plan_id: "med-1",
      event_refs: ["dose-1"],
    },
  ],
  missing_data: [],
  urgency: "unknown",
  source_refs: [
    { source_type: "symptom_event", source_id: "symptom-1" },
    { source_type: "dose_event", source_id: "dose-1" },
  ],
};

test("같은 날짜와 입력 리비전은 같은 질문 세트 ID를 만든다", () => {
  const revision = careInputRevision(snapshot, "2026-08-16");
  const input = {
    recipientId: snapshot.recipient.id,
    targetDate: "2026-08-16",
    answerer: "caregiver" as const,
    inputRevision: revision,
  };
  assert.equal(questionSetIdFor(input), questionSetIdFor(input));
});

test("Care Agent finding을 승인된 질문 템플릿 최대 3개로 변환한다", () => {
  const questionSet = buildPatientQuestionSet({
    snapshot,
    analysis,
    targetDate: "2026-08-16",
    answerer: "caregiver",
    inputRevision: careInputRevision(snapshot, "2026-08-16"),
    source: "agent",
  });

  assert.equal(questionSet.schema_version, "patient-question-set.v1");
  assert.ok(questionSet.questions.length <= 3);
  assert.ok(questionSet.questions.some((question) => question.display.caregiver_text.includes("어지러움")));
  assert.ok(questionSet.questions.every((question) => question.safety.validation_status === "pass"));
  assert.equal(questionSet.response_status, "unanswered");
});

test("질문 응답은 질문 정의와 분리된 response 문서로 만든다", () => {
  const questionSet = buildPatientQuestionSet({
    snapshot,
    analysis,
    targetDate: "2026-08-16",
    answerer: "caregiver",
    inputRevision: careInputRevision(snapshot, "2026-08-16"),
    source: "agent",
  });
  const answers = Object.fromEntries(
    questionSet.questions.map((question) => [question.question_id, question.options[0]?.value]),
  );
  const response = buildPatientQuestionResponse({
    questionSet,
    answeredBy: "caregiver",
    answers,
  });

  assert.equal(response.question_set_id, questionSet.question_set_id);
  assert.equal(response.responses.length, questionSet.questions.length);
  assert.ok(response.responses.every((item) => item.skipped === false));
});

test("허용되지 않은 맞춤 질문 답변은 거부한다", () => {
  const questionSet = buildPatientQuestionSet({
    snapshot,
    analysis,
    targetDate: "2026-08-16",
    answerer: "caregiver",
    inputRevision: careInputRevision(snapshot, "2026-08-16"),
    source: "agent",
  });
  assert.throws(
    () =>
      buildPatientQuestionResponse({
        questionSet,
        answeredBy: "caregiver",
        answers: Object.fromEntries(
          questionSet.questions.map((question) => [question.question_id, "tampered-value"]),
        ),
      }),
    /답변 값/,
  );
});

test("OpenAI 미설정 시에도 기록에서 안전 폴백 분석을 만든다", async () => {
  const result = await runCareAgent({
    snapshot,
    targetDate: "2026-08-16",
    apiKey: "",
  });
  assert.equal(result.source, "safe_fallback");
  assert.equal(result.run.status, "not_configured");
  assert.ok(result.output.findings.some((finding) => finding.event_refs.includes("symptom-1")));
});

async function generationFixture() {
  const firestore = new MemoryFirestore();
  const stored = { ...structuredClone(snapshot), dataSource: "firestore" as const };
  const scope = { recipientId: stored.recipient.id, firestore };
  await firestore.collection("careRecipients").doc(scope.recipientId).set(stored.recipient);
  return { firestore, input: { scope, snapshot: stored, targetDate: "2026-08-16", answerer: "caregiver" as const } };
}

test("동의가 없으면 Care Agent를 호출하거나 질문·분석 기록을 만들지 않는다", async () => {
  const { firestore, input } = await generationFixture();
  await firestore.collection("careRecipients").doc(input.scope.recipientId).set({ consentConfirmed: false }, { merge: true });
  let calls = 0;

  await assert.rejects(
    getOrCreateQuestionSet(input, {
      runAgent: async (request) => {
        calls += 1;
        return runCareAgent({ ...request, apiKey: "" });
      },
    }),
    /동의/,
  );

  assert.equal(calls, 0);
  for (const collection of ["questionGenerations", "questionGenerationAttempts", "questionSets", "careAnalyses", "agentRuns"]) {
    assert.equal((await firestore.collection(`careRecipients/${input.scope.recipientId}/${collection}`).get()).docs.length, 0);
  }
});

test("Care Agent 실행 중 동의가 철회되면 결과와 실패 기록을 게시하지 않는다", async () => {
  const { firestore, input } = await generationFixture();
  let calls = 0;

  await assert.rejects(getOrCreateQuestionSet(input, {
    runAgent: async (request) => {
      calls += 1;
      await firestore.collection("careRecipients").doc(input.scope.recipientId).set({ consentConfirmed: false }, { merge: true });
      return runCareAgent({ ...request, apiKey: "" });
    },
  }), /동의/);

  assert.equal(calls, 1);
  for (const collection of ["questionGenerations", "questionGenerationAttempts", "questionSets", "careAnalyses", "agentRuns"]) {
    assert.equal((await firestore.collection(`careRecipients/${input.scope.recipientId}/${collection}`).get()).docs.length, 0);
  }
});

test("같은 입력의 동시 최초 요청은 Agent와 성공 결과를 한 번만 생성한다", async () => {
  const { firestore, input } = await generationFixture();
  let calls = 0;
  const runAgent: typeof runCareAgent = async (request) => { calls++; return runCareAgent({ ...request, apiKey: "" }); };
  const results = await Promise.all(Array.from({ length: 5 }, () => getOrCreateQuestionSet(input, { runAgent })));
  assert.equal(calls, 1);
  assert.equal(new Set(results.map((item) => item.question_set_id)).size, 1);
  for (const collection of ["questionSets", "careAnalyses", "agentRuns"]) {
    assert.equal((await firestore.collection(`careRecipients/${input.scope.recipientId}/${collection}`).get()).docs.length, 1);
  }
});

test("외부 호출 성공 후 게시 저장 실패는 checkpoint 결과를 재사용한다", async () => {
  const { firestore, input } = await generationFixture();
  let calls = 0;
  const runAgent: typeof runCareAgent = async (request) => { calls++; return runCareAgent({ ...request, apiKey: "" }); };
  firestore.beforeCommit = (writes) => {
    if (writes.some((write) => write.path.includes("/questionSets/"))) {
      firestore.beforeCommit = undefined;
      throw new Error("INJECTED_PUBLICATION_FAILURE");
    }
  };
  await assert.rejects(getOrCreateQuestionSet(input, { runAgent }), /INJECTED_PUBLICATION_FAILURE/);
  const result = await getOrCreateQuestionSet(input, { runAgent });
  assert.equal(calls, 1);
  assert.ok(result.question_set_id);
  const attempts = await firestore.collection(`careRecipients/${input.scope.recipientId}/questionGenerationAttempts`).get();
  assert.deepEqual(attempts.docs.map((doc) => (doc.data() as { status: string }).status).sort(), ["completed", "failed"]);
});

test("만료된 생성 lease를 회수하고 중단 attempt를 추적한다", async () => {
  const { firestore, input } = await generationFixture();
  const id = questionSetIdFor({ recipientId: input.scope.recipientId, targetDate: input.targetDate, answerer: input.answerer, inputRevision: careInputRevision(input.snapshot, input.targetDate) });
  await firestore.collection(`careRecipients/${input.scope.recipientId}/questionGenerations`).doc(id).set({
    status: "running", owner: "stopped-worker", attempts: 1, leaseUntil: "2020-01-01T00:00:00Z", sourceDocumentIds: [],
  });
  let calls = 0;
  await getOrCreateQuestionSet(input, { runAgent: async (request) => { calls++; return runCareAgent({ ...request, apiKey: "" }); } });
  const attempts = await firestore.collection(`careRecipients/${input.scope.recipientId}/questionGenerationAttempts`).get();
  assert.equal(calls, 1);
  assert.deepEqual(attempts.docs.map((doc) => (doc.data() as { status: string }).status).sort(), ["completed", "interrupted"]);
});


test("게시 실패는 unavailable을 반환하고 같은 checkpoint로 복구한다", async () => {
  const { getQuestionSetAvailability } = await import("./care-orchestration-service.ts");
  const { firestore, input } = await generationFixture();
  let calls = 0;
  const runAgent: typeof runCareAgent = async (request) => { calls++; return runCareAgent({ ...request, apiKey: "" }); };
  firestore.beforeCommit = (writes) => {
    if (writes.some((write) => write.path.includes("/questionSets/"))) {
      firestore.beforeCommit = undefined;
      throw new Error("PRIVATE_STORAGE_DETAIL");
    }
  };
  const unavailable = await getQuestionSetAvailability(input, { runAgent });
  assert.equal(unavailable.status, "unavailable");
  assert.equal("questionSet" in unavailable, false);
  assert.equal(JSON.stringify(unavailable).includes("PRIVATE_STORAGE_DETAIL"), false);
  assert.equal((await firestore.collection(`careRecipients/${input.scope.recipientId}/questionSets`).get()).docs.length, 0);
  const ready = await getQuestionSetAvailability(input, { runAgent });
  assert.equal(ready.status, "ready");
  assert.equal(calls, 1);
  if (ready.status === "ready") assert.equal((await firestore.collection(`careRecipients/${input.scope.recipientId}/questionSets`).doc(ready.questionSet.question_set_id).get()).exists, true);
});
