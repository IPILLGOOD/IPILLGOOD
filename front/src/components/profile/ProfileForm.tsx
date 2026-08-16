"use client";

import { useActionState } from "react";

import { saveProfileAction } from "@/app/actions";
import { FormMessage } from "@/components/ui/FormMessage";
import { SubmitButton } from "@/components/ui/SubmitButton";
import type { ActionState, CareRecipient } from "@care-atlas/backend";

const initialState: ActionState = { status: "idle", message: "" };

export function ProfileForm({ recipient }: { recipient: CareRecipient }) {
  const [state, action] = useActionState(saveProfileAction, initialState);
  const error = (field: string) => state.fieldErrors?.[field]?.[0];
  const savedAge = /^\d+$/.test(recipient.ageBand) ? recipient.ageBand : "";

  return (
    <form action={action}>
      <FormMessage state={state} />
      <div className="form-grid">
        <div className="field">
          <label htmlFor="displayName">화면에 표시할 이름 <span aria-hidden="true">*</span></label>
          <input
            id="displayName"
            name="displayName"
            defaultValue={recipient.displayName}
            required
            aria-describedby={error("displayName") ? "displayName-error" : undefined}
          />
          {error("displayName") ? (
            <p className="field-error" id="displayName-error">{error("displayName")}</p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="ageBand">나이 <span aria-hidden="true">*</span></label>
          <input
            id="ageBand"
            name="ageBand"
            type="number"
            inputMode="numeric"
            min="1"
            max="120"
            step="1"
            defaultValue={savedAge}
            placeholder="예: 75"
            required
            aria-describedby={error("ageBand") ? "ageBand-error" : undefined}
          />
          {error("ageBand") ? (
            <p className="field-error" id="ageBand-error">{error("ageBand")}</p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="heightCm">키</label>
          <input
            id="heightCm"
            name="heightCm"
            type="number"
            inputMode="decimal"
            min="100"
            max="220"
            defaultValue={recipient.heightCm}
          />
          <p className="field-hint">선택 입력 · 복용량을 자동 계산하는 데 사용하지 않아요.</p>
        </div>

        <div className="field">
          <label htmlFor="weightKg">몸무게</label>
          <input
            id="weightKg"
            name="weightKg"
            type="number"
            inputMode="decimal"
            min="25"
            max="200"
            defaultValue={recipient.weightKg}
          />
          <p className="field-hint">선택 입력 · kg 단위</p>
        </div>

        <div className="field">
          <label htmlFor="allergies">알레르기 또는 과거 불편 반응</label>
          <input
            id="allergies"
            name="allergies"
            defaultValue={recipient.allergies.join(", ")}
            placeholder="쉼표로 구분해주세요"
          />
        </div>

        <div className="field">
          <label htmlFor="conditions">의료진에게 확인받은 건강 상태</label>
          <input
            id="conditions"
            name="conditions"
            defaultValue={recipient.conditions.join(", ")}
            placeholder="예: 혈압 관리 중, 무릎 통증"
          />
        </div>

        <div className="field form-grid__wide">
          <label htmlFor="mobilityNote">걷기와 이동에 관한 메모</label>
          <textarea id="mobilityNote" name="mobilityNote" defaultValue={recipient.mobilityNote} />
        </div>

        <div className="field form-grid__wide">
          <label htmlFor="caregiverNote">보호자가 추가로 남길 내용</label>
          <textarea id="caregiverNote" name="caregiverNote" defaultValue={recipient.caregiverNote} />
          <p className="field-hint">예: 식사, 수면, 약을 자주 잊는 시점 등 생활 맥락</p>
        </div>
      </div>

      <label className="consent-row">
        <input
          name="consentConfirmed"
          type="checkbox"
          defaultChecked={recipient.consentConfirmed}
          required
        />
        <span>
          어르신의 동의 또는 적법한 대리 권한이 있으며, 건강정보 저장에 동의합니다.
        </span>
      </label>
      {error("consentConfirmed") ? (
        <p className="field-error">{error("consentConfirmed")}</p>
      ) : null}

      <div className="form-actions">
        <SubmitButton pendingText="프로필 저장 중…">프로필 저장</SubmitButton>
      </div>
    </form>
  );
}
