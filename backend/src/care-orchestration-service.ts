import { dateKeyInSeoul } from "./dates.ts";
import { assertCareAccountActive, isCareAccountActive } from "./account-lifecycle.ts";
import { withCareAccountProcessing } from "./account-processing.ts";
import { randomUUID } from "node:crypto";

import { careInputRevision, runCareAgent, type CareAgentResult } from "./ai/care-agent.ts";
import { buildPatientQuestionSet, questionSetIdFor } from "./ai/questions/generate-question-set.ts";
import { getCareSnapshot, type CareDataScope } from "./care-repository.ts";
import { getAdminFirestore } from "./firebase-admin.ts";
import type { CareSnapshot, PatientQuestionSet } from "./types.ts";

const GENERATION_LEASE_MS = 150_000;

type SavedResult = { questionSet: PatientQuestionSet; agent: CareAgentResult };
type Generation = {
  status: "running" | "result_ready" | "completed" | "failed";
  owner: string;
  leaseUntil: string;
  attempts: number;
  result?: SavedResult;
  sourceDocumentIds: string[];
};

export { dateKeyInSeoul } from "./dates.ts";

export type QuestionSetAvailability =
  | { status: "ready"; questionSet: PatientQuestionSet }
  | { status: "unavailable"; message: string };

// An unpublished result must never become a usable form. Keep the checkpoint for retry.
export async function getQuestionSetAvailability(
  input: Parameters<typeof getOrCreateQuestionSet>[0],
  dependencies: Parameters<typeof getOrCreateQuestionSet>[1] = {},
): Promise<QuestionSetAvailability> {
  try {
    return { status: "ready", questionSet: await getOrCreateQuestionSet(input, { maxWaitMs: 1500, ...dependencies }) };
  } catch {
    return { status: "unavailable", message: "질문을 안전하게 저장하지 못했어요. 잠시 후 다시 준비해 주세요." };
  }
}

export async function getOrCreateQuestionSet(input: {
  scope: CareDataScope;
  targetDate?: string;
  answerer: "caregiver" | "recipient";
  snapshot?: CareSnapshot;
}, dependencies: {
  runAgent?: typeof runCareAgent;
  now?: () => Date;
  wait?: (ms: number) => Promise<void>;
  maxWaitMs?: number;
} = {}): Promise<PatientQuestionSet> {
  const clock = dependencies.now ?? (() => new Date());
  const wait = dependencies.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const targetDate = input.targetDate ?? dateKeyInSeoul(clock());
  const snapshot = input.snapshot ?? await getCareSnapshot(input.scope);
  if (snapshot.recipient.id !== input.scope.recipientId || snapshot.dataSource !== "firestore") {
    throw new Error("질문 생성에 필요한 서버 데이터를 다시 확인해 주세요.");
  }
  const inputRevision = careInputRevision(snapshot, targetDate);
  const id = questionSetIdFor({ recipientId: input.scope.recipientId, targetDate, answerer: input.answerer, inputRevision });
  const firestore = input.scope.firestore ?? await getAdminFirestore();
  const recipient = firestore.collection("careRecipients").doc(input.scope.recipientId);
  const questionRef = recipient.collection("questionSets").doc(id);
  const generationRef = recipient.collection("questionGenerations").doc(id);
  const owner = randomUUID();
  const sourceDocumentIds = snapshot.documents.map((doc) => doc.id);
  const deadline = Date.now() + (dependencies.maxWaitMs ?? 120_000);
  let saved: SavedResult | undefined;
  let attempt = 0;

  // No external API calls inside transactions: a retried transaction must not repeat them.
  for (;;) {
    const claim = await firestore.runTransaction(async (tx) => {
      await assertCareAccountActive(firestore, input.scope.recipientId, tx);
      const [question, generation, account, demo] = await Promise.all([
        tx.get(questionRef), tx.get(generationRef), tx.get(recipient),
        input.scope.useDemoData ? tx.get(firestore.collection("demoSessions").doc(input.scope.recipientId)) : null,
      ]);
      if (!account.exists) throw new Error("돌봄 계정을 다시 확인해 주세요.");
      if (demo && (!demo.exists || (demo.data() as { status: string }).status !== "active" || Date.parse((demo.data() as { expiresAt: string }).expiresAt) <= clock().getTime())) {
        throw new Error("데모 세션이 만료되었습니다.");
      }
      if (question.exists) return { existing: question.data() as PatientQuestionSet };
      const current = generation.data() as Generation | undefined;
      if (current && current.owner !== owner && Date.parse(current.leaseUntil) > clock().getTime() && current.status !== "failed") return { busy: true };
      attempt = (current?.attempts ?? 0) + 1;
      const state: Generation = {
        status: current?.result ? "result_ready" : "running", owner,
        leaseUntil: new Date(clock().getTime() + GENERATION_LEASE_MS).toISOString(), attempts: attempt,
        sourceDocumentIds, ...(current?.result ? { result: current.result } : {}),
      };
      if (current && current.status !== "failed" && current.status !== "completed") {
        tx.set(recipient.collection("questionGenerationAttempts").doc(`${id}-${current.attempts}`), {
          status: "interrupted", attempt: current.attempts, generationId: id,
          errorCode: "GENERATION_LEASE_EXPIRED", completedAt: clock().toISOString(),
        });
      }
      tx.set(generationRef, state);
      tx.set(recipient.collection("questionGenerationAttempts").doc(`${id}-${attempt}`), {
        status: "running", attempt, generationId: id, startedAt: clock().toISOString(),
      });
      return { saved: current?.result };
    });
    if (claim.existing) return claim.existing;
    if (!claim.busy) { saved = claim.saved; break; }
    if (Date.now() >= deadline) throw new Error("질문을 준비 중입니다. 잠시 후 다시 시도해 주세요.");
    await wait(100);
  }

  const attemptRef = recipient.collection("questionGenerationAttempts").doc(`${id}-${attempt}`);
  try {
    if (!saved) {
      await assertCareAccountActive(firestore, input.scope.recipientId);
      let result: CareAgentResult;
      try {
        result = await withCareAccountProcessing(input.scope.recipientId, () => (dependencies.runAgent ?? runCareAgent)({ snapshot, targetDate, requestId: id }), firestore);
      } catch {
        await assertCareAccountActive(firestore, input.scope.recipientId);
        result = await runCareAgent({ snapshot, targetDate, apiKey: "", requestId: id });
        result.run.status = "failed";
        result.run.errorCode = "CARE_AGENT_FAILED";
      }
      result.output.analysis_id = `analysis-${id}`;
      result.run = { ...result.run, runId: `run-${id}`, requestId: id, outputRef: result.output.analysis_id };
      saved = { agent: result, questionSet: buildPatientQuestionSet({ snapshot, analysis: result.output, targetDate, answerer: input.answerer, inputRevision, source: result.source }) };
      // Persist the external result before publishing it. A failed publication can reuse this checkpoint.
      for (let checkpointAttempt = 0; ; checkpointAttempt++) {
        try {
          await firestore.runTransaction(async (tx) => {
            await assertCareAccountActive(firestore, input.scope.recipientId, tx);
            const generation = await tx.get(generationRef);
            if ((generation.data() as Generation | undefined)?.owner !== owner) throw new Error("질문 생성 권한이 만료되었습니다.");
            tx.set(generationRef, { status: "result_ready", result: saved }, { merge: true });
          });
          break;
        } catch (error) {
          if (checkpointAttempt >= 2) throw error;
          await wait(25 * 2 ** checkpointAttempt);
        }
      }
    }
    const completed = saved;
    return await firestore.runTransaction(async (tx) => {
      await assertCareAccountActive(firestore, input.scope.recipientId, tx);
      const [generation, question, account, demo, ...sources] = await Promise.all([
        tx.get(generationRef), tx.get(questionRef), tx.get(recipient),
        input.scope.useDemoData ? tx.get(firestore.collection("demoSessions").doc(input.scope.recipientId)) : null,
        ...sourceDocumentIds.map((documentId) => tx.get(recipient.collection("clinicalDocuments").doc(documentId))),
      ]);
      if (question.exists) return question.data() as PatientQuestionSet;
      if ((generation.data() as Generation | undefined)?.owner !== owner) throw new Error("질문 생성 권한이 만료되었습니다.");
      if (demo && (!demo.exists || (demo.data() as { status: string }).status !== "active" || Date.parse((demo.data() as { expiresAt: string }).expiresAt) <= clock().getTime())) throw new Error("데모 세션이 만료되었습니다.");
      if (!account.exists || sources.some((doc) => !doc.exists)) throw new Error("질문 근거가 변경되어 다시 확인해야 합니다.");
      tx.set(questionRef, { ...completed.questionSet, sourceDocumentIds });
      tx.set(recipient.collection("careAnalyses").doc(completed.agent.output.analysis_id), {
        ...completed.agent.output, promptVersion: completed.questionSet.prompt_version, inputRevision, sourceDocumentIds,
      });
      tx.set(recipient.collection("agentRuns").doc(completed.agent.run.runId), { ...completed.agent.run, sourceDocumentIds });
      // Drop the duplicate health payload after publication; keep only operational metadata.
      tx.set(generationRef, { status: "completed", owner, leaseUntil: clock().toISOString(), attempts: attempt, sourceDocumentIds, completedAt: clock().toISOString() });
      tx.set(attemptRef, { status: "completed", attempt, generationId: id, completedAt: clock().toISOString() });
      return completed.questionSet;
    });
  } catch (error) {
    // Preserve a durable result but relinquish ownership so the next request can finish publication.
    await firestore.runTransaction(async (tx) => {
      if (!await isCareAccountActive(firestore, input.scope.recipientId, tx)) return;
      const generation = await tx.get(generationRef);
      if ((generation.data() as Generation | undefined)?.owner !== owner) return;
      tx.set(generationRef, { status: "failed", leaseUntil: clock().toISOString(), errorCode: "GENERATION_NOT_PUBLISHED" }, { merge: true });
      tx.set(attemptRef, { status: "failed", attempt, generationId: id, errorCode: "GENERATION_NOT_PUBLISHED", completedAt: clock().toISOString() });
    }).catch(() => undefined);
    throw error;
  }
}
