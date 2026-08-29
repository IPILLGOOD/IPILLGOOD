import {
  BookOpenCheck,
  CircleAlert,
  HeartPulse,
  Leaf,
  Pill,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { unstable_cache } from "next/cache";

import { NutritionInsightCard } from "@/components/nutrition/NutritionInsightCard";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { requireCareScope } from "@/lib/auth/care-scope";
import {
  buildNutritionInsights,
  getCareSnapshot,
  searchNutritionWithOpenAI,
} from "@care-atlas/backend";

export const dynamic = "force-dynamic";

const cachedAiNutrition = unstable_cache(
  searchNutritionWithOpenAI,
  ["nutrition-ai-official-sources-v1"],
  { revalidate: 60 * 60 * 24 * 30 },
);

export default async function NutritionPage() {
  const scope = await requireCareScope();
  const snapshot = await getCareSnapshot(scope);
  const curatedInsights = buildNutritionInsights(snapshot);
  const conditions = snapshot.recipient.confirmedConditions ?? [];
  const activeMedications = snapshot.medications.filter(
    (item) => item.status === "active",
  );
  const medicationIngredients = [
    ...new Set(
      activeMedications.map((item) => item.ingredientName).filter(Boolean),
    ),
  ].sort();
  const missingConditions = conditions.filter(
    (condition) =>
      !curatedInsights.some((insight) =>
        insight.triggerConditions.some(
          (trigger) => trigger.id === condition.id,
        ),
      ),
  );
  const aiResults = process.env.OPENAI_API_KEY
    ? await Promise.all(
        missingConditions.map(async (condition) => {
          try {
            return await cachedAiNutrition(condition, medicationIngredients);
          } catch (error) {
            console.error("nutrition AI fallback failed", error);
            return [];
          }
        }),
      )
    : [];
  const insights = [...curatedInsights, ...aiResults.flat()].filter(
    (insight) => insight.kind === "food",
  );

  return (
    <div className="nutrition-experience">
      <header className="nutrition-hero">
        <div className="nutrition-hero__copy">
          <p className="eyebrow">식사·영양 가이드</p>
          <h1>{snapshot.recipient.displayName}에게 필요한<br />영양 주제를 모았어요</h1>
          <p>확정된 질환과 현재 복용약을 함께 살펴보고, 식사에서 바로 적용할 수 있는 내용만 간결하게 정리했어요.</p>
          <div className="nutrition-hero__metrics" aria-label="반영된 건강 정보">
            <span><HeartPulse size={16} aria-hidden="true" /><strong>{conditions.length}</strong>개 질환</span>
            <span><Pill size={16} aria-hidden="true" /><strong>{activeMedications.length}</strong>개 복용약 반영</span>
          </div>
        </div>
        <div className="nutrition-hero__art" aria-hidden="true">
          <span className="nutrition-hero__orb nutrition-hero__orb--one"><Leaf size={28} /></span>
          <span className="nutrition-hero__orb nutrition-hero__orb--two"><Sparkles size={24} /></span>
          <span className="nutrition-hero__plate"><Leaf size={72} strokeWidth={1.35} /></span>
        </div>
      </header>

      <div className="nutrition-context-strip" aria-label="현재 정보 요약">
        <div>
          <BookOpenCheck size={20} aria-hidden="true" />
          <span>
            <strong>확정 질환</strong>
            {conditions.length ? (
              conditions.map((condition) => (
                <Badge key={condition.id} tone="success">
                  {condition.standardName} · {condition.code}
                </Badge>
              ))
            ) : (
              <small>아직 없음</small>
            )}
          </span>
        </div>
        <div>
          <Pill size={20} aria-hidden="true" />
          <span>
            <strong>현재 복용약</strong>
            <small>
              {activeMedications.length
                ? `${activeMedications.length}개 안전 필터에 반영`
                : "등록된 약 없음"}
            </small>
          </span>
        </div>
        <Link href="/profile" className="nutrition-context-strip__link">정보 업데이트</Link>
      </div>

      {conditions.length === 0 ? (
        <Card className="nutrition-onboarding">
          <CircleAlert size={28} aria-hidden="true" />
          <h2>먼저 의료진에게 확인받은 질환을 확정해주세요</h2>
          <p>
            자유 메모만으로는 내용을 만들지 않아요. 프로필에서 직접 선택하거나
            진단서 분석 결과를 원본과 비교해 확정할 수 있어요.
          </p>
          <div>
            <Link className="button button--primary" href="/profile">
              프로필에서 확정
            </Link>
            <Link className="button button--secondary" href="/documents">
              진단서 확인
            </Link>
          </div>
        </Card>
      ) : (
        <div className="nutrition-page-main">
          <div className="nutrition-disease-groups">
            {conditions.map((condition, conditionIndex) => {
              const conditionInsights = insights.filter((insight) =>
                insight.triggerConditions.some(
                  (trigger) => trigger.id === condition.id,
                ),
              );
              return (
                <section
                  key={condition.id}
                  aria-labelledby={`nutrition-${condition.id}`}
                >
                  <div className="nutrition-section-heading">
                    <div className="nutrition-section-heading__title">
                      <span>{String(conditionIndex + 1).padStart(2, "0")}</span>
                      <h2 id={`nutrition-${condition.id}`}>
                        {condition.standardName}
                      </h2>
                      <small>{condition.code}</small>
                    </div>
                    <p>{conditionInsights.length > 1 ? `${conditionInsights.length}가지 주제 · 옆으로 넘겨보세요.` : conditionInsights.length === 1 ? "1가지 영양 주제를 확인해보세요." : "확인된 영양 주제가 아직 없어요."}</p>
                  </div>
                  <div
                    className="nutrition-insight-list"
                    role="list"
                    tabIndex={conditionInsights.length > 1 ? 0 : undefined}
                    aria-label={`${condition.standardName} 영양 주제${conditionInsights.length > 1 ? " · 가로로 스크롤할 수 있습니다" : ""}`}
                  >
                    {conditionInsights.map((insight, index) => (
                      <NutritionInsightCard
                        key={insight.id}
                        insight={insight}
                        index={index}
                      />
                    ))}
                  </div>
                  {conditionInsights.length === 0 ? (
                    <Card className="nutrition-empty-state">
                      <p>
                        공식 출처에서 확인 가능한 영양 정보를 찾지 못했어요.
                        근거가 없는 내용은 표시하지 않아요.
                      </p>
                    </Card>
                  ) : null}
                </section>
              );
            })}
          </div>
        </div>
      )}
      <footer className="nutrition-scope-note">
        <BookOpenCheck size={17} aria-hidden="true" />
        <p>공식 출처를 우선한 참고 정보예요. 검사 결과로 결핍을 판단하거나 섭취량과 식단을 처방하지 않아요.</p>
      </footer>
    </div>
  );
}
