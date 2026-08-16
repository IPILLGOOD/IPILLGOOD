import {
  BadgeCheck,
  BookOpenText,
  CircleHelp,
  ClipboardList,
  ExternalLink,
  SearchCheck,
  ShieldCheck,
  TriangleAlert,
  CalendarCheck2,
} from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import type { DocumentAnalysis } from "@care-atlas/backend";

export function DocumentAnalysisResult({ analysis }: { analysis: DocumentAnalysis }) {
  const analysisSource =
    analysis.source === "api"
      ? "외부 API 문서 분석"
      : analysis.source === "openai"
        ? "OpenAI 문서 분석"
        : "데모 분석 결과";

  return (
    <section className="analysis-result" aria-labelledby="analysis-result-title">
      <div className="analysis-result__header">
        <span className="analysis-result__icon" aria-hidden="true">
          <BadgeCheck size={22} />
        </span>
        <div>
          <Badge tone={analysis.source === "demo" ? "info" : "success"}>
            {analysisSource}
          </Badge>
          <h3 id="analysis-result-title">{analysis.documentType} 분석 결과</h3>
          <p>{analysis.summary}</p>
        </div>
      </div>

      <dl className="analysis-findings">
        {analysis.findings.map((finding) => (
          <div key={`${finding.label}-${finding.value}`}>
            <dt>{finding.label}</dt>
            <dd>{finding.value}</dd>
          </div>
        ))}
      </dl>

      {analysis.documentType === "처방전" && analysis.medications?.length ? (
        <div className="disease-lookup-status disease-lookup-status--official_match" role="status">
          <CalendarCheck2 size={18} aria-hidden="true" />
          <p>
            <strong>복약 일정에 반영됨</strong>
            처방전에서 확인한 약 {analysis.medications.length}개를 오늘 할 일과 복용약에 추가했어요.
          </p>
        </div>
      ) : null}

      <div className="analysis-columns">
        <div>
          <h4>
            <ClipboardList size={18} aria-hidden="true" /> 보호자가 살펴볼 점
          </h4>
          <ul>
            {analysis.carePoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4>
            <CircleHelp size={18} aria-hidden="true" /> 상담 때 물어볼 점
          </h4>
          <ul>
            {analysis.questionsForProfessional.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      </div>

      {analysis.documentType === "진단서" && analysis.diseaseLookup ? (
        <div
          className={`disease-lookup-status disease-lookup-status--${analysis.diseaseLookup.status}`}
          role="status"
        >
          <SearchCheck size={18} aria-hidden="true" />
          <p>
            <strong>질병 정보 조회</strong>
            {analysis.diseaseLookup.message}
          </p>
        </div>
      ) : null}

      {analysis.diseaseInformation && analysis.diseaseInformation.length > 0 ? (
        <section className="disease-information" aria-labelledby="disease-information-title">
          <div className="disease-information__heading">
            <BookOpenText size={20} aria-hidden="true" />
            <div>
              <h4 id="disease-information-title">진단 관련 정보</h4>
              <p>진단서에서 찾은 질병명으로 조회한 참고 정보예요.</p>
            </div>
          </div>

          <div className="disease-information__list">
            {analysis.diseaseInformation.map((disease) => (
              <article
                className="disease-information__item"
                key={`${disease.query}-${disease.code ?? disease.matchedName}`}
              >
                <header>
                  <div>
                    <span className="disease-information__query">입력: {disease.query}</span>
                    <h5>
                      {disease.matchedName}
                      {disease.code ? <small>{disease.code}</small> : null}
                    </h5>
                  </div>
                  <Badge tone={disease.source === "official_api" ? "success" : "info"}>
                    {disease.sourceLabel}
                  </Badge>
                </header>

                <p className="disease-information__overview">{disease.overview}</p>

                {disease.practicalPoints.length > 0 ? (
                  <div className="disease-information__points">
                    <strong>확인할 점</strong>
                    <ul>
                      {disease.practicalPoints.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {disease.warningSigns.length > 0 ? (
                  <div className="disease-information__warning">
                    <TriangleAlert size={17} aria-hidden="true" />
                    <div>
                      <strong>빠른 상담이 필요한 신호</strong>
                      <ul>
                        {disease.warningSigns.map((sign) => (
                          <li key={sign}>{sign}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : null}

                {disease.references.length > 0 ? (
                  <div className="disease-information__references">
                    <strong>조회 출처</strong>
                    <ul>
                      {disease.references.map((reference) => (
                        <li key={reference.url}>
                          <a href={reference.url} target="_blank" rel="noreferrer noopener">
                            {reference.title}
                            <ExternalLink size={13} aria-hidden="true" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <p className="analysis-disclaimer">
        <ShieldCheck size={17} aria-hidden="true" />
        {analysis.disclaimer}
      </p>
    </section>
  );
}
