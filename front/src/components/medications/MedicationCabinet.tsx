"use client";

import { ArrowRight, CalendarDays, CheckCircle2, CircleHelp } from "lucide-react";
import Link from "next/link";
import { useActionState, useRef, useState, type KeyboardEvent, type UIEvent } from "react";

import { refreshMedicationExplanationAction } from "@/app/actions";
import { FormMessage } from "@/components/ui/FormMessage";
import { Badge } from "@/components/ui/Badge";
import type { ActionState } from "@care-atlas/backend";

export type MedicationCabinetItem = {
  id: string;
  productName: string;
  ingredientName: string;
  category: string;
  isNew: boolean;
  purpose: string;
  commonEffects?: string[];
  dose: string;
  frequency: string;
  timing: string;
  startSummary: string;
  sourceLabel: string;
  clinicianQuestion?: string;
  itemSeq?: string;
  needsExplanation?: boolean;
};

export function MedicationCabinet({ medications, detailBase = "/medications", revision }: { medications: MedicationCabinetItem[]; detailBase?: string; revision?: number }) {
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
    tabs.current[nextIndex]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  };

  const selectMedication = (index: number) => {
    setSelectedIndex(index);
    tabs.current[index]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  };

  const syncSelectionWithScroll = (event: UIEvent<HTMLDivElement>) => {
    const rail = event.currentTarget;
    const railCenter = rail.getBoundingClientRect().left + rail.clientWidth / 2;
    let closestIndex = selectedIndex;
    let closestDistance = Number.POSITIVE_INFINITY;
    tabs.current.forEach((tab, index) => {
      if (!tab) return;
      const bounds = tab.getBoundingClientRect();
      const distance = Math.abs(bounds.left + bounds.width / 2 - railCenter);
      if (distance < closestDistance) {
        closestIndex = index;
        closestDistance = distance;
      }
    });
    if (closestIndex !== selectedIndex) setSelectedIndex(closestIndex);
  };

  return (
    <section className="medicine-cabinet" aria-labelledby="medicine-cabinet-title">
      <header className="medicine-cabinet__heading">
        <div>
          <h2 id="medicine-cabinet-title">지금 복용 중인 약</h2>
          <span>{medications.length}가지</span>
        </div>
        <p>약을 선택하면 복용 일정과 약의 쉬운 설명을 볼 수 있어요.</p>
      </header>

      <div className="medicine-cabinet__body">
        <div className="medicine-cabinet__tabs" role="tablist" aria-label="복용약 선택" onScroll={syncSelectionWithScroll}>
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
        {medications.length > 1 ? (
          <div className="medicine-cabinet__mobile-navigation">
            <span>옆으로 넘겨 다른 약 보기</span>
            <div className="medicine-cabinet__pagination" aria-label={`복용약 ${medications.length}개 중 ${selectedIndex + 1}번째`}>
              {medications.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className={index === selectedIndex ? "is-current" : ""}
                  aria-label={`${item.productName} 선택`}
                  aria-current={index === selectedIndex ? "true" : undefined}
                  onClick={() => selectMedication(index)}
                />
              ))}
            </div>
          </div>
        ) : null}

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
          </header>

          <div className="medicine-cabinet__purpose">
            <span>이 약을 쉽게 설명하면</span>
            {medication.needsExplanation ? (
              <>
                <p className="medicine-cabinet__overview">쉬운 설명을 아직 만들지 않았어요.</p>
                <p className="medicine-cabinet__explanation-note">식약처 허가정보를 다시 확인한 뒤 쉬운 말로 정리합니다.</p>
                {medication.itemSeq && revision !== undefined ? <MedicationExplanationRefresh medicationId={medication.id} itemSeq={medication.itemSeq} revision={revision} /> : null}
              </>
            ) : <p className="medicine-cabinet__overview">{medication.purpose}</p>}
          </div>

          <div className="medicine-cabinet__information">
            <dl className="medicine-cabinet__schedule">
              <div><dt>한 번에</dt><dd>{medication.dose}</dd></div>
              <div><dt>하루 횟수</dt><dd>{medication.frequency}</dd></div>
              <div><dt>먹는 시점</dt><dd>{medication.timing}</dd></div>
            </dl>
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
