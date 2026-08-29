import {
  deleteDocument,
  confirmMedicationPlanDraft,
  getCareSnapshot,
  registerDocument,
  type CareDataScope,
  type RegisterDocumentInput,
  type ConfirmMedicationPlanDraftInput,
  type MedicationPlanConfirmationResult,
} from "./care-repository.ts";
import { syncMedicationReminderSchedules } from "./push-repository.ts";
import type { CareSnapshot, ClinicalDocument, MedicationPlan } from "./types.ts";
import type { FirestoreLike } from "./firestore-rest.ts";

type ReminderSyncInput = {
  recipientId: string;
  medications: MedicationPlan[];
  firestore?: FirestoreLike;
};

interface RegisterDependencies {
  registerDocument(
    scope: CareDataScope,
    input: RegisterDocumentInput,
  ): Promise<ClinicalDocument & { size: number }>;
  getCareSnapshot(scope: CareDataScope): Promise<CareSnapshot>;
  deleteDocument(
    scope: CareDataScope,
    documentId: string,
    currentSnapshot?: CareSnapshot,
  ): Promise<CareSnapshot>;
  syncMedicationReminderSchedules(input: ReminderSyncInput): Promise<unknown>;
}

interface DeleteDependencies {
  deleteDocument(
    scope: CareDataScope,
    documentId: string,
    currentSnapshot?: CareSnapshot,
  ): Promise<CareSnapshot>;
  syncMedicationReminderSchedules(input: ReminderSyncInput): Promise<unknown>;
}

interface ConfirmDependencies {
  confirmMedicationPlanDraft(
    scope: CareDataScope,
    input: ConfirmMedicationPlanDraftInput,
  ): Promise<MedicationPlanConfirmationResult>;
  getCareSnapshot(scope: CareDataScope): Promise<CareSnapshot>;
  syncMedicationReminderSchedules(input: ReminderSyncInput): Promise<unknown>;
}

async function syncWithOneRetry(
  sync: RegisterDependencies["syncMedicationReminderSchedules"],
  input: ReminderSyncInput,
) {
  try {
    await sync(input);
  } catch {
    await sync(input);
  }
}

export async function registerDocumentAndSyncMedicationReminders(
  scope: CareDataScope,
  input: RegisterDocumentInput,
  dependencies: RegisterDependencies = {
    registerDocument,
    getCareSnapshot,
    deleteDocument,
    syncMedicationReminderSchedules,
  },
) {
  const existingSnapshot = await dependencies.getCareSnapshot(scope);
  const existingDocument = existingSnapshot.documents.find(
    (document) => document.contentHash === input.contentHash,
  );
  if (existingDocument) return { ...existingDocument, size: input.size };

  const document = await dependencies.registerDocument(scope, input);
  const snapshot = await dependencies.getCareSnapshot(scope);
  try {
    await syncWithOneRetry(dependencies.syncMedicationReminderSchedules, {
      recipientId: scope.recipientId,
      medications: snapshot.medications,
      firestore: scope.firestore,
    });
  } catch {
    // The canonical write already committed its durable sync job. Rolling it
    // back here can delete another successful request's data and lose intent.
    console.error(JSON.stringify({ event: "reminder_sync_pending", code: "SYNC_DEFERRED" }));
  }
  return document;
}

export async function deleteDocumentAndSyncMedicationReminders(
  scope: CareDataScope,
  documentId: string,
  currentSnapshot?: CareSnapshot,
  dependencies: DeleteDependencies = {
    deleteDocument,
    syncMedicationReminderSchedules,
  },
) {
  const snapshot = await dependencies.deleteDocument(scope, documentId, currentSnapshot);
  try {
    await syncWithOneRetry(dependencies.syncMedicationReminderSchedules, {
      recipientId: scope.recipientId,
      medications: snapshot.medications,
      firestore: scope.firestore,
    });
  } catch {
    console.error(JSON.stringify({ event: "reminder_sync_pending", code: "SYNC_DEFERRED" }));
  }
}

export async function confirmMedicationPlanDraftAndSyncMedicationReminders(
  scope: CareDataScope,
  input: ConfirmMedicationPlanDraftInput,
  dependencies: ConfirmDependencies = {
    confirmMedicationPlanDraft,
    getCareSnapshot,
    syncMedicationReminderSchedules,
  },
) {
  const result = await dependencies.confirmMedicationPlanDraft(scope, input);
  const snapshot = await dependencies.getCareSnapshot(scope);
  try {
    await syncWithOneRetry(dependencies.syncMedicationReminderSchedules, {
      recipientId: scope.recipientId,
      medications: snapshot.medications,
      firestore: scope.firestore,
    });
  } catch {
    console.error(JSON.stringify({ event: "reminder_sync_pending", code: "SYNC_DEFERRED" }));
  }
  return result;
}
