import { ChevronRight, Pill } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/Badge";
import type { MedicationPlan } from "@care-atlas/backend";

function seoulDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function daysSince(date: string, now = new Date()) {
  const [startYear, startMonth, startDay] = seoulDateKey(date).split("-").map(Number);
  const [endYear, endMonth, endDay] = seoulDateKey(now).split("-").map(Number);
  const elapsed = Date.UTC(endYear!, endMonth! - 1, endDay!) - Date.UTC(startYear!, startMonth! - 1, startDay!);
  return Math.max(1, Math.round(elapsed / 86_400_000) + 1);
}

export function MedicationSummaryList({ medications }: { medications: MedicationPlan[] }) {
  return (
    <ul className="medication-list" aria-label="현재 복용 중인 약">
      {medications.map((medication) => (
        <li className="medication-row" key={medication.id}>
          <span className="pill-mark" aria-hidden="true">
            <Pill size={20} />
          </span>
          <div>
            <div className="medication-row__name">
              <strong>{medication.productName}</strong>
              {medication.isNew ? <Badge tone="info">새로 시작</Badge> : null}
            </div>
            <p>{medication.purposePlain}</p>
            <small>
              {medication.doseAmount} · {medication.frequency} · 복용 {daysSince(medication.startDate)}일째
            </small>
          </div>
          <Link
            className="medication-row__detail"
            href={`/medications/${medication.id}`}
            aria-label={`${medication.productName} 상세 정보 보기`}
          >
            <span>{medication.timing}</span>
            <ChevronRight size={17} aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
