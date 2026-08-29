"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ChangeEvent } from "react";

export function MedicationSearchForm({ query }: { query: string }) {
  const router = useRouter();
  const [value, setValue] = useState(query);
  const [isClearing, startTransition] = useTransition();

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.currentTarget.value;
    setValue(nextValue);

    if (!nextValue && query) {
      startTransition(() => {
        router.replace("/medications", { scroll: false });
      });
    }
  };

  return (
    <form className="official-drug-search" role="search" method="get" aria-busy={isClearing}>
      <div className="field">
        <label htmlFor="official-drug-query">
          약물명 <span aria-hidden="true">*</span>
        </label>
        <div className="official-drug-search__controls">
          <input
            id="official-drug-query"
            name="q"
            type="search"
            maxLength={100}
            minLength={1}
            pattern=".*\S.*"
            required
            value={value}
            onChange={handleChange}
            placeholder="예: 노바스크 또는 암로디핀"
            autoComplete="off"
          />
          <button className="button button--primary" type="submit" disabled={isClearing}>
            <Search size={18} aria-hidden="true" />
            약 정보 검색
          </button>
        </div>
        <p className="field-hint">
          일반의약품은 e약은요, 전문의약품은 상세 허가정보를 확인하고 공식 원문이 있으면 쉬운 설명을 함께 보여드려요. 어르신의 개인정보는 보내지 않아요.
        </p>
        {isClearing ? <span className="sr-only" role="status">검색 결과를 지우고 있어요.</span> : null}
      </div>
    </form>
  );
}
