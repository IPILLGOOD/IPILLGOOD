import { Database, Search, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { PharmacogenomicLookupResult } from "@care-atlas/backend";

export function OfficialMedicationSearch({
  query,
  result,
}: {
  query: string;
  result: PharmacogenomicLookupResult | null;
}) {
  return (
    <Card className="official-drug-card" aria-labelledby="official-drug-title">
      <div className="official-drug-card__header">
        <div className="official-drug-card__title">
          <span className="official-drug-card__icon" aria-hidden="true">
            <Database size={21} />
          </span>
          <div>
            <div className="medication-row__name">
              <h2 id="official-drug-title">식약처 공식 약물 유전 정보</h2>
              <Badge tone="success">공공 API 연동</Badge>
            </div>
            <p>약물의 한글명 또는 영문명으로 공식 등록 정보를 확인하세요.</p>
          </div>
        </div>
      </div>

      <form className="official-drug-search" role="search" method="get">
        <div className="field">
          <label htmlFor="official-drug-query">약물명</label>
          <div className="official-drug-search__controls">
            <input
              id="official-drug-query"
              name="q"
              type="search"
              maxLength={100}
              defaultValue={query}
              placeholder="예: 와파린 또는 Warfarin"
              autoComplete="off"
            />
            <button className="button button--primary" type="submit">
              <Search size={18} aria-hidden="true" />
              공식 정보 검색
            </button>
          </div>
          <p className="field-hint">
            검색어와 API 인증키는 서버에서만 식품의약품안전처 API로 전달됩니다.
          </p>
        </div>
      </form>

      {!query ? (
        <div className="official-drug-card__guide">
          <ShieldCheck size={18} aria-hidden="true" />
          <p>현재 복용약과 별도로 조회되며, 검색 결과가 처방이나 복용법을 바꾸지는 않아요.</p>
        </div>
      ) : null}

      {query && result?.status === "not_configured" ? (
        <div className="official-drug-message official-drug-message--warning" role="status">
          <strong>API 연결 설정이 필요해요.</strong>
          <p>{result.message} 서버 환경변수 설정을 확인해주세요.</p>
        </div>
      ) : null}

      {query && result?.status === "unavailable" ? (
        <div className="official-drug-message official-drug-message--error" role="alert">
          <strong>공식 정보를 불러오지 못했어요.</strong>
          <p>{result.message}</p>
        </div>
      ) : null}

      {query && result?.status === "connected" && result.items.length === 0 ? (
        <div className="official-drug-message" role="status">
          <strong>“{query}” 검색 결과가 없어요.</strong>
          <p>제품명이 아닌 성분명이나 영문 약물명으로 다시 검색해보세요.</p>
        </div>
      ) : null}

      {result?.status === "connected" && result.items.length > 0 ? (
        <div className="official-drug-results" aria-live="polite">
          <p className="official-drug-results__count">
            “{query}” 검색 결과 {result.totalCount.toLocaleString("ko-KR")}건
          </p>
          <ul>
            {result.items.map((item, index) => (
              <li key={`${item.koreanName}-${item.englishName}-${index}`}>
                <div className="official-drug-result__name">
                  <h3>{item.koreanName || item.englishName}</h3>
                  {item.koreanName && item.englishName ? <p>{item.englishName}</p> : null}
                </div>
                <div className="official-drug-result__details">
                  {item.generalInfo ? (
                    <details>
                      <summary>일반 약물 정보</summary>
                      <p>{item.generalInfo}</p>
                    </details>
                  ) : null}
                  {item.pharmacogenomicInfo ? (
                    <details>
                      <summary>약물 유전 정보</summary>
                      <p>{item.pharmacogenomicInfo}</p>
                    </details>
                  ) : null}
                  {item.productInfo ? (
                    <details>
                      <summary>제품 정보</summary>
                      <p>{item.productInfo}</p>
                    </details>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <p className="official-drug-results__notice">
            식품의약품안전처 제공 정보이며, 개인의 유전자 검사 결과나 진료 판단을 대신하지
            않아요.
          </p>
        </div>
      ) : null}
    </Card>
  );
}
