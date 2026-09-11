import { CheckCircle2, Circle, Trash2 } from "lucide-react";

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
      <legend>
        <span>약 {index + 1}{candidate.isManual ? " · 직접 추가" : ""}</span>
        {candidate.isManual ? (
          <button
            className="medication-draft-candidate__remove"
            type="button"
            onClick={() => onRemove(candidate.id)}
          >
            <Trash2 size={15} aria-hidden="true" /> 삭제
          </button>
        ) : null}
      </legend>

      <div className="medication-draft-fields">
        <label>약 이름<input value={candidate.productName} onChange={(event) => onUpdate(candidate.id, { productName: event.target.value }, true)} required /></label>
        <label>1회 용량<input value={candidate.doseAmount} onChange={(event) => onUpdate(candidate.id, { doseAmount: event.target.value }, true)} required /></label>
        <label>횟수<input value={candidate.frequency} onChange={(event) => onUpdate(candidate.id, { frequency: event.target.value }, true)} required /></label>
        <label>복약 안내<input value={candidate.timing} onChange={(event) => onUpdate(candidate.id, { timing: event.target.value }, true)} required /></label>
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
            <strong>원본과 대조 완료</strong>
          </span>
        </label>
      ) : null}

      <label className={`medication-draft-candidate__include${candidate.included ? " is-selected" : ""}`}>
        <input
          type="checkbox"
          checked={candidate.included}
          disabled={!canInclude}
          onChange={(event) => onUpdate(candidate.id, { included: event.target.checked })}
        />
        {candidate.included ? <CheckCircle2 size={18} aria-hidden="true" /> : <Circle size={18} aria-hidden="true" />}
        <span>
          <strong>복용약으로 등록</strong>
          {!canInclude ? <small>먼저 원본과 대조해주세요.</small> : null}
        </span>
      </label>
    </fieldset>
  );
}
