"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";

import { NotFoundAnimation } from "@/components/not-found/NotFoundAnimation";

type PendingAction = "search" | "clear" | null;

export function MedicationSearchForm({ query, children }: { query: string; children: ReactNode }) {
  const router = useRouter();
  const [value, setValue] = useState(query);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [preparingSearch, setPreparingSearch] = useState(false);
  const [routePending, startTransition] = useTransition();
  const navigationFrame = useRef<number | null>(null);
  const isSearching = pendingAction === "search" && (preparingSearch || routePending);
  const isClearing = pendingAction === "clear" && routePending;
  const isBusy = preparingSearch || routePending;

  useEffect(
    () => () => {
      if (navigationFrame.current !== null) cancelAnimationFrame(navigationFrame.current);
    },
    [],
  );

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.currentTarget.value;
    setValue(nextValue);

    if (!nextValue && query) {
      setPendingAction("clear");
      startTransition(() => {
        router.replace("/medications", { scroll: false });
      });
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const nextQuery = value.trim().slice(0, 100);
    if (!nextQuery) return;

    const params = new URLSearchParams({ q: nextQuery });
    setPendingAction("search");
    setPreparingSearch(true);
    if (navigationFrame.current !== null) cancelAnimationFrame(navigationFrame.current);
    navigationFrame.current = requestAnimationFrame(() => {
      navigationFrame.current = null;
      setPreparingSearch(false);
      startTransition(() => {
        if (nextQuery === query) router.refresh();
        else router.push(`/medications?${params.toString()}`, { scroll: false });
      });
    });
  };

  return (
    <>
      <form
        className="official-drug-search"
        role="search"
        method="get"
        aria-busy={isBusy}
        onSubmit={handleSubmit}
      >
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
            <button className="button button--primary" type="submit" disabled={isBusy}>
              <Search size={18} aria-hidden="true" />
              {isSearching ? "약 정보 찾는 중…" : "약 정보 검색"}
            </button>
          </div>
          <p className="field-hint">
            일반의약품은 e약은요, 전문의약품은 상세 허가정보를 확인하고 공식 원문이 있으면 쉬운 설명을 함께 보여드려요. 어르신의 개인정보는 보내지 않아요.
          </p>
          {isClearing ? <span className="sr-only" role="status">검색 결과를 지우고 있어요.</span> : null}
        </div>
      </form>

      {isSearching ? (
        <div className="official-drug-loading" role="status" aria-live="polite">
          <NotFoundAnimation />
          <div>
            <strong>약 정보를 찾고 있어요</strong>
            <p>식약처 허가정보와 쉬운 설명을 차례로 확인하고 있어요. 잠시만 기다려주세요.</p>
          </div>
        </div>
      ) : children}
    </>
  );
}
