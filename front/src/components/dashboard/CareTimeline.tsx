import { formatDate } from "@/lib/presentation";
import type { MedicationPlan, SymptomEvent } from "@care-atlas/backend";

type TimelineItem = { date: string; title: string; detail: string };

export function CareTimeline({
  medications,
  symptoms,
}: {
  medications: MedicationPlan[];
  symptoms: SymptomEvent[];
}) {
  const items: TimelineItem[] = [
    ...medications
      .filter((medication) => medication.isNew)
      .map((medication) => ({
        date: medication.startDate,
        title: `${medication.productName} 복용 시작`,
        detail: medication.sourceLabel,
      })),
    ...symptoms.slice(0, 4).map((symptom) => ({
      date: symptom.occurredAt,
      title: `${symptom.symptomType} ${symptom.severity}/10 기록`,
      detail: symptom.dailyLifeImpact,
    })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);

  return (
    <ol className="timeline" aria-label="최근 약과 몸 상태 기록">
      {items.map((item, index) => (
        <li className="timeline-item" key={`${item.date}-${item.title}-${index}`}>
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
