import { Check, ChevronRight, Clock3, MessageSquareText } from "lucide-react";

const medicationTasks = [
  { time: "08:00", label: "아침 약 3종", detail: "식후 30분", done: true },
  { time: "13:00", label: "점심 약 1종", detail: "식후 30분", done: false },
  { time: "20:00", label: "저녁 약 2종", detail: "식후 30분", done: false },
];

export function CareDashboardPreview() {
  return (
    <div className="landing-preview" aria-label="IPILLGOOD 오늘의 돌봄 화면 예시">
      <div className="landing-preview__topbar">
        <span className="landing-preview__dots" aria-hidden="true"><i /><i /><i /></span>
        <span>오늘의 돌봄</span>
        <span className="landing-preview__date">8월 16일</span>
      </div>
      <div className="landing-preview__body">
        <div className="landing-preview__greeting">
          <span>김○○ 어르신</span>
          <strong>오늘도 천천히 확인해 볼까요?</strong>
        </div>
        <div className="landing-preview__progress">
          <div><span>오늘 복약</span><strong>1 / 3 완료</strong></div>
          <span>33%</span>
          <progress aria-label="복약 일정 완료율" max="100" value="33" />
        </div>
        <ul className="landing-preview__tasks" aria-label="오늘 복약 일정">
          {medicationTasks.map((task) => (
            <li className={task.done ? "is-done" : undefined} key={task.time}>
              <time>{task.time}</time>
              <span className="landing-preview__task-state" aria-hidden="true">
                {task.done ? <Check size={14} /> : <Clock3 size={14} />}
              </span>
              <span><strong>{task.label}</strong><small>{task.detail}</small></span>
              <ChevronRight size={16} aria-hidden="true" />
            </li>
          ))}
        </ul>
        <div className="landing-preview__checkin">
          <span className="landing-preview__checkin-icon" aria-hidden="true"><MessageSquareText size={18} /></span>
          <span><strong>오늘 몸 상태는 어떠셨나요?</strong><small>1분 안부 확인으로 기록을 남겨보세요.</small></span>
          <span className="landing-preview__checkin-button">확인하기</span>
        </div>
      </div>
    </div>
  );
}
