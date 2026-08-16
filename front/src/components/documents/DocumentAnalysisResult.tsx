import { BadgeCheck, CircleHelp, ClipboardList, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import type { DocumentAnalysis } from "@care-atlas/backend";

export function DocumentAnalysisResult({ analysis }: { analysis: DocumentAnalysis }) {
  return (
    <section className="analysis-result" aria-labelledby="analysis-result-title">
      <div className="analysis-result__header">
        <span className="analysis-result__icon" aria-hidden="true">
          <BadgeCheck size={22} />
        </span>
        <div>
          <Badge tone={analysis.source === "api" ? "success" : "info"}>
            {analysis.source === "api" ? "API 분석 완료" : "데모 분석 결과"}
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

      <p className="analysis-disclaimer">
        <ShieldCheck size={17} aria-hidden="true" />
        {analysis.disclaimer}
      </p>
    </section>
  );
}
