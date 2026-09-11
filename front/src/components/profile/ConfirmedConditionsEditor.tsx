"use client";

import { useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ConfirmedCondition } from "@care-atlas/backend";

type ConditionDraft = {
  key: string;
  id?: string;
  standardName: string;
  code: string;
  confirmed: boolean;
  sourceLabel?: string;
};

export function ConfirmedConditionsEditor({
  conditions,
  error,
}: {
  conditions: ConfirmedCondition[];
  error?: string;
}) {
  const prefix = useId();
  const [items, setItems] = useState<ConditionDraft[]>(() =>
    conditions.map((item) => ({
      key: item.id,
      id: item.id,
      standardName: item.standardName,
      code: item.code === "코드 미기재" ? "" : item.code,
      confirmed: true,
      sourceLabel: item.sourceLabel,
    })),
  );
  const [removed, setRemoved] = useState<ConditionDraft | null>(null);
  const update = (key: string, patch: Partial<ConditionDraft>) => {
    setItems((previous) =>
      previous.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  };

  return (
    <fieldset
      className="field form-grid__wide confirmed-conditions"
      aria-describedby={`${prefix}-hint${error ? ` ${prefix}-error` : ""}`}
    >
      <legend>식사/영양 안내에 사용할 확정 질환</legend>
      <p className="field-hint" id={`${prefix}-hint`}>
        의료진에게 진단받은 질환을 등록해주세요. 문서에서 확인한 질환도 여기에
        표시돼요. 증상이나 건강 상태 메모는 자동으로 확정 질환에 추가하지
        않아요.
      </p>
      <input
        type="hidden"
        name="confirmedConditions"
        value={JSON.stringify(
          items.map(({ id, standardName, code, confirmed }) => ({
            id,
            standardName,
            code,
            confirmed,
          })),
        )}
      />
      <div className="confirmed-conditions__list">
        {items.map((item, index) => (
          <div className="confirmed-condition" key={item.key}>
            <div className="confirmed-condition__heading">
              <strong>질환 {index + 1}</strong>
              <button
                type="button"
                className="button button--quiet"
                aria-label={`${item.standardName || `질환 ${index + 1}`} 삭제`}
                onClick={() => {
                  setRemoved(item);
                  setItems((previous) =>
                    previous.filter((entry) => entry.key !== item.key),
                  );
                }}
              >
                <Trash2 size={16} aria-hidden="true" /> 삭제
              </button>
            </div>
            <div className="confirmed-condition__fields">
              <label htmlFor={`${prefix}-${item.key}-name`}>
                질환명
                <input
                  id={`${prefix}-${item.key}-name`}
                  value={item.standardName}
                  maxLength={120}
                  required
                  placeholder="의료진에게 진단받은 질환명"
                  onChange={(event) =>
                    update(item.key, {
                      standardName: event.target.value,
                      confirmed: false,
                    })
                  }
                />
              </label>
              <label htmlFor={`${prefix}-${item.key}-code`}>
                질환 코드 <span>(선택)</span>
                <input
                  id={`${prefix}-${item.key}-code`}
                  value={item.code}
                  maxLength={30}
                  placeholder="모르면 비워두세요"
                  onChange={(event) =>
                    update(item.key, {
                      code: event.target.value,
                      confirmed: false,
                    })
                  }
                />
              </label>
            </div>
            <label className="confirmed-condition__confirmation">
              <input
                type="checkbox"
                checked={item.confirmed}
                required
                onChange={(event) =>
                  update(item.key, { confirmed: event.target.checked })
                }
              />
              <span>의료진에게 진단받은 질환임을 확인했어요.</span>
            </label>
            {item.sourceLabel ? (
              <p className="field-hint">
                기존 확인 출처: {item.sourceLabel}. 내용을 수정하면 프로필에서
                새로 확인한 정보로 저장돼요.
              </p>
            ) : null}
          </div>
        ))}
      </div>
      {!items.length ? (
        <p className="confirmed-conditions__empty">
          등록된 확정 질환이 없어요. 진단받은 질환이 있을 때 추가해주세요.
        </p>
      ) : null}
      {removed ? (
        <div className="confirmed-conditions__undo" role="status">
          <span>{removed.standardName || "질환"}을 목록에서 뺐어요.</span>
          <button
            type="button"
            className="button button--quiet"
            disabled={items.length >= 50}
            onClick={() => {
              setItems((previous) => [...previous, removed]);
              setRemoved(null);
            }}
          >
            되돌리기
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className="button button--secondary confirmed-conditions__add"
        disabled={items.length >= 50}
        onClick={() => {
          setItems((previous) => [
            ...previous,
            {
              key: crypto.randomUUID(),
              standardName: "",
              code: "",
              confirmed: false,
            },
          ]);
        }}
      >
        <Plus size={17} aria-hidden="true" /> 질환 추가
      </button>
      <p className="field-hint">
        추가·수정·삭제한 내용은 아래 ‘프로필 저장’을 눌러야 반영돼요. 문서
        원본은 삭제되지 않아요.
      </p>
      {error ? (
        <p className="field-error" id={`${prefix}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
