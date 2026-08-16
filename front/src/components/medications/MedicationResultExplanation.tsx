import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import type { PharmacogenomicInfo } from "@care-atlas/backend";

export function MedicationResultExplanation({
  item,
  resultId,
}: {
  item: PharmacogenomicInfo;
  resultId: string;
}) {
  const explanation = item.plainExplanation;
  const category = explanation?.categoryPlain || item.categoryPlain || "분류 확인 필요";

  return (
    <div className="official-drug-result__details">
      {explanation ? (
        <section className="plain-drug-explanation" aria-labelledby={`${resultId}-plain-title`}>
          <div className="plain-drug-explanation__heading">
            <Sparkles size={18} aria-hidden="true" />
            <h4 id={`${resultId}-plain-title`}>보호자가 이해하기 쉽게</h4>
            <Badge tone="success">대분류 · {category}</Badge>
            <Badge tone="info">GPT 쉬운 설명</Badge>
          </div>
          <div className="plain-drug-explanation__content">
            {explanation.overview ? (
              <div>
                <strong>어떤 정보인가요?</strong>
                <p>{explanation.overview}</p>
              </div>
            ) : null}
            {explanation.geneInfo ? (
              <div>
                <strong>유전자 정보는 무슨 뜻인가요?</strong>
                <p>{explanation.geneInfo}</p>
              </div>
            ) : null}
            {explanation.productInfo ? (
              <div>
                <strong>제품 정보는 무슨 뜻인가요?</strong>
                <p>{explanation.productInfo}</p>
              </div>
            ) : null}
          </div>
          {explanation.caregiverNote ? (
            <p className="plain-drug-explanation__note">{explanation.caregiverNote}</p>
          ) : null}
        </section>
      ) : null}

      {!explanation ? (
        <div className="official-drug-result__category">
          <span>약 대분류</span>
          <Badge tone={item.categoryPlain ? "success" : "neutral"}>{category}</Badge>
        </div>
      ) : null}

      <details className="official-drug-result__original" open={!explanation}>
        <summary>식약처 공식 원문 확인</summary>
        <div>
          {item.generalInfo ? (
            <section>
              <strong>일반 약물 정보</strong>
              <p>{item.generalInfo}</p>
            </section>
          ) : null}
          {item.pharmacogenomicInfo ? (
            <section>
              <strong>약물 유전 정보</strong>
              <p>{item.pharmacogenomicInfo}</p>
            </section>
          ) : null}
          {item.productInfo ? (
            <section>
              <strong>제품 정보</strong>
              <p>{item.productInfo}</p>
            </section>
          ) : null}
        </div>
      </details>
    </div>
  );
}
