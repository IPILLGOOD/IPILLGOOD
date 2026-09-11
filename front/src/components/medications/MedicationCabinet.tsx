"use client";

import { ArrowRight, CalendarDays, CheckCircle2, CircleHelp, Trash2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type KeyboardEvent, type UIEvent } from "react";
import { refreshMedicationExplanationAction } from "@/app/actions";
import { FormMessage } from "@/components/ui/FormMessage";
import type { ActionState } from "@care-atlas/backend";

import { Badge } from "@/components/ui/Badge";
import { stopMedicationAction } from "@/app/actions";

export type MedicationCabinetItem = {
  id: string;
  productName: string;
  ingredientName: string;
  category: string;
  isNew: boolean;
  purpose: string;
  description?: string;
  commonEffects?: string[];
  itemSeq?: string;
  needsExplanation?: boolean;
  dose: string;
  frequency: string;
  timing: string;
  watchFor?: string[];
  startSummary: string;
  sourceLabel: string;
  clinicianQuestion?: string;
};

export function MedicationCabinet({ medications, detailBase = "/medications", revision }: { medications: MedicationCabinetItem[]; detailBase?: string; revision?: number }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(scrollTimer.current), []);
  const medication = medications[selectedIndex] ?? medications[0];

  if (!medication) return null;

  const selectMedication = (index: number) => {
    clearTimeout(scrollTimer.current);
    setSelectedIndex(index);
    tabs.current[index]?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      block: "nearest", inline: "center",
    });
  };

  const moveSelection = (index: number, event: KeyboardEvent<HTMLButtonElement>) => {
    let nextIndex = index;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") nextIndex = (index + 1) % medications.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") nextIndex = (index - 1 + medications.length) % medications.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = medications.length - 1;
    else return;

    event.preventDefault();
    tabs.current[nextIndex]?.focus({ preventScroll: true });
    selectMedication(nextIndex);
  };

  const syncSelectionWithScroll = (event: UIEvent<HTMLDivElement>) => {
    const rail = event.currentTarget;
    clearTimeout(scrollTimer.current);
    // Intermediate smooth-scroll positions must not replace an explicit tab
    // selection. Settle a swipe only after scrolling stops (including older iOS).
    scrollTimer.current = setTimeout(() => {
      // Wider rows show multiple tabs at once; their visual center does not
      // determine selection. Only the single-card snapping carousel does.
      if (rail.scrollWidth <= rail.clientWidth || getComputedStyle(rail).scrollSnapType === "none") return;
      const railCenter = rail.getBoundingClientRect().left + rail.clientWidth / 2;
      let closestIndex = 0;
      let closestDistance = Number.POSITIVE_INFINITY;
      tabs.current.forEach((tab, index) => {
        if (!tab) return;
        const bounds = tab.getBoundingClientRect();
        const distance = Math.abs(bounds.left + bounds.width / 2 - railCenter);
        if (distance < closestDistance) { closestIndex = index; closestDistance = distance; }
      });
      setSelectedIndex(closestIndex);
    }, 150);
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
        <div className="medicine-cabinet__tabs" role="tablist" aria-label="복용약 선택" aria-orientation="vertical" onScroll={syncSelectionWithScroll}>
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
              onClick={() => selectMedication(index)}
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
            <Link className="medicine-cabinet__detail-link" href={`${detailBase}/${medication.id}`}>
              상세 정보 보기 <ArrowRight size={17} aria-hidden="true" />
            </Link>
            {detailBase === "/medications" && revision !== undefined ? <MedicationStop medicationId={medication.id} productName={medication.productName} revision={revision} key={medication.id} /> : null}
          </header>

          <div className="medicine-cabinet__purpose">
            <span>이 약은 무엇을 도와주나요?</span>
            <strong>{medication.purpose}</strong>
            <p>{medication.description}</p>
            {medication.needsExplanation && medication.itemSeq && revision !== undefined ? <MedicationExplanationRefresh medicationId={medication.id} itemSeq={medication.itemSeq} revision={revision} /> : null}
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
                {(medication.watchFor ?? medication.commonEffects ?? []).map((item) => <li key={item}>{item}</li>)}
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

export function MedicationExplanationRefresh({ medicationId, itemSeq, revision, label = "쉬운 설명 만들기" }: { medicationId: string; itemSeq: string; revision: number; label?: string }) {
  const initialState: ActionState = { status: "idle", message: "" };
  const [state, action, pending] = useActionState(refreshMedicationExplanationAction, initialState);
  return <form action={action} className="medicine-cabinet__explanation-refresh">
    <input type="hidden" name="medicationId" value={medicationId} />
    <input type="hidden" name="itemSeq" value={itemSeq} />
    <input type="hidden" name="expectedRevision" value={revision} />
    <button className="button button--secondary" type="submit" disabled={pending}>{pending ? "설명 만드는 중…" : label}</button>
    <FormMessage state={state} />
  </form>;
}

function MedicationStop({ medicationId, productName, revision }: { medicationId: string; productName: string; revision: number }) {
  const [state, action, pending] = useActionState(stopMedicationAction, { status: "idle" as const, message: "" });
  return <form action={action}>
    <input type="hidden" name="medicationPlanId" value={medicationId} />
    <input type="hidden" name="expectedRevision" value={revision} />
    <button className="button button--secondary" type="submit" aria-label={`${productName} 복용약에서 빼기`} disabled={pending}>
      <Trash2 size={16} aria-hidden="true" /> {pending ? "목록에서 빼는 중…" : "복용약에서 빼기"}
    </button>
    <FormMessage state={state} />
  </form>;
}
