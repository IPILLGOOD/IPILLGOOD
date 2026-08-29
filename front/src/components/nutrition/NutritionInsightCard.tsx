import { Apple, Check, Droplets, ExternalLink, Salad, Soup } from "lucide-react";

import type { NutritionInsight } from "@care-atlas/backend";

export function NutritionInsightCard({
  insight,
  index,
}: {
  insight: NutritionInsight;
  index: number;
}) {
  const normalizedTitle = insight.title.replace(/\s/g, "");
  const TopicIcon = /나트륨|싱거운|국물|찌개/.test(normalizedTitle)
    ? Soup
    : /수분|물/.test(normalizedTitle)
      ? Droplets
      : /과일|칼륨/.test(normalizedTitle)
        ? Apple
        : Salad;
  const displayIndex = String(index + 1).padStart(2, "0");

  return (
    <article role="listitem" className={`nutrition-insight-panel nutrition-insight-panel--tone-${index % 3}`}>
      <div className="nutrition-insight-panel__visual" aria-hidden="true">
        <span className="nutrition-insight-panel__index">{displayIndex}</span>
        <span className="nutrition-insight-panel__halo" />
        <TopicIcon className="nutrition-insight-panel__topic-icon" size={68} strokeWidth={1.45} />
      </div>

      <div className="nutrition-insight-panel__content">
        <header className="nutrition-insight-card__header">
          <div>
            <p className="nutrition-insight-card__kicker">영양 주제 {displayIndex}</p>
            <h3>{insight.title}</h3>
          </div>
        </header>
        <p className="nutrition-insight-card__summary">{insight.summary}</p>

        {insight.foodExamples.length > 0 ? (
          <div className="nutrition-insight-card__examples">
            <strong>오늘부터 이렇게</strong>
            <ul>
              {insight.foodExamples.map((example) => (
                <li key={example}><Check size={15} aria-hidden="true" /><span>{example}</span></li>
              ))}
            </ul>
          </div>
        ) : null}

        <details className="nutrition-evidence">
          <summary>출처 보기</summary>
          <ul>
            {insight.evidence.map((evidence) => (
              <li key={evidence.url}>
                <a href={evidence.url} target="_blank" rel="noreferrer noopener">
                  {evidence.title}
                  <ExternalLink size={13} aria-hidden="true" />
                </a>
                <small>
                  {evidence.sourceVersion} ·{" "}
                  {evidence.evidenceLevel === "official_guideline"
                    ? "공식 지침"
                    : evidence.evidenceLevel === "official_safety"
                      ? "공식 안전정보"
                      : "AI가 검색한 공식 웹 출처"}{" "}
                  · 검토 {evidence.lastReviewedAt}
                </small>
                <small>{evidence.reviewer}</small>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </article>
  );
}
