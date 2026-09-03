import { assertCareAccountActive } from "./account-lifecycle.ts";
import { getAdminFirestore } from "./firebase-admin.ts";
import type { FirestoreLike } from "./firestore-rest.ts";
import { assertHealthDataConsentConfirmed } from "./health-data-consent.ts";
import type {
  ClinicalDocument,
  ClinicalDocumentType,
  DocumentAnalysis,
  MedicationPlanDraft,
} from "./types.ts";

export type DocumentAnalysisJobState =
  | "queued"
  | "uploading"
  | "extracting"
  | "analyzing"
  | "saving_draft"
  | "cancellation_requested"
  | "completed"
  | "failed"
  | "cancelled";

export interface DocumentAnalysisJobResult {
  message: string;
  analysis?: DocumentAnalysis;
  document?: ClinicalDocument;
  draft?: MedicationPlanDraft | null;
  addedMedicationCount?: number;
  reviewMedicationCount?: number;
  requiresPeriodReview?: boolean;
  duplicateResolutionRequired?: boolean;
  duplicateCandidates?: Array<{
    existingMedicationPlanId: string;
    existingDocumentId?: string;
    productName: string;
  }>;
  duplicateResolution?: "merge" | "separate";
  idempotentReplay?: boolean;
  idempotencyKey?: string;
}

export interface DocumentAnalysisJob {
  id: string;
  recipientId: string;
  idempotencyKey: string;
  contentHash: string;
  fileName: string;
  documentType: ClinicalDocumentType;
  state: DocumentAnalysisJobState;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  cancellationRequestedAt?: string;
  completedAt?: string;
  result?: DocumentAnalysisJobResult;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

type JobScope = {
  recipientId: string;
  firestore?: FirestoreLike;
};

const terminalStates = new Set<DocumentAnalysisJobState>([
  "completed",
  "failed",
  "cancelled",
]);

function assertJobId(jobId: string) {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(jobId)) {
    throw new Error("올바르지 않은 분석 작업 식별자입니다.");
  }
}

function jobRef(firestore: FirestoreLike, scope: JobScope, jobId: string) {
  return firestore.collection("careRecipients").doc(scope.recipientId)
    .collection("documentAnalysisJobs").doc(jobId);
}

async function firestoreFor(scope: JobScope) {
  return scope.firestore ?? await getAdminFirestore();
}

export async function startDocumentAnalysisJob(
  scope: JobScope,
  input: Pick<DocumentAnalysisJob, "id" | "idempotencyKey" | "contentHash" | "fileName" | "documentType">,
  now = new Date(),
) {
  assertJobId(input.id);
  const firestore = await firestoreFor(scope);
  return firestore.runTransaction(async (tx) => {
    await assertCareAccountActive(firestore, scope.recipientId, tx);
    await assertHealthDataConsentConfirmed(firestore, scope.recipientId, tx);
    const ref = jobRef(firestore, scope, input.id);
    const snapshot = await tx.get(ref);
    const existing = snapshot.data() as DocumentAnalysisJob | undefined;
    if (existing) {
      if (
        existing.recipientId !== scope.recipientId ||
        existing.idempotencyKey !== input.idempotencyKey ||
        existing.contentHash !== input.contentHash
      ) {
        throw new Error("분석 작업 식별자가 다른 문서에 사용됐습니다.");
      }
      if (!terminalStates.has(existing.state) || existing.state === "completed") {
        return { job: existing, shouldProcess: false };
      }
      const restarted: DocumentAnalysisJob = {
        ...existing,
        state: "queued",
        attempt: existing.attempt + 1,
        updatedAt: now.toISOString(),
        error: undefined,
        result: undefined,
        cancellationRequestedAt: undefined,
        completedAt: undefined,
      };
      tx.set(ref, restarted);
      return { job: restarted, shouldProcess: true };
    }
    const job: DocumentAnalysisJob = {
      ...input,
      recipientId: scope.recipientId,
      state: "queued",
      attempt: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    tx.create(ref, job);
    return { job, shouldProcess: true };
  });
}

export async function getDocumentAnalysisJob(scope: JobScope, jobId: string) {
  assertJobId(jobId);
  const firestore = await firestoreFor(scope);
  const snapshot = await jobRef(firestore, scope, jobId).get();
  if (!snapshot.exists) return null;
  const job = snapshot.data() as DocumentAnalysisJob;
  return job.recipientId === scope.recipientId ? job : null;
}

export async function advanceDocumentAnalysisJob(
  scope: JobScope,
  jobId: string,
  state: Exclude<DocumentAnalysisJobState, "cancellation_requested">,
  patch: Partial<Pick<DocumentAnalysisJob, "result" | "error" | "completedAt">> = {},
  now = new Date(),
) {
  assertJobId(jobId);
  const firestore = await firestoreFor(scope);
  return firestore.runTransaction(async (tx) => {
    const ref = jobRef(firestore, scope, jobId);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error("분석 작업을 찾지 못했습니다.");
    const current = snapshot.data() as DocumentAnalysisJob;
    if (current.recipientId !== scope.recipientId) throw new Error("분석 작업을 찾지 못했습니다.");
    if (terminalStates.has(current.state)) return current;
    if (current.state === "cancellation_requested" && state !== "cancelled") return current;
    const next: DocumentAnalysisJob = {
      ...current,
      ...patch,
      state,
      updatedAt: now.toISOString(),
      ...(terminalStates.has(state) ? { completedAt: patch.completedAt ?? now.toISOString() } : {}),
    };
    tx.set(ref, next);
    return next;
  });
}

export async function requestDocumentAnalysisJobCancellation(
  scope: JobScope,
  jobId: string,
  now = new Date(),
) {
  assertJobId(jobId);
  const firestore = await firestoreFor(scope);
  return firestore.runTransaction(async (tx) => {
    const ref = jobRef(firestore, scope, jobId);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return null;
    const current = snapshot.data() as DocumentAnalysisJob;
    if (current.recipientId !== scope.recipientId) return null;
    if (terminalStates.has(current.state)) return current;
    const next: DocumentAnalysisJob = {
      ...current,
      state: "cancellation_requested",
      cancellationRequestedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    tx.set(ref, next);
    return next;
  });
}

export class DocumentAnalysisCancelledError extends Error {
  constructor() {
    super("문서 분석이 취소되었습니다.");
    this.name = "DocumentAnalysisCancelledError";
  }
}

export async function assertDocumentAnalysisJobActive(scope: JobScope, jobId: string) {
  const job = await getDocumentAnalysisJob(scope, jobId);
  if (!job || job.state === "cancellation_requested" || job.state === "cancelled") {
    if (job?.state === "cancellation_requested") {
      await advanceDocumentAnalysisJob(scope, jobId, "cancelled");
    }
    throw new DocumentAnalysisCancelledError();
  }
  return job;
}
