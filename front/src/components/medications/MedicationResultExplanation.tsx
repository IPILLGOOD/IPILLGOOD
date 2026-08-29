import { ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import type { OfficialMedicationSearchItem } from "@care-atlas/backend";

export function MedicationResultExplanation({
  item,
  resultId,
}: {
  item: OfficialMedicationSearchItem;
  resultId: string;
}) {
  const consumer = item.consumerInfo;
  const pharmacogenomic = item.pharmacogenomicInfo;

  return (
    <div className="official-drug-result__details">
      <div className="official-drug-result__category">
        <span>공식 매칭</span>
        <Badge tone={item.matchType === "product_name" ? "success" : "info"}>
          {item.matchType === "product_name" ? "제품명" : "성분명"}
        </Badge>
        <Badge tone="neutral">{item.classification || "전문·일반 구분 확인 필요"}</Badge>
        {item.productType ? <Badge tone="neutral">{item.productType}</Badge> : null}
      </div>

      {consumer ? (
        <section className="plain-drug-explanation" aria-labelledby={`${resultId}-plain-title`}>
          <div className="plain-drug-explanation__heading">
            <ShieldCheck size={18} aria-hidden="true" />
            <h4 id={`${resultId}-plain-title`}>e약은요 소비자용 정보</h4>
            <Badge tone="success">식약처 공식 원문</Badge>
          </div>
          <div className="plain-drug-explanation__content">
            {consumer.efficacy ? (
              <div>
                <strong>어떤 효능이 있나요?</strong>
                <p>{consumer.efficacy}</p>
              </div>
            ) : null}
            {consumer.usage ? (
              <div>
                <strong>일반적인 사용법</strong>
                <p>{consumer.usage}</p>
              </div>
            ) : null}
            {consumer.warning || consumer.precautions ? (
              <div>
                <strong>사용 전 확인할 점</strong>
                {consumer.warning ? <p>{consumer.warning}</p> : null}
                {consumer.precautions ? <p>{consumer.precautions}</p> : null}
              </div>
            ) : null}
          </div>
          <p className="plain-drug-explanation__note">
            이 사용법은 일반 허가정보이며, 개인 처방의 복용량·횟수·시간을 바꾸지 않아요.
          </p>
        </section>
      ) : (
        <div className="official-drug-message">
          <strong>제품·성분 허가정보를 확인했어요.</strong>
          <p>이 제품은 e약은요 소비자용 정보 대상이 아니거나, 검색어와 일치하는 설명이 없어요.</p>
        </div>
      )}

      {consumer?.interactions || consumer?.adverseEffects || consumer?.storage ? (
        <details className="official-drug-result__original">
          <summary>상호작용·이상반응·보관법 확인</summary>
          <div>
            {consumer.interactions ? (
              <section>
                <strong>함께 주의할 약이나 음식</strong>
                <p>{consumer.interactions}</p>
              </section>
            ) : null}
            {consumer.adverseEffects ? (
              <section>
                <strong>나타날 수 있는 이상반응</strong>
                <p>{consumer.adverseEffects}</p>
              </section>
            ) : null}
            {consumer.storage ? (
              <section>
                <strong>보관법</strong>
                <p>{consumer.storage}</p>
              </section>
            ) : null}
          </div>
        </details>
      ) : null}

      {pharmacogenomic ? (
        <details className="official-drug-result__original">
          <summary>해당 성분의 약물유전정보 확인</summary>
          <div>
            {pharmacogenomic.generalInfo ? (
              <section>
                <strong>일반 약물 정보</strong>
                <p>{pharmacogenomic.generalInfo}</p>
              </section>
            ) : null}
            {pharmacogenomic.geneInfo ? (
              <section>
                <strong>약물 유전 정보</strong>
                <p>{pharmacogenomic.geneInfo}</p>
              </section>
            ) : null}
          </div>
        </details>
      ) : null}

      <details className="official-drug-result__original">
        <summary>공식 데이터 출처 확인</summary>
        <ul className="official-drug-source-list">
          {item.sources.map((source) => (
            <li key={source.kind}>
              <a href={source.url} rel="noreferrer" target="_blank">
                {source.label}
              </a>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
