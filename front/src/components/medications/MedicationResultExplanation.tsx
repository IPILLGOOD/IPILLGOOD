import { ShieldCheck, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import type {
  OfficialMedicationConsumerInfo,
  OfficialMedicationSearchItem,
} from "@care-atlas/backend";

function ConsumerInformation({ consumer }: { consumer: OfficialMedicationConsumerInfo }) {
  return (
    <div className="plain-drug-explanation__content">
      {consumer.efficacy ? (
        <div>
          <strong>어떤 효능이 있나요?</strong>
          <p>{consumer.efficacy}</p>
        </div>
      ) : null}
      {consumer.usage ? (
        <div>
          <strong>공식 허가 용법</strong>
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
  );
}

export function MedicationResultExplanation({
  item,
  resultId,
}: {
  item: OfficialMedicationSearchItem;
  resultId: string;
}) {
  const consumer = item.consumerInfo;
  const pharmacogenomic = item.pharmacogenomicInfo;
  const plain = item.plainExplanation;
  const isEasyDrug = consumer?.source === "easy_drug";
  const officialTitle = isEasyDrug ? "e약은요 소비자용 정보" : "전문의약품 공식 허가정보";
  const detailUrl = `https://nedrug.mfds.go.kr/pbp/CCBBB01/getItemDetail?itemSeq=${encodeURIComponent(item.itemSeq)}`;

  return (
    <div className="official-drug-result__details">
      <div className="official-drug-result__category">
        <span>공식 매칭</span>
        <Badge tone={item.matchType === "product_name" ? "success" : "info"}>
          {item.matchType === "product_name" ? "제품명" : "성분명"}
        </Badge>
        <Badge tone="neutral">{item.classification || "전문·일반 구분 확인 필요"}</Badge>
        {plain?.categoryPlain ? <Badge tone="info">{plain.categoryPlain}</Badge> : null}
        {item.productType ? <Badge tone="neutral">{item.productType}</Badge> : null}
      </div>

      {plain ? (
        <section className="plain-drug-explanation" aria-labelledby={`${resultId}-plain-title`}>
          <div className="plain-drug-explanation__heading">
            <Sparkles size={18} aria-hidden="true" />
            <h4 id={`${resultId}-plain-title`}>공식 원문을 쉽게 풀어쓴 설명</h4>
            <Badge tone="info">OpenAI 요약</Badge>
          </div>
          <div className="plain-drug-explanation__content">
            {plain.overview ? (
              <div>
                <strong>이 약은 무엇을 도와주나요?</strong>
                <p>{plain.overview}</p>
              </div>
            ) : null}
            {plain.usagePlain ? (
              <div>
                <strong>어떻게 사용하는 약인가요?</strong>
                <p>{plain.usagePlain}</p>
              </div>
            ) : null}
            {plain.safetyPlain ? (
              <div>
                <strong>무엇을 조심해야 하나요?</strong>
                <p>{plain.safetyPlain}</p>
              </div>
            ) : null}
            {plain.genePlain ? (
              <div>
                <strong>타고난 약물 반응 차이</strong>
                <p>{plain.genePlain}</p>
              </div>
            ) : null}
          </div>
          <p className="plain-drug-explanation__note">{plain.caregiverNote}</p>
        </section>
      ) : consumer ? (
        <section className="plain-drug-explanation" aria-labelledby={`${resultId}-official-title`}>
          <div className="plain-drug-explanation__heading">
            <ShieldCheck size={18} aria-hidden="true" />
            <h4 id={`${resultId}-official-title`}>{officialTitle}</h4>
            <Badge tone="success">식약처 공식 원문</Badge>
          </div>
          <ConsumerInformation consumer={consumer} />
          <p className="plain-drug-explanation__note">
            개인 처방의 복용량·횟수·시간은 처방전과 의료진의 안내를 우선하세요.
          </p>
        </section>
      ) : (
        <div className="official-drug-message">
          <strong>제품·성분 허가정보를 확인했어요.</strong>
          <p>
            쉬운 설명에 필요한 상세 원문을 불러오지 못했어요. {" "}
            <a href={detailUrl} rel="noreferrer" target="_blank">의약품안전나라 상세정보</a>에서 확인할 수 있어요.
          </p>
        </div>
      )}

      {plain && consumer ? (
        <details className="official-drug-result__original">
          <summary>{officialTitle} 원문 확인</summary>
          <ConsumerInformation consumer={consumer} />
        </details>
      ) : null}

      {consumer?.interactions || consumer?.adverseEffects || consumer?.storage ? (
        <details className="official-drug-result__original">
          <summary>상호작용·이상반응·보관법 확인</summary>
          <div>
            {consumer.interactions ? (
              <section><strong>함께 주의할 약이나 음식</strong><p>{consumer.interactions}</p></section>
            ) : null}
            {consumer.adverseEffects ? (
              <section><strong>나타날 수 있는 이상반응</strong><p>{consumer.adverseEffects}</p></section>
            ) : null}
            {consumer.storage ? (
              <section><strong>보관법</strong><p>{consumer.storage}</p></section>
            ) : null}
          </div>
        </details>
      ) : null}

      {pharmacogenomic ? (
        <details className="official-drug-result__original">
          <summary>해당 성분의 약물유전정보 확인</summary>
          <div>
            {pharmacogenomic.generalInfo ? (
              <section><strong>일반 약물 정보</strong><p>{pharmacogenomic.generalInfo}</p></section>
            ) : null}
            {pharmacogenomic.geneInfo ? (
              <section><strong>약물 유전 정보</strong><p>{pharmacogenomic.geneInfo}</p></section>
            ) : null}
          </div>
        </details>
      ) : null}

      <details className="official-drug-result__original">
        <summary>공식 데이터 출처 확인</summary>
        <ul className="official-drug-source-list">
          {item.sources.map((source) => (
            <li key={source.kind}>
              <a href={source.url} rel="noreferrer" target="_blank">{source.label}</a>
            </li>
          ))}
          <li><a href={detailUrl} rel="noreferrer" target="_blank">의약품안전나라 품목 상세</a></li>
        </ul>
      </details>
    </div>
  );
}
