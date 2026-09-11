"use client";

import { Search } from "lucide-react";
import { useActionState, useId, useState, type FormEvent } from "react";
import { addMedicationAction } from "@/app/actions";
import { Card } from "@/components/ui/Card";
import { FormMessage } from "@/components/ui/FormMessage";
import type {
  ActionState,
  OfficialMedicationLookupResult,
  OfficialMedicationSearchItem,
} from "@care-atlas/backend";
import {
  medicationDoseQuantities,
  medicationDoseUnits,
  medicationFrequencyOptions,
  medicationSlotCount,
  medicationTimingOptions,
} from "@/lib/medication-registration-options";

type AddAction = (state: ActionState, data: FormData) => Promise<ActionState>;
export function MedicationSearchAdd({
  query,
  result,
  revision,
  today,
  onSearch,
  onAdd,
}: {
  query: string;
  result: OfficialMedicationLookupResult | null;
  revision: number;
  today: string;
  onSearch?: (query: string) => void;
  onAdd?: AddAction;
}) {
  function search(event: FormEvent<HTMLFormElement>) {
    if (!onSearch) return;
    event.preventDefault();
    onSearch(String(new FormData(event.currentTarget).get("q") ?? "").trim());
  }
  return (
    <Card
      className="medication-search-add"
      aria-labelledby="medication-search-add-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="medication-search-add-title">약 검색해서 추가</h2>
          <p>제품명을 적힌 그대로 정확하게 입력해주세요.</p>
        </div>
      </div>
      <form
        className="official-drug-search"
        role="search"
        method="get"
        action="/medications"
        onSubmit={search}
      >
        <div className="official-drug-search__controls">
          <input
            name="q"
            aria-label="검색할 약 제품명"
            type="search"
            defaultValue={query}
            required
            maxLength={100}
            placeholder="예: 노바스크정 5mg"
          />
          <button className="button button--primary" type="submit">
            <Search size={18} aria-hidden="true" /> 검색
          </button>
        </div>
      </form>
      {query && result?.status !== "connected" ? (
        <p className="analysis-status analysis-status--error" role="alert">
          {result?.message ?? "약을 검색하지 못했어요."}
        </p>
      ) : null}
      {result?.status === "connected" && result.items.length === 0 ? (
        <p className="analysis-status" role="status">
          검색 결과가 없어요. 약봉투의 정확한 제품명을 확인해주세요.
        </p>
      ) : null}
      {result?.status === "connected" && result.items.length > 0 ? (
        <div className="medication-search-add__results">
          {result.items.map((item) => (
            <MedicationAddForm
              key={item.itemSeq}
              item={item}
              revision={revision}
              today={today}
              onAdd={onAdd}
            />
          ))}
        </div>
      ) : null}
    </Card>
  );
}
function MedicationAddForm({
  item,
  revision,
  today,
  onAdd,
}: {
  item: OfficialMedicationSearchItem;
  revision: number;
  today: string;
  onAdd?: AddAction;
}) {
  const fieldId = useId();
  const [frequency, setFrequency] = useState("");
  const slotCount = medicationSlotCount(frequency);
  const [state, action, pending] = useActionState(
    onAdd ?? addMedicationAction,
    { status: "idle" as const, message: "" },
  );
  return (
    <form
      className="medication-search-add__item"
      action={action}
      onReset={() => setFrequency("")}
    >
      <input type="hidden" name="expectedRevision" value={revision} />
      <input type="hidden" name="itemSeq" value={item.itemSeq} />
      <header>
        <strong>{item.productName}</strong>
        <span>
          {item.ingredientName || "성분 확인 필요"} · {item.manufacturer}
        </span>
      </header>
      <p className="medication-search-add__instruction">
        약봉투나 처방전에 적힌 값을 차례로 선택해주세요.
      </p>
      <div className="medication-search-add__fields">
        <fieldset className="medication-dose-field">
          <legend>한 번에</legend>
          <div>
            <label htmlFor={`${fieldId}-quantity`}>수량</label>
            <select
              id={`${fieldId}-quantity`}
              name="doseQuantity"
              defaultValue=""
              required
            >
              <option value="" disabled>
                수량 선택
              </option>
              {medicationDoseQuantities.map((value) => (
                <option value={value} key={value}>
                  {value}
                </option>
              ))}
            </select>
            <label htmlFor={`${fieldId}-unit`}>단위</label>
            <select
              id={`${fieldId}-unit`}
              name="doseUnit"
              defaultValue=""
              required
            >
              <option value="" disabled>
                단위 선택
              </option>
              {medicationDoseUnits.map((value) => (
                <option value={value} key={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </fieldset>
        <label htmlFor={`${fieldId}-frequency`}>
          복용 주기
          <select
            id={`${fieldId}-frequency`}
            name="frequency"
            value={frequency}
            onChange={(event) => setFrequency(event.target.value)}
            required
          >
            <option value="" disabled>
              복용 주기 선택
            </option>
            {medicationFrequencyOptions.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {slotCount !== null && slotCount > 0 ? (
          Array.from({ length: slotCount }, (_, index) => (
            <label
              htmlFor={`${fieldId}-timing-${index}`}
              key={`${frequency}-${index}`}
            >
              {slotCount === 1 ? "복용 시점" : `${index + 1}회차 시점`}
              <select
                id={`${fieldId}-timing-${index}`}
                name="timing"
                defaultValue=""
                required
              >
                <option value="" disabled>
                  시점 선택
                </option>
                {medicationTimingOptions.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))
        ) : slotCount === 0 ? (
          <p className="medication-calendar-note">
            필요할 때 복용하는 약은 정해진 회차가 없어 캘린더 일정과 알림을
            만들지 않아요.
          </p>
        ) : (
          <p className="medication-search-add__help">
            복용 주기를 선택하면 필요한 회차만큼 시점 선택란이 나타나요.
          </p>
        )}
        <label>
          시작일
          <input name="startDate" type="date" required defaultValue={today} />
        </label>
        <label>
          종료일 <small>(선택)</small>
          <input name="endDate" type="date" />
        </label>
      </div>
      {slotCount !== null && slotCount > 0 ? (
        <p className="medication-calendar-note">
          추가하면 시작일부터 선택한 주기와 시각으로 캘린더에 반영돼요.
        </p>
      ) : null}
      <p className="medication-search-add__help">
        기입하신 정보를 다시 한번 확인해주세요.
      </p>
      <button
        className="button button--primary"
        type="submit"
        disabled={pending}
      >
        {pending ? "추가하는 중…" : "이 약 추가"}
      </button>
      <FormMessage state={state} />
    </form>
  );
}
