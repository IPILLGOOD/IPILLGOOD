import assert from "node:assert/strict";
import test from "node:test";

import { updateRecipientProfile, getCareSnapshot, registerDocument } from "./care-repository.ts";
import {
  advanceDocumentAnalysisJob,
  assertDocumentAnalysisJobActive,
  getDocumentAnalysisJob,
  requestDocumentAnalysisJobCancellation,
  startDocumentAnalysisJob,
} from "./document-analysis-jobs.ts";
import { MemoryFirestore } from "../test-support/memory-firestore.ts";

async function consentedScope(recipientId: string) {
  const firestore = new MemoryFirestore();
  const scope = { recipientId, firestore };
  const snapshot = await getCareSnapshot(scope);
  await updateRecipientProfile(scope, {
    ...snapshot.recipient,
    displayName: "분석 대상자",
    ageBand: "70",
    consentConfirmed: true,
    lastConfirmedAt: "2026-09-01T00:00:00.000Z",
    profileCompletedAt: "2026-09-01T00:00:00.000Z",
  }, snapshot);
  return scope;
}

const input = {
  id: "analysis-job-001",
  idempotencyKey: "analysis-request-001",
  contentHash: "content-hash-001",
  fileName: "prescription.pdf",
  documentType: "처방전" as const,
};

test("같은 분석 job 재요청은 실행을 중복 시작하지 않고 완료 결과를 복구한다", async () => {
  const scope = await consentedScope("analysis-idempotent");
  const first = await startDocumentAnalysisJob(scope, input);
  const duplicate = await startDocumentAnalysisJob(scope, input);
  assert.equal(first.shouldProcess, true);
  assert.equal(duplicate.shouldProcess, false);
  await advanceDocumentAnalysisJob(scope, input.id, "completed", {
    result: { message: "완료" },
  });
  const replay = await startDocumentAnalysisJob(scope, input);
  assert.equal(replay.shouldProcess, false);
  assert.equal(replay.job.result?.message, "완료");
});

test("취소 요청 뒤 늦게 도착한 분석 결과는 저장 단계나 완료 상태로 전진하지 않는다", async () => {
  const scope = await consentedScope("analysis-cancelled");
  await startDocumentAnalysisJob(scope, input);
  await advanceDocumentAnalysisJob(scope, input.id, "analyzing");
  await requestDocumentAnalysisJobCancellation(scope, input.id);
  const late = await advanceDocumentAnalysisJob(scope, input.id, "saving_draft");
  assert.equal(late.state, "cancellation_requested");
  await assert.rejects(registerDocument(scope, {
    fileName: input.fileName,
    contentHash: input.contentHash,
    documentType: input.documentType,
    size: 100,
    isSample: true,
    analysis: undefined,
    requestIdempotencyKey: input.idempotencyKey,
    analysisJobId: input.id,
  }), /취소/);
  assert.equal(firestoreDocumentExists(scope.firestore, `careRecipients/${scope.recipientId}/clinicalDocuments/${input.contentHash}`), false);
  await assert.rejects(assertDocumentAnalysisJobActive(scope, input.id), /취소/);
  assert.equal((await getDocumentAnalysisJob(scope, input.id))?.state, "cancelled");
});

function firestoreDocumentExists(firestore: MemoryFirestore, path: string) {
  return firestore.store.has(path);
}

test("실패한 동일 job은 attempt를 올려 안전하게 다시 시작한다", async () => {
  const scope = await consentedScope("analysis-retry");
  await startDocumentAnalysisJob(scope, input);
  await advanceDocumentAnalysisJob(scope, input.id, "failed", {
    error: { code: "PROVIDER_TIMEOUT", message: "시간이 초과됐어요.", retryable: true },
  });
  const retry = await startDocumentAnalysisJob(scope, input);
  assert.equal(retry.shouldProcess, true);
  assert.equal(retry.job.attempt, 2);
  assert.equal(retry.job.state, "queued");
  assert.equal(retry.job.error, undefined);
});
