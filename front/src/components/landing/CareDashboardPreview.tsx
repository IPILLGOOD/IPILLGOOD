import { Check, Clock3, HeartPulse, Sparkles } from "lucide-react";

const medicationTasks = [
  { time: "08:30", label: "노바스크정 5mg", detail: "1정 · 아침 식후", done: true },
  { time: "13:00", label: "뮤코펙트정", detail: "1정 · 점심 식후", done: false },
  { time: "19:30", label: "뮤코펙트정", detail: "1정 · 저녁 식후", done: false },
];

export function CareDashboardPreview() {
  const calendarDays = Array.from({ length: 35 }, (_, index) => index - 1);
  return (
    <div className="launch-product-stage" aria-label="IPILLGOOD 오늘 화면 미리보기">
      <div className="launch-orbit launch-orbit--one" aria-hidden="true" />
      <div className="launch-orbit launch-orbit--two" aria-hidden="true" />
      <div className="launch-float-card launch-float-card--document" aria-hidden="true">
        <Sparkles size={15} />
        <span><small>약봉투 정리</small><strong>3개 약 확인 완료</strong></span>
      </div>
      <div className="launch-float-card launch-float-card--care" aria-hidden="true">
        <HeartPulse size={15} />
        <span><small>오늘의 기록</small><strong>가족과 공유 중</strong></span>
      </div>
      <div className="launch-calendar" aria-hidden="true">
        <div className="launch-calendar__head"><span>2026. 09</span><strong>복약 캘린더</strong></div>
        <div className="launch-calendar__week"><span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span></div>
        <div className="launch-calendar__days">
          {calendarDays.map((day, index) => (
            <i className={day === 11 ? "is-today" : day > 0 && [3, 6, 9, 10, 14, 16, 18, 22, 25].includes(day) ? "has-record" : undefined} key={index}>
              {day > 0 && day <= 30 ? day : ""}
            </i>
          ))}
        </div>
      </div>
      <div className="launch-device">
        <div className="launch-device__bar">
          <span>9:41</span>
          <strong>오늘</strong>
          <span>9월 11일</span>
        </div>
        <div className="launch-device__body">
          <div className="launch-device__intro">
            <span>좋은 아침이에요</span>
            <strong>오늘 복용할 것</strong>
            <p>시간순으로 확인하고 바로 기록하세요.</p>
          </div>
          <div className="launch-dose-progress">
            <div><span>오늘 진행 상황</span><strong>1/3 완료</strong></div>
            <div className="launch-dose-progress__track" aria-label="복약 일정 3개 중 1개 완료">
              <i className="is-filled" /><i /><i />
            </div>
          </div>
          <ul className="launch-dose-list" aria-label="오늘 복약 일정 예시">
            {medicationTasks.map((task) => (
              <li className={task.done ? "is-done" : undefined} key={`${task.time}-${task.label}`}>
                <time>{task.time}</time>
                <span><strong>{task.label}</strong><small>{task.detail}</small></span>
                <i aria-label={task.done ? "복용 완료" : "복용 예정"}>
                  {task.done ? <Check size={16} /> : <Clock3 size={16} />}
                </i>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
