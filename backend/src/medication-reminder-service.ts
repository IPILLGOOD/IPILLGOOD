import {
  deleteDocument,
  getCareSnapshot,
  registerDocument,
  type CareDataScope,
  type RegisterDocumentInput,
} from "./care-repository.ts";
import { syncMedicationReminderSchedules } from "./push-repository.ts";
import type { CareSnapshot, ClinicalDocument, MedicationPlan } from "./types.ts";

type ReminderSyncInput = {
  recipientId: string;
  medications: MedicationPlan[];
};

interface RegisterDependencies {
  registerDocument(
    scope: CareDataScope,
    input: RegisterDocumentInput,
  ): Promise<ClinicalDocument & { size: number }>;
  getCareSnapshot(scope: CareDataScope): Promise<CareSnapshot>;
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
    syncMedicationReminderSchedules,
  },
) {
  const document = await dependencies.registerDocument(scope, input);
  const snapshot = await dependencies.getCareSnapshot(scope);
  await syncWithOneRetry(dependencies.syncMedicationReminderSchedules, {
    recipientId: scope.recipientId,
    medications: snapshot.medications,
  });
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
  await syncWithOneRetry(dependencies.syncMedicationReminderSchedules, {
    recipientId: scope.recipientId,
    medications: snapshot.medications,
  });
}
