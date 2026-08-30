"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { saveProfileAction } from "@/app/actions";
import { FormMessage } from "@/components/ui/FormMessage";
import { SubmitButton } from "@/components/ui/SubmitButton";
import type { ActionState, CareRecipient } from "@care-atlas/backend";

const initialState: ActionState = { status: "idle", message: "" };
const confirmedConditionOptions = [
  { id: "condition-hypertension", label: "고혈압", code: "I10" },
  { id: "condition-hyperlipidemia", label: "고지혈증", code: "E78" },
  { id: "condition-knee-osteoarthritis", label: "무릎 골관절염", code: "M17" },
] as const;

export function ProfileForm({ recipient, revision, onboarding = false }: { recipient: CareRecipient; revision: number; onboarding?: boolean }) {
  const router = useRouter();
  const [state, action] = useActionState(saveProfileAction, initialState);
  const [baselineRevision, setBaselineRevision] = useState(revision);
  const conflictRefreshed = useRef(false);
  useEffect(() => {
    if (state.conflict && !conflictRefreshed.current) {
      conflictRefreshed.current = true;
      router.refresh();
    }
    if (!state.conflict) conflictRefreshed.current = false;
  }, [router, state.conflict]);
  useEffect(() => {
    if (onboarding && state.status === "success") router.replace("/today");
  }, [onboarding, router, state.status]);
  const error = (field: string) => state.fieldErrors?.[field]?.[0];
  const savedAge = /^\d+$/.test(recipient.ageBand) ? recipient.ageBand : "";

  return (
    <form action={action}>
      <input type="hidden" name="expectedRevision" value={baselineRevision} />
      <FormMessage state={state} />
      {state.conflict ? (
        <button className="button button--secondary" type="button" disabled={revision === baselineRevision} onClick={() => setBaselineRevision(revision)}>
          {revision === baselineRevision ? "최신 내용 불러오는 중…" : "최신 내용 확인 후 다시 저장"}
        </button>
      ) : null}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="displayName">화면에 표시할 이름 <span aria-hidden="true">*</span></label>
          <input
            id="displayName"
            name="displayName"
            defaultValue={recipient.displayName}
            required
            aria-invalid={Boolean(error("displayName"))}
            aria-describedby={`displayName-hint${error("displayName") ? " displayName-error" : ""}`}
          />
          <p className="field-hint" id="displayName-hint">
            오늘 돌봄 화면과 기록·리포트에서 대상을 구분하는 데 사용해요.
          </p>
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
            aria-invalid={Boolean(error("ageBand"))}
            aria-describedby={`ageBand-hint${error("ageBand") ? " ageBand-error" : ""}`}
          />
          <p className="field-hint" id="ageBand-hint">
            연령을 고려한 오늘의 돌봄 질문을 만드는 데 사용해요.
          </p>
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
            aria-describedby="heightCm-hint"
          />
          <p className="field-hint" id="heightCm-hint">
            선택 입력 · 프로필 참고 정보로만 보관하며 복용량을 자동 계산하지 않아요.
          </p>
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
            aria-describedby="weightKg-hint"
          />
          <p className="field-hint" id="weightKg-hint">
            선택 입력 · kg 단위로 프로필에 보관하며 복용량을 자동 계산하지 않아요.
          </p>
        </div>

        <div className="field">
          <label htmlFor="allergies">알레르기 또는 과거 불편 반응</label>
          <input
            id="allergies"
            name="allergies"
            defaultValue={recipient.allergies.join(", ")}
            placeholder="쉼표로 구분해주세요"
            aria-describedby="allergies-hint"
          />
          <p className="field-hint" id="allergies-hint">
            보호자가 복약 전 주의할 정보를 함께 확인할 수 있도록 프로필에 정리해요.
          </p>
        </div>

        <div className="field">
          <label htmlFor="conditions">건강 상태 참고 메모</label>
          <input
            id="conditions"
            name="conditions"
            defaultValue={recipient.conditions.join(", ")}
            placeholder="예: 혈압 관리 중, 무릎 통증"
            aria-describedby="conditions-hint"
          />
          <p className="field-hint" id="conditions-hint">
            참고용 자유 메모예요. 이 내용만으로 식사·영양 고려사항을 만들지는 않아요.
          </p>
        </div>

        <fieldset className="field form-grid__wide profile-choice-fieldset">
          <legend>식사·영양 안내에 사용할 확정 질환</legend>
          <p className="field-hint">
            의료진에게 확인받은 질환만 선택해주세요. 선택한 질환만 안내 생성에 사용해요.
          </p>
          <div className="profile-choice-grid">
            {confirmedConditionOptions.map((condition) => (
              <label className="profile-choice" key={condition.id}>
                <input
                  type="checkbox"
                  name="confirmedConditionIds"
                  value={condition.id}
                  defaultChecked={recipient.confirmedConditions?.some((item) => item.id === condition.id)}
                />
                <span><strong>{condition.label}</strong><small>{condition.code}</small></span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="field form-grid__wide">
          <label htmlFor="mobilityNote">걷기와 이동에 관한 메모</label>
          <textarea
            id="mobilityNote"
            name="mobilityNote"
            defaultValue={recipient.mobilityNote}
            aria-describedby="mobilityNote-hint"
          />
          <p className="field-hint" id="mobilityNote-hint">
            이동 상태를 고려한 오늘의 돌봄 질문을 만드는 데 사용해요.
          </p>
        </div>

        <div className="field form-grid__wide">
          <label htmlFor="caregiverNote">보호자가 추가로 남길 내용</label>
          <textarea
            id="caregiverNote"
            name="caregiverNote"
            defaultValue={recipient.caregiverNote}
            aria-describedby="caregiverNote-hint"
          />
          <p className="field-hint" id="caregiverNote-hint">
            식사·수면·복약 습관 등 생활 맥락을 보호자와 함께 확인할 수 있도록 보관해요.
          </p>
        </div>
      </div>

      <label className="consent-row">
        <input
          name="consentConfirmed"
          type="checkbox"
          defaultChecked={recipient.consentConfirmed}
          required
          aria-invalid={Boolean(error("consentConfirmed"))}
          aria-describedby={error("consentConfirmed") ? "consent-error" : undefined}
        />
        <span>
          어르신의 동의 또는 적법한 대리 권한이 있으며, 건강정보 저장에 동의합니다.
        </span>
      </label>
      {error("consentConfirmed") ? (
        <p className="field-error" id="consent-error">{error("consentConfirmed")}</p>
      ) : null}

      <div className="form-actions">
        <SubmitButton pendingText="프로필 저장 중…">프로필 저장</SubmitButton>
      </div>
    </form>
  );
}
