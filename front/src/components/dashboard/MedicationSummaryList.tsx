import { ChevronRight, Pill } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/Badge";
import { daysSince } from "@/lib/presentation";
import type { MedicationPlan } from "@care-atlas/backend";

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
