import assert from "node:assert/strict";
import test from "node:test";

import demoSeed from "./data/demo-seed.json" with { type: "json" };
import { buildNutritionInsights, conditionFromDiagnosis } from "./nutrition.ts";
import type { CareSnapshot } from "./types.ts";

function snapshot(overrides: Partial<CareSnapshot> = {}): CareSnapshot {
  return {
    ...demoSeed,
    todayCheckIn: null,
    dataSource: "firestore",
    revision: 0,
    ...overrides,
  } as CareSnapshot;
}

test("자유 입력 건강 상태만으로는 식사·영양 인사이트를 만들지 않는다", () => {
  const input = snapshot({
    recipient: { ...demoSeed.recipient, confirmedConditions: [], conditions: ["고혈압", "혈압 관리 중"] },
  });
  assert.deepEqual(buildNutritionInsights(input), []);
});

test("확정한 고혈압은 질환별 식사·영양 주제를 만든다", () => {
  const insights = buildNutritionInsights(snapshot());
  assert.equal(insights.some((insight) => insight.id === "hypertension-lower-sodium" && insight.kind === "food"), true);
  assert.equal(insights.some((insight) => insight.id === "hypertension-supplements-not-treatment" && insight.kind === "food"), true);
  assert.equal(insights.every((insight) => insight.evidence.length > 0 && insight.lastReviewedAt === "2026-08-29"), true);
});

test("주의 약물이 있으면 칼륨 항목을 더 보수적인 피하기 상태로 올린다", () => {
  const input = snapshot({
    medications: [{
      ...demoSeed.medications[0],
      id: "med-losartan",
      productName: "코자정 50mg",
      ingredientName: "로사르탄",
    }],
  });
  const insight = buildNutritionInsights(input).find((item) => item.id === "hypertension-supplements-not-treatment");
  assert.equal(insight?.status, "avoid");
  assert.deepEqual(insight?.matchedMedicationIds, ["med-losartan"]);
  assert.match(insight?.summary ?? "", /대체소금/);
});

test("등록된 관련 영양제 원료를 인사이트에 표시한다", () => {
  const input = snapshot({
    recipient: {
      ...demoSeed.recipient,
      supplementIntakes: [{ ingredientId: "potassium", ingredientName: "칼륨", status: "active", lastConfirmedAt: "2026-08-29T00:00:00Z" }],
    },
  });
  const insight = buildNutritionInsights(input).find((item) => item.id === "hypertension-supplements-not-treatment");
  assert.deepEqual(insight?.currentSupplementNames, ["칼륨"]);
});

test("진단명과 KCD 코드는 검수 질환을 정규화하고 그 밖의 질환도 AI 보완용으로 보존한다", () => {
  assert.equal(conditionFromDiagnosis({ name: "본태성 고혈압", code: "I10" }, { sourceLabel: "test" })?.id, "condition-hypertension");
  assert.equal(conditionFromDiagnosis({ name: "지원하지 않는 질환", code: "Z99" }, { sourceLabel: "test" })?.id, "condition-Z99");
});
