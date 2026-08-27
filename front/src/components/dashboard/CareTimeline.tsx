import { formatDate } from "@/lib/presentation";
import { careTimelineItems } from "@/lib/recent-care-records";
import type { MedicationPlan, SymptomEvent } from "@care-atlas/backend";

export function CareTimeline({
  medications,
  symptoms,
}: {
  medications: MedicationPlan[];
  symptoms: SymptomEvent[];
}) {
  const items = careTimelineItems(medications, symptoms);

  if (items.length === 0) {
    return <p className="empty-state">최근 7일 동안 기록된 약 변화와 몸 상태가 없어요.</p>;
  }

  return (
    <ol className="timeline" aria-label="최근 약과 몸 상태 기록">
      {items.map((item) => (
        <li className="timeline-item" key={item.id}>
          <time className="timeline-item__date" dateTime={item.date}>
            {formatDate(item.date)}
          </time>
          <div className="timeline-item__content">
            <strong>{item.title}</strong>
            <p>{item.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
