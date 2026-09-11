import type { ConfirmedCondition, DocumentAnalysis } from "@care-atlas/backend";
import type { MedicationCabinetItem } from "@/components/medications/MedicationCabinet";

export const previewMedications: MedicationCabinetItem[] = [
  { id: "sample-a", productName: "샘플 혈압약 A", ingredientName: "샘플 성분 A", category: "혈압약", isNew: false, purpose: "혈압이 지나치게 높아지지 않도록 조절하는 데 사용돼요.", commonEffects: ["처음 복용할 때 어지럽거나 얼굴이 화끈하게 느껴질 수 있어요.", "발목이 붓는 느낌이 생길 수 있어요."], dose: "1정", frequency: "하루 1회", timing: "아침 식사 후", startSummary: "샘플 복용 기간", sourceLabel: "UI 미리보기용 가상 처방전", clinicianQuestion: "다음 상담 때 어떤 기록을 가져가면 좋을까요?" },
  { id: "sample-b", productName: "샘플 복용약 B", ingredientName: "샘플 성분 B", category: "새로 등록한 약", isNew: true, purpose: "공식 허가정보에 적힌 대표적인 쓰임을 쉬운 문장으로 보여줘요.", commonEffects: ["속이 더부룩하거나 가볍게 불편할 수 있어요."], dose: "1캡슐", frequency: "하루 2회", timing: "아침·저녁 식사 후", startSummary: "오늘부터 7일 · 가상 일정", sourceLabel: "UI 미리보기용 가상 처방전" },
  { id: "sample-c", productName: "이름이 긴 샘플 복용약 C 10mg", ingredientName: "샘플 성분 C", category: "저녁 복용약", isNew: false, purpose: "긴 약 이름에서도 약의 대표적인 쓰임을 먼저 확인해요.", commonEffects: ["가벼운 두통이나 소화 불편이 느껴질 수 있어요."], dose: "1정", frequency: "하루 1회", timing: "저녁 식사 후", startSummary: "샘플 복용 기간", sourceLabel: "UI 미리보기용 가상 처방전" },
];
export const previewConditions: ConfirmedCondition[] = [
  { id: "sample-condition-1", standardName: "고혈압", code: "I10", sourceLabel: "가상 프로필의 확정 질환", confirmedAt: "2026-09-01T00:00:00Z" },
  { id: "sample-condition-2", standardName: "이상지질혈증", code: "E78", sourceLabel: "가상 진단서에서 확인", confirmedAt: "2026-09-01T00:00:00Z" },
];
export const previewAnalysis: DocumentAnalysis = {
  source: "demo", documentType: "처방전", summary: "UI 확인용 가상 문서에서 복용약 1개를 찾았어요.",
  findings: [{ label: "문서", value: "가상 처방전" }, { label: "등록할 약", value: "샘플 복용약 D" }],
  disclaimer: "실제 문서나 외부 분석을 사용하지 않는 샘플 결과예요.",
  carePoints: ["샘플 약 이름과 복용 시간을 확인해보세요."],
  questionsForProfessional: ["복약 기록에서 어떤 내용을 확인하면 좋을까요?"],
};
export type PreviewDose = { id: string; medicationPlanId: string; scheduledAt: string; response: "completed" | "partial" | "skipped" | "not_yet" | "unconfirmed"; answeredBy: "caregiver" | "recipient" };
export function makePreviewDoses(day: string): PreviewDose[] {
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - offset);
    return previewMedications.flatMap((medication, index) => (index === 1 ? ["08", "19"] : [index === 2 ? "19" : "08"]).map((hour): PreviewDose => ({
      id: `sample-dose-${offset}-${index}-${hour}`, medicationPlanId: medication.id,
      scheduledAt: `${date.toISOString().slice(0, 10)}T${hour}:00:00+09:00`,
      response: offset === 0 ? index === 0 ? "completed" : "not_yet" : offset === 2 ? "partial" : offset === 4 ? "skipped" : "completed",
      answeredBy: "caregiver",
    })));
  }).flat();
}
