import { Trash2, TriangleAlert } from "lucide-react";

import type { MedicationPlanCandidate } from "@care-atlas/backend";

export type EditableMedicationCandidate = Pick<
  MedicationPlanCandidate,
  | "id"
  | "included"
  | "isManual"
  | "productName"
  | "ingredientName"
  | "mfdsItemSeq"
  | "insuranceCode"
  | "doseAmount"
  | "frequency"
  | "timing"
  | "startDate"
  | "endDate"
  | "supplyDays"
  | "reviewStatus"
> & { confirmedAgainstOriginal: boolean };

export function MedicationDraftCandidate({
  candidate,
  disabled,
  index,
  onRemove,
  onUpdate,
}: {
  candidate: EditableMedicationCandidate;
  disabled: boolean;
  index: number;
  onRemove: (id: string) => void;
  onUpdate: (
    id: string,
    update: Partial<EditableMedicationCandidate>,
    marksEdited?: boolean,
  ) => void;
}) {
  const verified = candidate.reviewStatus === "verified";
  const canInclude = verified || candidate.confirmedAgainstOriginal;

  return (
    <fieldset className="medication-draft-candidate" disabled={disabled}>
      <legend>약 {index + 1}{candidate.isManual ? " · 직접 추가" : ""}</legend>
      {candidate.isManual ? (
        <button
          className="medication-draft-candidate__remove"
          type="button"
          onClick={() => onRemove(candidate.id)}
        >
          <Trash2 size={15} aria-hidden="true" /> 삭제
        </button>
      ) : null}
      <div className="medication-draft-fields">
        <label>약 이름<input value={candidate.productName} onChange={(event) => onUpdate(candidate.id, { productName: event.target.value }, true)} required /></label>
        <label>성분명<input value={candidate.ingredientName} onChange={(event) => onUpdate(candidate.id, { ingredientName: event.target.value }, true)} /></label>
        <label>품목기준코드<input inputMode="numeric" value={candidate.mfdsItemSeq ?? ""} onChange={(event) => onUpdate(candidate.id, { mfdsItemSeq: event.target.value.replace(/\D/g, "") || undefined }, true)} /></label>
        <label>보험코드<input inputMode="numeric" value={candidate.insuranceCode ?? ""} onChange={(event) => onUpdate(candidate.id, { insuranceCode: event.target.value.replace(/\D/g, "") || undefined }, true)} /></label>
        <label>1회 용량<input value={candidate.doseAmount} onChange={(event) => onUpdate(candidate.id, { doseAmount: event.target.value }, true)} required /></label>
        <label>횟수<input value={candidate.frequency} onChange={(event) => onUpdate(candidate.id, { frequency: event.target.value }, true)} required /></label>
        <label>복용 시점<input value={candidate.timing} onChange={(event) => onUpdate(candidate.id, { timing: event.target.value }, true)} required /></label>
        <label>투약일수<input min="1" type="number" value={candidate.supplyDays ?? ""} onChange={(event) => onUpdate(candidate.id, { supplyDays: event.target.value ? Number(event.target.value) : undefined }, true)} /></label>
        <label>시작일<input type="date" value={candidate.startDate} onChange={(event) => onUpdate(candidate.id, { startDate: event.target.value }, true)} required /></label>
        <label>종료일<input type="date" value={candidate.endDate ?? ""} onChange={(event) => onUpdate(candidate.id, { endDate: event.target.value || undefined }, true)} required /></label>
      </div>

      {!verified ? (
        <label className="medication-draft-candidate__verification">
          <input
            type="checkbox"
            checked={candidate.confirmedAgainstOriginal}
            onChange={(event) => onUpdate(candidate.id, {
              confirmedAgainstOriginal: event.target.checked,
              ...(event.target.checked ? {} : { included: false }),
            })}
          />
          <span>
            <strong>원본 처방전과 모든 입력값을 대조했어요</strong>
            <small>자동 대조가 끝나지 않은 값은 이 확인 기록이 있어야 활성화할 수 있어요.</small>
          </span>
        </label>
      ) : null}

      <label className="medication-draft-candidate__include">
        <input
          type="checkbox"
          checked={candidate.included}
          disabled={!canInclude}
          onChange={(event) => onUpdate(candidate.id, { included: event.target.checked })}
        />
        <span>
          <strong>이 약을 복약 일정에 포함</strong>
          <small>{canInclude ? "제외한 후보는 활성화되지 않아요." : "먼저 원본 대조 확인을 완료해주세요."}</small>
        </span>
      </label>
      <p className="medication-draft-candidate__notice">
        <TriangleAlert size={16} aria-hidden="true" />
        {verified
          ? "공식 대조를 마친 값도 원본 처방전과 약 봉투를 기준으로 확인해주세요."
          : "자동 추출이 불완전하거나 공식 대조가 끝나지 않은 후보예요."}
      </p>
    </fieldset>
  );
}
