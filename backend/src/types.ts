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
  confirmedConditions?: ConfirmedCondition[];
  supplementIntakes?: SupplementIntake[];
  mobilityNote: string;
  accessibilityPreferences: string[];
  caregiverNote: string;
  consentConfirmed: boolean;
  lastConfirmedAt: string;
}

export interface ConfirmedCondition {
  id: string;
  standardName: string;
  code: string;
  sourceDocumentId?: string;
  sourceLabel: string;
  confirmedAt: string;
}

export interface SupplementIntake {
  ingredientId: string;
  ingredientName: string;
  status: "active" | "stopped";
  lastConfirmedAt: string;
}

export type NutritionInsightStatus =
  | "consider"
  | "caution"
  | "avoid"
  | "professional_confirmation";

export interface NutritionEvidence {
  title: string;
  url: string;
  sourceVersion: string;
  evidenceLevel: "official_guideline" | "official_safety" | "ai_web_source";
  lastReviewedAt: string;
  reviewer: string;
}

export interface NutritionSafetyMatch {
  ingredientId: string;
  ingredientName: string;
  severity: "caution" | "avoid" | "professional_confirmation";
  medicationPlanIds: string[];
  medicationNames: string[];
  action: string;
  evidence: NutritionEvidence;
}

export interface NutritionInsight {
  id: string;
  kind: "food" | "safety";
  status: NutritionInsightStatus;
  title: string;
  source: "curated" | "ai_web";
  nutrientName?: string;
  summary: string;
  supplementGuidance?: string;
  foodExamples: string[];
  triggerConditions: ConfirmedCondition[];
  relatedSupplementIngredientIds: string[];
  matchedMedicationIds: string[];
  matchedMedicationNames: string[];
  currentSupplementNames: string[];
  professionalQuestion?: string;
  evidence: NutritionEvidence[];
  lastReviewedAt: string;
}

export interface NutritionKnowledgeRule {
  id: string;
  conditionIds: string[];
  kind: "food" | "safety";
  defaultStatus: NutritionInsightStatus;
  title: string;
  summary: string;
  foodExamples: string[];
  relatedSupplementIngredientIds: string[];
  professionalQuestion?: string;
  evidence: NutritionEvidence[];
}

export interface MedicationPlan {
  id: string;
  productName: string;
  ingredientName: string;
  categoryPlain: string;
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
  sourceDocumentId?: string;
  watchFor: string[];
  clinicianQuestion?: string;
  howItWorksPlain?: string;
  commonEffects?: string[];
  precautions?: string[];
  storagePlain?: string;
  confirmedBy?: string;
  confirmedAt?: string;
  sourceDocumentRevision?: string;
  stateChangedAt?: string;
}

export interface PrescriptionMedication {
  productName: string;
  ingredientName: string;
  itemCode?: string;
  doseAmount: string;
  frequency: string;
  timing: string;
  startDate: string;
  endDate?: string;
  purposePlain: string;
  precautions: string[];
  fieldEvidence?: MedicationFieldEvidence[];
  verification?: MedicationVerification;
  reviewStatus?: "verified" | "needs_review";
}

export type MedicationEvidenceField =
  | "productName"
  | "ingredientName"
  | "itemCode"
  | "doseAmount"
  | "frequency"
  | "timing"
  | "startDate"
  | "endDate";

export interface MedicationFieldEvidence {
  field: MedicationEvidenceField;
  sourceText: string;
  confidence: number;
  region?: {
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface MedicationVerification {
  status: "verified" | "mismatch" | "not_found" | "not_configured" | "unavailable";
  sourceLabel: string;
  officialItemCode?: string;
  officialProductName?: string;
  officialIngredientName?: string;
  warnings: string[];
}

export type MedicationDraftState =
  | "draft"
  | "needs_review"
  | "confirmed"
  | "active"
  | "expired"
  | "cancelled";

export interface MedicationPlanCandidate extends PrescriptionMedication {
  id: string;
  included: boolean;
  state: "draft" | "needs_review" | "confirmed" | "active" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

export interface MedicationDraftTransition {
  state: MedicationDraftState;
  at: string;
  by: string;
}

export interface MedicationPlanDraft {
  id: string;
  documentId: string;
  sourceDocumentRevision: string;
  revision: number;
  state: MedicationDraftState;
  candidates: MedicationPlanCandidate[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  confirmedBy?: string;
  confirmedAt?: string;
  activatedAt?: string;
  confirmationIdempotencyKey?: string;
  activeMedicationPlanIds?: string[];
  transitionHistory: MedicationDraftTransition[];
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
  questionSetId?: string;
  questionResponseId?: string;
}

export type QuestionPriority = "urgent" | "blocking" | "high" | "normal" | "optional";
export type QuestionAnswerType =
  | "single_choice"
  | "multi_choice"
  | "yes_no_unknown"
  | "approximate_time"
  | "number"
  | "short_text"
  | "confirmation";

export interface PatientQuestion {
  question_id: string;
  template_id: string;
  category: string;
  priority: QuestionPriority;
  source_agents: Array<"document" | "medication" | "care" | "profile" | "safety">;
  trigger_refs: string[];
  display: {
    badge: string;
    caregiver_text: string;
    recipient_text: string;
    helper_text: string;
  };
  answer_type: QuestionAnswerType;
  options: Array<{ value: string; label: string }>;
  options_source: null | {
    type: "medication_schedule";
    date: string;
    include_unknown_option: boolean;
  };
  required: boolean;
  allow_unknown: boolean;
  follow_up_rules: Array<{
    when_answer_in: string[];
    next_template_id: string;
  }>;
  safety: {
    validation_status: "pass";
    urgent_answer_values: string[];
  };
}

export interface PatientQuestionSet {
  schema_version: "patient-question-set.v1";
  question_set_id: string;
  generated_at: string;
  timezone: "Asia/Seoul";
  target_date: string;
  subject_ref: string;
  answerer: "caregiver" | "recipient";
  status: "ready" | "needs_confirmation" | "urgent" | "blocked";
  maximum_display_count: 3;
  questions: PatientQuestion[];
  source_analysis_refs: string[];
  safety_validation_ref: string;
  input_revision: string;
  prompt_version: string;
  generation_source: "agent" | "safe_fallback";
  response_status: "unanswered" | "answered";
  answered_at: string | null;
}

export interface PatientQuestionResponse {
  schema_version: "patient-question-response.v1";
  response_id: string;
  question_set_id: string;
  subject_ref: string;
  answered_by: "caregiver" | "recipient";
  answered_at: string;
  timezone: "Asia/Seoul";
  responses: Array<{
    question_id: string;
    answer: string | number | string[] | null;
    skipped: boolean;
  }>;
  triggered_by_response: Array<{
    question_id: string;
    answer_value: string;
    action: "show_follow_up" | "show_urgent_guidance";
  }>;
  source_refs: Array<{
    source_type: "patient_question_set";
    source_id: string;
  }>;
}

export type CareFindingType =
  | "symptom_onset"
  | "symptom_persistence"
  | "symptom_repeated"
  | "symptom_improving"
  | "symptom_worsening"
  | "vital_change"
  | "medication_completed"
  | "medication_missed"
  | "medication_unconfirmed";

export interface CareAgentOutput {
  schema_version: "care-agent.v1";
  analysis_id: string;
  generated_at: string;
  timezone: "Asia/Seoul";
  status: "completed" | "partial" | "insufficient";
  findings: Array<{
    finding_id: string;
    type: CareFindingType;
    summary: string;
    symptom_type: string;
    medication_plan_id: string;
    event_refs: string[];
  }>;
  missing_data: string[];
  urgency: "emergency" | "prompt_review" | "routine_review" | "unknown";
  source_refs: Array<{ source_type: string; source_id: string }>;
}

export interface AgentRunRecord {
  runId: string;
  requestId: string;
  agentType: "care";
  promptVersion: string;
  outputSchemaVersion: "care-agent.v1";
  inputRefs: Array<{ sourceType: string; sourceId: string }>;
  outputRef: string | null;
  validationRef: string | null;
  supersedesRunId: string | null;
  status: "completed" | "not_configured" | "failed";
  startedAt: string;
  completedAt: string;
  errorCode: string | null;
}

export interface ClinicalDocument {
  id: string;
  fileName: string;
  contentHash?: string;
  documentType: string;
  uploadedAt: string;
  status: "confirmed" | "awaiting_ai" | "needs_review";
  redacted: boolean;
  sourceLabel: string;
  analysis?: DocumentAnalysis;
  requestIdempotencyKey?: string;
  duplicateResolution?: "merge" | "separate";
  duplicateMedicationPlanIds?: string[];
  revision?: string;
  medicationDraftId?: string;
}

export type ClinicalDocumentType = "처방전" | "진단서";

export interface DiseaseReference {
  title: string;
  url: string;
}

export interface DiseaseInformation {
  query: string;
  matchedName: string;
  code?: string;
  overview: string;
  practicalPoints: string[];
  warningSigns: string[];
  source: "official_api" | "openai_web" | "demo";
  sourceLabel: string;
  references: DiseaseReference[];
}

export interface DiseaseLookupStatus {
  status:
    | "official_match"
    | "openai_fallback"
    | "not_configured"
    | "no_diagnosis"
    | "failed";
  message: string;
}

export interface DocumentAnalysis {
  documentType: ClinicalDocumentType;
  prescriptionDate?: string;
  totalSupplyDays?: number;
  summary: string;
  findings: Array<{
    label: string;
    value: string;
  }>;
  carePoints: string[];
  questionsForProfessional: string[];
  disclaimer: string;
  source: "demo" | "api" | "openai";
  medications?: PrescriptionMedication[];
  diagnoses?: Array<{
    name: string;
    code?: string;
  }>;
  diseaseInformation?: DiseaseInformation[];
  diseaseLookup?: DiseaseLookupStatus;
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
  todayCheckIn?: DailyCheckIn | null;
  dataSource: "firestore" | "local-fallback";
  revision: number;
}

export interface ActionState {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Record<string, string[]>;
  conflict?: boolean;
}
