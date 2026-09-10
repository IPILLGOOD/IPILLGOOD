"use client";

import { useState } from "react";
import { ArrowRight, ClipboardCheck, HeartPulse, Hospital, House, Pill, Sparkles } from "lucide-react";

const steps = [
  { label: "병원", icon: Hospital, moment: "진료를 마치고", title: "약봉투 한 장에서 시작해요.", description: "약봉투를 올리면 약 이름과 복용법을 정리해요. 보호자가 원본과 대조해 확인한 뒤, 오늘의 일정으로 이어집니다.", agent: "문서 속 정보를 읽고, 확인할 항목을 정리해요.", pipeline: ["약봉투 업로드", "AI 문서 정리", "보호자 확인"] },
  { label: "집", icon: House, moment: "집에 돌아와서", title: "낯선 약 이름을 쉬운 말로.", description: "이 약이 일반적으로 어디에 쓰이는지 읽어보세요. 실제로 먹을 양과 시간은 약봉투에서 확인한 기록으로 따로 볼 수 있어요.", agent: "공식 약 정보를 바탕으로 이해하기 쉬운 설명을 도와요.", pipeline: ["등록한 약", "공식 정보 확인", "쉬운 설명"] },
  { label: "복약", icon: Pill, moment: "약 먹을 시간이 되면", title: "알림으로 챙기고, 기록으로 남겨요.", description: "알림을 켜두면 앱을 닫아도 복약 시간을 알려드려요. 먹었는지 남기면 가족도 같은 기록을 보고 돌봄을 이어갈 수 있어요.", agent: "등록한 복약 일정에 맞춰 알림을 보내고, 사용자가 남긴 복용 여부를 함께 보여줘요.", pipeline: ["복약 시간 알림", "복용 여부 선택", "가족과 공유"] },
  { label: "안부 기록", icon: HeartPulse, moment: "하루의 변화를 살펴보며", title: "작은 변화도 지나치지 않도록.", description: "최근 기록을 바탕으로 오늘 살펴볼 질문을 준비해요. 몇 가지 질문에 답하며 평소와 다른 몸 상태를 남길 수 있어요.", agent: "최근 14일 기록에서 확인할 흐름을 찾고, 정해진 질문 틀에 연결해요.", pipeline: ["최근 복약·몸 상태", "Care Agent 분석", "오늘의 안부 질문"] },
  { label: "다음 진료", icon: ClipboardCheck, moment: "다시 진료실에서", title: "막연한 기억 대신, 이어진 기록.", description: "언제 약을 먹었고 어떤 변화가 있었는지 돌아보세요. 의료진에게 확인하고 싶었던 질문도 함께 준비해요.", agent: "변화의 원인을 단정하지 않고 상담에 필요한 기록을 모아요.", pipeline: ["쌓인 돌봄 기록", "변화 돌아보기", "상담 질문 준비"] },
];

export function CareFlowExplorer() {
  const [active, setActive] = useState(0);
  const step = steps[active];
  const Icon = step.icon;

  return (
    <div className="launch-care-flow">
      <div className="launch-care-flow__caption"><span>병원과 집 사이, 돌봄이 이어지는 방식</span><small>단계를 눌러 살펴보세요</small></div>
      <div className="launch-care-flow__route" role="group" aria-label="돌봄 흐름 단계">
        {steps.map(({ label, icon: StepIcon }, index) => (
          <button type="button" key={label} aria-pressed={active === index} aria-controls="care-flow-detail" onClick={() => setActive(index)}>
            <span><StepIcon size={24} aria-hidden="true" /></span><strong>{label}</strong>
          </button>
        ))}
      </div>
      <div className="launch-care-flow__detail" id="care-flow-detail" aria-live="polite" aria-atomic="true">
        <div className="launch-care-flow__story" key={step.label}>
          <small><Icon size={15} aria-hidden="true" /> {step.moment}</small>
          <h3>{step.title}</h3><p>{step.description}</p>
        </div>
        <div className="launch-care-flow__agent">
          <span><Sparkles size={16} aria-hidden="true" /> IPILLGOOD가 돕는 일</span>
          <p>{step.agent}</p>
          <ol>{step.pipeline.map((item, index) => <li key={item}>{index > 0 && <ArrowRight size={13} aria-hidden="true" />}<span>{item}</span></li>)}</ol>
        </div>
      </div>
    </div>
  );
}
