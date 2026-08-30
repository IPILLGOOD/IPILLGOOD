"use client";

import { ArrowRight, CalendarDays, CheckCircle2, CircleHelp } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type KeyboardEvent } from "react";

import { Badge } from "@/components/ui/Badge";

export type MedicationCabinetItem = {
  id: string;
  productName: string;
  ingredientName: string;
  category: string;
  isNew: boolean;
  purpose: string;
  description: string;
  dose: string;
  frequency: string;
  timing: string;
  watchFor: string[];
  startSummary: string;
  sourceLabel: string;
  clinicianQuestion?: string;
};

export function MedicationCabinet({ medications }: { medications: MedicationCabinetItem[] }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const medication = medications[selectedIndex] ?? medications[0];

  if (!medication) return null;

  const moveSelection = (index: number, event: KeyboardEvent<HTMLButtonElement>) => {
    let nextIndex = index;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") nextIndex = (index + 1) % medications.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") nextIndex = (index - 1 + medications.length) % medications.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = medications.length - 1;
    else return;

    event.preventDefault();
    setSelectedIndex(nextIndex);
    tabs.current[nextIndex]?.focus();
  };

  return (
    <section className="medicine-cabinet" aria-labelledby="medicine-cabinet-title">
      <header className="medicine-cabinet__heading">
        <div>
          <h2 id="medicine-cabinet-title">지금 복용 중인 약</h2>
          <span>{medications.length}가지</span>
        </div>
        <p>약을 선택하면 복용법과 살펴볼 점을 한눈에 볼 수 있어요.</p>
      </header>

      <div className="medicine-cabinet__body">
        <div className="medicine-cabinet__tabs" role="tablist" aria-label="복용약 선택" aria-orientation="vertical">
          {medications.map((item, index) => (
            <button
              ref={(element) => { tabs.current[index] = element; }}
              className={index === selectedIndex ? "medicine-cabinet__tab medicine-cabinet__tab--active" : "medicine-cabinet__tab"}
              id={`medicine-tab-${item.id}`}
              key={item.id}
              type="button"
              role="tab"
              aria-controls={`medicine-panel-${item.id}`}
              aria-selected={index === selectedIndex}
              tabIndex={index === selectedIndex ? 0 : -1}
              onClick={() => setSelectedIndex(index)}
              onKeyDown={(event) => moveSelection(index, event)}
            >
              <span className="medicine-cabinet__capsule" aria-hidden="true"><span /></span>
              <span className="medicine-cabinet__tab-copy">
                <strong>{item.productName}</strong>
                <small>{item.ingredientName}</small>
              </span>
              <span className="medicine-cabinet__tab-time">{item.frequency}</span>
            </button>
          ))}
        </div>

        <article
          className="medicine-cabinet__panel"
          id={`medicine-panel-${medication.id}`}
          role="tabpanel"
          aria-labelledby={`medicine-tab-${medication.id}`}
        >
          <header className="medicine-cabinet__panel-header">
            <div>
              <div className="medication-row__name">
                <h3>{medication.productName}</h3>
                <Badge tone="success">{medication.category}</Badge>
                {medication.isNew ? <Badge tone="info">새로 시작</Badge> : null}
              </div>
              <p>성분명 · {medication.ingredientName}</p>
            </div>
            <Link className="medicine-cabinet__detail-link" href={`/medications/${medication.id}`}>
              상세 정보 보기 <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </header>

          <div className="medicine-cabinet__purpose">
            <span>이 약은 무엇을 도와주나요?</span>
            <strong>{medication.purpose}</strong>
            <p>{medication.description}</p>
          </div>

          <div className="medicine-cabinet__information">
            <dl className="medicine-cabinet__schedule">
              <div><dt>한 번에</dt><dd>{medication.dose}</dd></div>
              <div><dt>하루 횟수</dt><dd>{medication.frequency}</dd></div>
              <div><dt>먹는 시점</dt><dd>{medication.timing}</dd></div>
            </dl>

            <section className="medicine-cabinet__watch">
              <h4>보호자가 살펴볼 점</h4>
              <ul>
                {medication.watchFor.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>
          </div>

          <footer className="medicine-cabinet__sources">
            <span><CalendarDays size={16} aria-hidden="true" />{medication.startSummary}</span>
            <span><CheckCircle2 size={16} aria-hidden="true" />{medication.sourceLabel}</span>
            {medication.clinicianQuestion ? (
              <span><CircleHelp size={16} aria-hidden="true" />{medication.clinicianQuestion}</span>
            ) : null}
          </footer>
        </article>
      </div>
    </section>
  );
}
