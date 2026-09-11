"use client";

import { useState } from "react";
import { BookOpen, Carrot, Salad, ShoppingBasket, Utensils } from "lucide-react";

const topics = [
  { label: "식단", icon: Salad, title: "고혈압 식단, 한 끼부터 살펴보기", description: "집밥 구성부터 저염식 조리까지, 일상에서 참고할 식사 자료를 모아요.", keywords: ["한 끼 구성", "저염식 조리"] },
  { label: "영양소", icon: Carrot, title: "고혈압과 영양소, 무엇을 확인할까요?", description: "질환과 관련된 영양소를 음식 속에서 살펴보고, 섭취 시 확인할 점을 읽어봐요.", keywords: ["음식 속 영양소", "섭취 시 확인할 점"] },
  { label: "장보기", icon: ShoppingBasket, title: "고혈압 식사 관리를 위한 장보기", description: "식재료 선택과 영양표시 읽기 등, 장을 볼 때 참고할 자료를 찾아봐요.", keywords: ["식재료 선택", "영양표시 읽기"] },
  { label: "외식", icon: Utensils, title: "고혈압이 있을 때, 외식 메뉴 살펴보기", description: "밖에서 한 끼를 먹을 때도 참고할 수 있도록 메뉴와 주문 방법 자료를 모아요.", keywords: ["메뉴 고르기", "주문할 때 확인"] },
];

export function NutritionPreview() {
  const [selected, setSelected] = useState(0);
  const topic = topics[selected];
  const Icon = topic.icon;

  return (
    <div className="launch-nutrition-preview">
      <div className="launch-nutrition-preview__heading"><span><i aria-hidden="true" /> 고혈압</span><small>자료 탐색 예시</small></div>
      <div className="launch-nutrition-preview__topics" role="group" aria-label="영양 자료 미리보기 주제">
        {topics.map(({ label }, index) => <button key={label} type="button" aria-pressed={selected === index} aria-controls="nutrition-preview-result" onClick={() => setSelected(index)}>{label}</button>)}
      </div>
      <div id="nutrition-preview-result" className="launch-nutrition-preview__result" aria-live="polite" aria-atomic="true">
        <div className="launch-nutrition-preview__article" key={topic.label}>
          <span className="launch-nutrition-preview__illustration" aria-hidden="true"><Icon size={32} strokeWidth={1.5} /></span>
          <div><h4>{topic.title}</h4><p>{topic.description}</p></div>
        </div>
        <div className="launch-nutrition-preview__keywords"><BookOpen size={14} aria-hidden="true" />{topic.keywords.map(keyword => <span key={keyword}>{keyword}</span>)}</div>
      </div>
    </div>
  );
}
