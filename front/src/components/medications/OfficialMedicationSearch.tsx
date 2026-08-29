import { Database, Search, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { MedicationResultExplanation } from "@/components/medications/MedicationResultExplanation";
import type { OfficialMedicationLookupResult } from "@care-atlas/backend";

export function OfficialMedicationSearch({
  query,
  result,
  officialApiConfigured,
}: {
  query: string;
  result: OfficialMedicationLookupResult | null;
  officialApiConfigured: boolean;
}) {
  const badge = !result
    ? officialApiConfigured
      ? { tone: "neutral" as const, label: "공식 검색 설정됨" }
      : { tone: "warning" as const, label: "공식 검색 미설정" }
    : result.status === "connected"
      ? result.productQueryStatus === "complete"
        ? { tone: "success" as const, label: "식약처 공식 조회 완료" }
        : { tone: "warning" as const, label: "공식 조회 일부 완료" }
      : result.status === "not_configured"
        ? { tone: "warning" as const, label: "공식 검색 미설정" }
        : result.reason === "rate_limited"
          ? { tone: "warning" as const, label: "잠시 후 재검색" }
          : { tone: "warning" as const, label: "공식 조회 실패" };

  return (
    <Card className="official-drug-card" aria-labelledby="official-drug-title">
      <div className="official-drug-card__header">
        <div className="official-drug-card__title">
          <span className="official-drug-card__icon" aria-hidden="true">
            <Database size={21} />
          </span>
          <div>
            <div className="medication-row__name">
              <h2 id="official-drug-title">약 정보 검색</h2>
              <Badge tone={badge.tone}>{badge.label}</Badge>
            </div>
            <p>제품명이나 성분명으로 식약처 허가정보와 소비자용 복약정보를 확인하세요.</p>
          </div>
        </div>
      </div>

      <form className="official-drug-search" role="search" method="get">
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
              defaultValue={query}
              placeholder="예: 노바스크 또는 암로디핀"
              autoComplete="off"
            />
            <button className="button button--primary" type="submit">
              <Search size={18} aria-hidden="true" />
              약 정보 검색
            </button>
          </div>
          <p className="field-hint">
            제품 허가정보를 기준으로 찾고 e약은요와 약물유전정보가 있으면 함께 보여드려요. 어르신의 개인정보는 보내지 않아요.
          </p>
        </div>
      </form>

      {!query ? (
        <div className="official-drug-card__guide">
          <ShieldCheck size={18} aria-hidden="true" />
          <p>
            {officialApiConfigured
              ? "API 키가 설정되어 있어요. 실제 연결 여부는 검색 후 결과 상태로 확인하며, 검색만으로 현재 복용약이나 일정이 바뀌지 않아요."
              : "공식 검색이 설정되지 않은 상태예요. 예시 데이터나 웹 검색 결과로 조용히 대체하지 않아요."}
          </p>
        </div>
      ) : null}

      {query && result?.status === "not_configured" ? (
        <div className="official-drug-message official-drug-message--warning" role="status">
          <strong>공식 약 검색이 아직 설정되지 않았어요.</strong>
          <p>{result.message} 검색어를 예시 정보나 웹 결과로 대체하지 않았어요.</p>
        </div>
      ) : null}

      {query && result?.status === "unavailable" ? (
        <div className="official-drug-message official-drug-message--error" role="alert">
          <strong>
            {result.reason === "rate_limited"
              ? "검색 요청이 잠시 제한됐어요."
              : "식약처 공식 조회에 실패했어요."}
          </strong>
          <p>{result.message}</p>
        </div>
      ) : null}

      {result?.status === "connected" && result.productQueryStatus === "partial" ? (
        <div className="official-drug-message official-drug-message--warning" role="status">
          <strong>공식 검색 일부만 완료됐어요.</strong>
          <p>제품명 또는 성분명 조회 중 하나가 일시적으로 실패했어요. 표시된 결과는 식약처에서 확인된 항목이에요.</p>
        </div>
      ) : null}

      {result?.status === "connected" &&
      result.items.length > 0 &&
      result.easyDrugStatus === "unavailable" ? (
        <div className="official-drug-message official-drug-message--warning" role="status">
          <strong>e약은요 정보를 잠시 불러오지 못했어요.</strong>
          <p>제품·성분 허가정보는 정상적으로 확인했으며, 소비자용 설명만 일부 없을 수 있어요.</p>
        </div>
      ) : null}

      {result?.status === "connected" &&
      result.items.length > 0 &&
      result.pharmacogenomicStatus === "unavailable" ? (
        <div className="official-drug-message official-drug-message--warning" role="status">
          <strong>약물유전정보를 잠시 불러오지 못했어요.</strong>
          <p>제품·성분 허가정보는 정상적으로 확인했으며, 선택 보강 정보만 일부 없을 수 있어요.</p>
        </div>
      ) : null}

      {query && result?.status === "connected" && result.items.length === 0 ? (
        <div className="official-drug-message" role="status">
          <strong>식약처에서 “{query}”와 일치하는 제품이나 성분을 찾지 못했어요.</strong>
          <p>제품 포장이나 처방전에 적힌 제품명·성분명을 확인해 다시 검색해보세요.</p>
        </div>
      ) : null}

      {result?.status === "connected" && result.items.length > 0 ? (
        <div className="official-drug-results" aria-live="polite">
          <p className="official-drug-results__count">
            “{query}” 검색 결과 {result.totalCount.toLocaleString("ko-KR")}건
          </p>
          <ul>
            {result.items.map((item, index) => (
              <li key={item.itemSeq}>
                <div className="official-drug-result__name">
                  <h3>{item.productName}</h3>
                  {item.englishName ? <p>{item.englishName}</p> : null}
                  <dl className="official-drug-result__meta">
                    <div>
                      <dt>성분</dt>
                      <dd>{item.ingredientName || "성분 정보 확인 필요"}</dd>
                    </div>
                    <div>
                      <dt>업체</dt>
                      <dd>{item.manufacturer || "업체 정보 확인 필요"}</dd>
                    </div>
                    <div>
                      <dt>품목기준코드</dt>
                      <dd>{item.itemSeq}</dd>
                    </div>
                  </dl>
                </div>
                <MedicationResultExplanation
                  item={item}
                  resultId={`official-drug-${index}`}
                />
              </li>
            ))}
          </ul>
          <p className="official-drug-results__notice">
            식약처 공식 데이터의 일반 정보이며 개인의 처방 목적이나 복용 지시가 아니에요. 처방전의 복용량·횟수·시간을 우선 확인하세요.
          </p>
        </div>
      ) : null}
    </Card>
  );
}
