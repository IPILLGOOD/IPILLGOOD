"use client";

import { useState } from "react";
import type { ActionState, OfficialMedicationLookupResult } from "@care-atlas/backend";
import { MedicationSearchAdd } from "@/components/medications/MedicationSearchAdd";

export function PreviewMedicationSearch({ today, revision, onAdd }: {
  today: string; revision: number; onAdd: (state: ActionState, data: FormData) => Promise<ActionState>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const result: OfficialMedicationLookupResult | null = query ? {
    status: "connected", totalCount: 1, sourceUrl: "", productQueryStatus: "complete", easyDrugStatus: "no_match", consumerInformationStatus: "no_match", pharmacogenomicStatus: "no_match", plainLanguageStatus: "no_source",
    items: [{ itemSeq: "999999999", productName: "샘플 검색약", englishName: "", ingredientName: "샘플 성분", manufacturer: "UI 미리보기 가상 자료", classification: "샘플", productType: "샘플", matchType: "product_name", sources: [] }],
  } : null;
  return <>
    <button className="button button--primary" type="button" onClick={() => setOpen(!open)} aria-expanded={open}>약 검색해서 추가</button>
    {open ? <><p>가상 약 이름으로 검색·추가 화면을 확인해보세요. 실제 식약처 검색은 실행하지 않아요.</p><MedicationSearchAdd query={query} result={result} today={today} revision={revision} onSearch={setQuery} onAdd={onAdd} /></> : null}
  </>;
}
