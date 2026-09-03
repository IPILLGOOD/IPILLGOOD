"use client";

import { CalendarDays, Check, ChevronLeft, ChevronRight, Circle, HeartPulse, Pill } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { DoseResponseEditor } from "@/components/dashboard/UnansweredDoseSummary";

type CalendarMedication = {
  id: string;
  productName: string;
  timing: string;
  startDate: string;
  endDate?: string;
  recurrence?:
    | { kind: "daily"; count: number }
    | { kind: "interval_days"; intervalDays: number; count: 1 }
    | { kind: "weekly"; intervalWeeks: number; count: 1 }
    | { kind: "weekdays"; weekdays: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun">; count: 1 }
    | { kind: "as_needed" }
    | { kind: "unknown" };
};

type CalendarDose = {
  id: string;
  medicationPlanId: string;
  scheduledAt: string;
  response: "completed" | "partial" | "skipped" | "not_yet" | "unconfirmed";
  answeredBy: "caregiver" | "recipient";
};

type CalendarSymptom = {
  id: string;
  symptomType: string;
  occurredAt: string;
  severity: number;
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function parseDateKey(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function scheduledOn(medication: CalendarMedication, key: string) {
  const start = parseDateKey(medication.startDate);
  const end = medication.endDate ? parseDateKey(medication.endDate) : undefined;
  if (!start || key < start || (end && key > end)) return false;

  const recurrence = medication.recurrence;
  if (!recurrence || recurrence.kind === "daily" || recurrence.kind === "unknown") return true;
  if (recurrence.kind === "as_needed") return false;

  const current = new Date(`${key}T00:00:00Z`);
  const started = new Date(`${start}T00:00:00Z`);
  const days = Math.round((current.getTime() - started.getTime()) / 86_400_000);
  if (recurrence.kind === "interval_days") return days % recurrence.intervalDays === 0;
  if (recurrence.kind === "weekly") return days % (recurrence.intervalWeeks * 7) === 0;
  return recurrence.weekdays.includes(WEEKDAY_KEYS[current.getUTCDay()]);
}

function doseLabel(response: CalendarDose["response"] | undefined) {
  if (response === "completed") return "복용 완료";
  if (response === "partial") return "일부 복용";
  if (response === "skipped") return "건너뜀";
  if (response === "unconfirmed") return "확인 필요";
  return "아직 체크 전";
}

export function CareDiaryCalendar({
  initialDate,
  medications,
  doses,
  symptoms,
  revision,
}: {
  initialDate: string;
  medications: CalendarMedication[];
  doses: CalendarDose[];
  symptoms: CalendarSymptom[];
  revision: number;
}) {
  const initial = new Date(`${initialDate}T00:00:00Z`);
  const [visibleMonth, setVisibleMonth] = useState({ year: initial.getUTCFullYear(), month: initial.getUTCMonth() });
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [selectedDoseId, setSelectedDoseId] = useState<string | null>(null);
  const [selectionRequest, setSelectionRequest] = useState(0);

  useEffect(() => {
    const selectDose = (event: Event) => {
      const detail = (event as CustomEvent<{ date?: string; doseId?: string }>).detail;
      if (!detail?.date || !detail.doseId || !/^\d{4}-\d{2}-\d{2}$/.test(detail.date)) return;
      const date = new Date(`${detail.date}T00:00:00Z`);
      setVisibleMonth({ year: date.getUTCFullYear(), month: date.getUTCMonth() });
      setSelectedDate(detail.date);
      setSelectedDoseId(detail.doseId);
      setSelectionRequest((value) => value + 1);
    };
    window.addEventListener("care-diary:select-dose", selectDose);
    return () => window.removeEventListener("care-diary:select-dose", selectDose);
  }, []);

  const cells = useMemo(() => {
    const firstDay = new Date(Date.UTC(visibleMonth.year, visibleMonth.month, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(visibleMonth.year, visibleMonth.month + 1, 0)).getUTCDate();
    return [
      ...Array.from({ length: firstDay }, () => null),
      ...Array.from({ length: daysInMonth }, (_, index) => dateKey(visibleMonth.year, visibleMonth.month, index + 1)),
    ];
  }, [visibleMonth]);

  const changeMonth = (offset: number) => {
    const next = new Date(Date.UTC(visibleMonth.year, visibleMonth.month + offset, 1));
    setVisibleMonth({ year: next.getUTCFullYear(), month: next.getUTCMonth() });
    setSelectedDate(dateKey(next.getUTCFullYear(), next.getUTCMonth(), 1));
    setSelectedDoseId(null);
  };

  const selectedMedications = medications.filter((medication) => scheduledOn(medication, selectedDate));
  const selectedDoses = doses.filter((dose) => parseDateKey(dose.scheduledAt) === selectedDate);
  const selectedSymptoms = symptoms.filter((symptom) => parseDateKey(symptom.occurredAt) === selectedDate);
  const selected = new Date(`${selectedDate}T00:00:00Z`);

  return (
    <section className="care-diary" aria-labelledby="care-diary-title">
      <div className="care-diary__header">
        <div>
          <span className="care-diary__eyebrow">MY CARE DIARY</span>
          <h2 id="care-diary-title">복약 달력</h2>
          <p>날짜를 눌러 복약 일정과 몸 상태 기록을 확인해보세요.</p>
        </div>
        <div className="care-diary__month-nav" aria-label="달력 월 이동">
          <button type="button" onClick={() => changeMonth(-1)} aria-label="이전 달"><ChevronLeft size={19} /></button>
          <strong>{visibleMonth.year}년 {visibleMonth.month + 1}월</strong>
          <button type="button" onClick={() => changeMonth(1)} aria-label="다음 달"><ChevronRight size={19} /></button>
        </div>
      </div>

      <div className="care-diary__body">
        <div className="care-calendar">
          <div className="care-calendar__weekdays" aria-hidden="true">
            {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>
          <div className="care-calendar__grid">
            {cells.map((key, index) => {
              if (!key) return <span className="care-calendar__blank" key={`blank-${index}`} />;
              const day = Number(key.slice(-2));
              const dayDoses = doses.filter((dose) => parseDateKey(dose.scheduledAt) === key);
              const daySymptoms = symptoms.filter((symptom) => parseDateKey(symptom.occurredAt) === key);
              const scheduled = medications.some((medication) => scheduledOn(medication, key));
              const complete = dayDoses.some((dose) => dose.response === "completed");
              return (
                <button
                  type="button"
                  key={key}
                  className={["care-calendar__day", key === selectedDate ? "is-selected" : "", key === initialDate ? "is-today" : ""].filter(Boolean).join(" ")}
                  onClick={() => { setSelectedDate(key); setSelectedDoseId(null); }}
                  aria-pressed={key === selectedDate}
                  aria-label={`${visibleMonth.month + 1}월 ${day}일${complete ? ", 복용 완료 기록 있음" : ""}`}
                >
                  <span>{day}</span>
                  <span className="care-calendar__marks" aria-hidden="true">
                    {complete ? <i className="mark mark--complete"><Check size={10} /></i> : scheduled ? <i className="mark mark--scheduled" /> : null}
                    {daySymptoms.length > 0 ? <i className="mark mark--symptom" /> : null}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="care-calendar__legend">
            <span><i className="mark mark--complete"><Check size={9} /></i> 복용 완료</span>
            <span><i className="mark mark--scheduled" /> 복약 일정</span>
            <span><i className="mark mark--symptom" /> 몸 상태 기록</span>
          </div>
        </div>

        <div className="care-diary__schedule">
          <div className="care-diary__selected-date">
            <CalendarDays size={19} aria-hidden="true" />
            <div><strong>{selected.getUTCMonth() + 1}월 {selected.getUTCDate()}일</strong><span>{WEEKDAYS[selected.getUTCDay()]}요일 일정</span></div>
          </div>

          <div className="care-diary__list">
            {selectedMedications.length === 0 && selectedSymptoms.length === 0 ? (
              <div className="care-diary__empty"><Circle size={20} /><p>등록된 일정이나 기록이 없어요.</p></div>
            ) : null}
            {selectedMedications.map((medication) => {
              const dose = selectedDoses.find((item) => item.medicationPlanId === medication.id);
              const completed = dose?.response === "completed";
              if (dose && selectedDate <= initialDate) {
                return (
                  <DoseResponseEditor
                    className="care-diary__task-editor"
                    key={`${selectedDate}-${medication.id}-${selectionRequest}`}
                    dose={dose}
                    medication={medication}
                    revision={revision}
                    initiallyOpen={dose.id === selectedDoseId}
                  />
                );
              }
              return (
                <article className={`care-diary__task ${completed ? "is-complete" : ""}`} key={medication.id}>
                  <span className="care-diary__task-check" aria-hidden="true">{completed ? <Check size={16} /> : <Pill size={16} />}</span>
                  <div><strong>{medication.productName}</strong><p>{medication.timing} · {doseLabel(dose?.response)}</p></div>
                </article>
              );
            })}
            {selectedSymptoms.map((symptom) => (
              <article className="care-diary__task care-diary__task--symptom" key={symptom.id}>
                <span className="care-diary__task-check" aria-hidden="true"><HeartPulse size={16} /></span>
                <div><strong>{symptom.symptomType}</strong><p>몸 상태 {symptom.severity}/10으로 기록</p></div>
              </article>
            ))}
          </div>

        </div>
      </div>
    </section>
  );
}
