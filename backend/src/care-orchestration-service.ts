import { randomUUID } from "node:crypto";

import { careInputRevision, runCareAgent } from "./ai/care-agent";
import {
  buildPatientQuestionSet,
  questionSetIdFor,
} from "./ai/questions/generate-question-set";
import {
  getCareSnapshot,
  getPatientQuestionSet,
  saveQuestionSetGeneration,
} from "./care-repository";
import type { CareSnapshot, PatientQuestionSet } from "./types";

export function dateKeyInSeoul(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export async function getOrCreateQuestionSet(input: {
  recipientId: string;
  targetDate?: string;
  answerer: "caregiver" | "recipient";
  snapshot?: CareSnapshot;
}): Promise<PatientQuestionSet> {
  const targetDate = input.targetDate ?? dateKeyInSeoul();
  const snapshot = input.snapshot ?? (await getCareSnapshot());
  if (snapshot.recipient.id !== input.recipientId) {
    throw new Error("질문 대상자와 현재 돌봄 대상자가 일치하지 않습니다.");
  }
  const inputRevision = careInputRevision(snapshot, targetDate);
  const questionSetId = questionSetIdFor({
    recipientId: input.recipientId,
    targetDate,
    answerer: input.answerer,
    inputRevision,
  });

  try {
    const existing = await getPatientQuestionSet(questionSetId);
    if (existing) return existing;
  } catch (error) {
    console.error("Stored question set unavailable", error);
  }

  let agentResult;
  try {
    agentResult = await runCareAgent({
      snapshot,
      targetDate,
      requestId: randomUUID(),
    });
  } catch (error) {
    console.error("Care Agent unavailable; using record-based safe fallback", error);
    agentResult = await runCareAgent({ snapshot, targetDate, apiKey: "" });
    agentResult.run.status = "failed";
    agentResult.run.errorCode = "CARE_AGENT_FAILED";
  }

  const questionSet = buildPatientQuestionSet({
    snapshot,
    analysis: agentResult.output,
    targetDate,
    answerer: input.answerer,
    inputRevision,
    source: agentResult.source,
  });
  try {
    await saveQuestionSetGeneration({
      questionSet,
      analysis: agentResult.output,
      run: agentResult.run,
    });
  } catch (error) {
    console.error("Question set could not be persisted", error);
  }
  return questionSet;
}
