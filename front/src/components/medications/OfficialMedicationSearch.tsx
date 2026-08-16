import { Database, Search, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { MedicationResultExplanation } from "@/components/medications/MedicationResultExplanation";
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
              <Badge tone="success">공공 API + GPT 설명</Badge>
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
            식약처 공식 결과만 서버에서 GPT에 전달하며, 어르신의 개인정보는 보내지 않아요.
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

      {result?.status === "connected" &&
      result.items.length > 0 &&
      result.plainLanguageStatus === "not_configured" ? (
        <div className="official-drug-message official-drug-message--warning" role="status">
          <strong>쉬운 설명 연결 설정이 필요해요.</strong>
          <p>OpenAI API 키가 없어 식약처 공식 원문을 그대로 보여드려요.</p>
        </div>
      ) : null}

      {result?.status === "connected" &&
      result.items.length > 0 &&
      result.plainLanguageStatus === "unavailable" ? (
        <div className="official-drug-message official-drug-message--warning" role="status">
          <strong>쉬운 설명을 잠시 만들지 못했어요.</strong>
          <p>식약처 공식 원문은 정상적으로 불러왔어요. 잠시 후 다시 검색해주세요.</p>
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
                <MedicationResultExplanation
                  item={item}
                  resultId={`official-drug-${index}`}
                />
              </li>
            ))}
          </ul>
          <p className="official-drug-results__notice">
            식품의약품안전처 원문을 GPT가 쉬운 말로 정리한 설명이에요. 진단이나 복용 변경을
            대신하지 않으며, 원문도 함께 확인할 수 있어요.
          </p>
        </div>
      ) : null}
    </Card>
  );
}
