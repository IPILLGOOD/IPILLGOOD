import type { DocumentAnalysis } from "@care-atlas/backend";

export function supportedNutritionDiagnoses(analysis: DocumentAnalysis) {
  return (analysis.diagnoses ?? []).filter((diagnosis) => diagnosis.name.trim().length > 0);
}
