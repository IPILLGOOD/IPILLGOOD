export type DoseResponse =
  | "completed"
  | "partial"
  | "skipped"
  | "not_yet"
  | "unconfirmed";

export interface CareRecipient {
  id: string;
  displayName: string;
  ageBand: string;
  heightCm?: number;
  weightKg?: number;
  allergies: string[];
  conditions: string[];
  mobilityNote: string;
  accessibilityPreferences: string[];
  caregiverNote: string;
  consentConfirmed: boolean;
  lastConfirmedAt: string;
}

export interface MedicationPlan {
  id: string;
  productName: string;
  ingredientName: string;
  purposePlain: string;
  descriptionPlain: string;
  doseAmount: string;
  frequency: string;
  timing: string;
  startDate: string;
  endDate?: string;
  status: "active" | "paused" | "ended";
  isNew: boolean;
  sourceLabel: string;
  watchFor: string[];
  clinicianQuestion?: string;
  howItWorksPlain?: string;
  commonEffects?: string[];
  precautions?: string[];
  storagePlain?: string;
}

export interface DoseEvent {
  id: string;
  medicationPlanId: string;
  scheduledAt: string;
  response: DoseResponse;
  nonAdherenceReason?: string;
  answeredBy: "caregiver" | "recipient";
  answeredAt?: string;
}

export interface SymptomEvent {
  id: string;
  symptomType: string;
  occurredAt: string;
  severity: number;
  dailyLifeImpact: string;
  reporterType: "caregiver_observed" | "recipient_reported";
  note?: string;
}

export interface DailyCheckIn {
  id: string;
  completedAt: string;
  completedBy: "caregiver" | "recipient";
  medicationResponses: Array<
    Pick<DoseEvent, "medicationPlanId" | "response" | "scheduledAt">
  >;
  symptoms: string[];
  severity?: number;
  note: string;
}

export interface ClinicalDocument {
  id: string;
  fileName: string;
  documentType: string;
  uploadedAt: string;
  status: "confirmed" | "awaiting_ai" | "needs_review";
  redacted: boolean;
  sourceLabel: string;
  analysis?: DocumentAnalysis;
}

export type ClinicalDocumentType = "처방전" | "진단서";

export interface DocumentAnalysis {
  documentType: ClinicalDocumentType;
  summary: string;
  findings: Array<{
    label: string;
    value: string;
  }>;
  carePoints: string[];
  questionsForProfessional: string[];
  disclaimer: string;
  source: "demo" | "api";
}

export interface ClinicianQuestion {
  id: string;
  priority: "today" | "next_visit";
  question: string;
  reason: string;
}

export interface CareSnapshot {
  recipient: CareRecipient;
  medications: MedicationPlan[];
  doseEvents: DoseEvent[];
  symptomEvents: SymptomEvent[];
  documents: ClinicalDocument[];
  clinicianQuestions: ClinicianQuestion[];
  dataSource: "firestore" | "local-fallback";
}

export interface ActionState {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Record<string, string[]>;
}
