import { Search } from "lucide-react";

import { addMedicationAction } from "@/app/actions";
import { Card } from "@/components/ui/Card";
import type { OfficialMedicationLookupResult } from "@care-atlas/backend";

export function MedicationSearchAdd({ query, result, revision, today }: {
  query: string;
  result: OfficialMedicationLookupResult | null;
  revision: number;
  today: string;
}) {
  return (
    <Card className="medication-search-add" aria-labelledby="medication-search-add-title">
      <div className="section-heading">
        <div><h2 id="medication-search-add-title">약 검색해서 추가</h2><p>제품명을 검색한 뒤 실제 처방받은 복용법을 입력하세요.</p></div>
      </div>
      <form className="official-drug-search" role="search" method="get">
        <div className="official-drug-search__controls">
          <input name="q" type="search" defaultValue={query} required maxLength={100} placeholder="예: 노바스크정 5mg" />
          <button className="button button--primary" type="submit"><Search size={18} aria-hidden="true" /> 검색</button>
        </div>
      </form>
      {query && result?.status !== "connected" ? <p className="analysis-status analysis-status--error">{result?.message ?? "약을 검색하지 못했어요."}</p> : null}
      {result?.status === "connected" && result.items.length === 0 ? <p className="analysis-status">검색 결과가 없어요. 약봉투의 정확한 제품명을 확인해주세요.</p> : null}
      {result?.status === "connected" && result.items.length > 0 ? (
        <div className="medication-search-add__results">
          {result.items.map((item) => (
            <form className="medication-search-add__item" action={addMedicationAction} key={item.itemSeq}>
              <input type="hidden" name="expectedRevision" value={revision} />
              <input type="hidden" name="itemSeq" value={item.itemSeq} />
              <input type="hidden" name="productName" value={item.productName} />
              <input type="hidden" name="ingredientName" value={item.ingredientName} />
              <input type="hidden" name="categoryPlain" value={item.classification} />
              <header><strong>{item.productName}</strong><span>{item.ingredientName || "성분 확인 필요"} · {item.manufacturer}</span></header>
              <div className="medication-search-add__fields">
                <label>한 번에<input name="doseAmount" required placeholder="예: 1정" /></label>
                <label>하루 횟수<input name="frequency" required placeholder="예: 하루 2회" /></label>
                <label>먹는 시점<input name="timing" required placeholder="예: 아침·저녁 식후" /></label>
                <label>시작일<input name="startDate" type="date" required defaultValue={today} /></label>
                <label>종료일 <small>(선택)</small><input name="endDate" type="date" min={today} /></label>
              </div>
              <button className="button button--primary" type="submit">이 약 추가</button>
            </form>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
