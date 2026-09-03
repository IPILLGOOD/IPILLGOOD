import {
  ArrowRight,
  CalendarCheck2,
  ChevronRight,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";

import { CareDiaryCalendar } from "@/components/dashboard/CareDiaryCalendar";
import { MedicationSummaryList } from "@/components/dashboard/MedicationSummaryList";
import { UnansweredDoseSummary } from "@/components/dashboard/UnansweredDoseSummary";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCareSnapshot } from "@care-atlas/backend";
import {
  activeMedications,
  createMedicationSchedule,
  formatDate,
  uniqueSymptomDays,
} from "@/lib/presentation";
import { recentCareRecords } from "@/lib/recent-care-records";
import { requireCareScope } from "@/lib/auth/care-scope";
import { dateKeyInSeoul } from "@care-atlas/backend/dates";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const scope = await requireCareScope();
  const snapshot = await getCareSnapshot(scope);
  const medications = activeMedications(snapshot.medications);
  const recent = recentCareRecords(snapshot);
  const todayTasks = createMedicationSchedule(snapshot.medications, snapshot.doseEvents);
  const calendarDoses = [
    ...snapshot.doseEvents,
    ...todayTasks
      .filter((task) => !snapshot.doseEvents.some((event) => event.medicationPlanId === task.medicationPlanId && event.scheduledAt === task.scheduledAt))
      .map((task) => ({
        id: task.id,
        medicationPlanId: task.medicationPlanId,
        scheduledAt: task.scheduledAt,
        response: task.response,
        answeredBy: "caregiver" as const,
      })),
  ];
  const symptomDays = uniqueSymptomDays(recent.symptomEvents);
  const dizzinessDays = uniqueSymptomDays(
    recent.symptomEvents.filter((event) => event.symptomType === "어지러움"),
  );

  return (
    <>
      <PageHeader
        eyebrow="돌봄 대시보드"
        title={`${snapshot.recipient.displayName}의 돌봄 다이어리`}
        description="달력에서 매일의 복약 일정과 몸 상태 기록을 한눈에 확인하세요."
      />

      <div className="dashboard-grid">
        <div className="dashboard-main">
          <CareDiaryCalendar
            initialDate={dateKeyInSeoul()}
            medications={medications}
            doses={calendarDoses}
            symptoms={snapshot.symptomEvents}
            revision={snapshot.revision}
          />

          <Card>
            <div className="section-heading">
              <div>
                <h2>현재 먹고 있는 약</h2>
                <p>복용량·횟수·기간을 나누어 보여드려요.</p>
              </div>
              <Link className="button button--quiet" href="/medications">
                자세히 <ChevronRight size={17} aria-hidden="true" />
              </Link>
            </div>
            <MedicationSummaryList medications={medications} />
          </Card>
        </div>

        <aside className="dashboard-side" aria-label="돌봄 요약">
          <Card>
            <div className="section-heading">
              <div>
                <h2>최근 7일 요약</h2>
                <p>{formatDate(recent.range.startDate)}–{formatDate(recent.range.endDate)} · 오늘 포함 · 한국 시간</p>
              </div>
              <CalendarCheck2 size={21} color="var(--color-primary-700)" aria-hidden="true" />
            </div>
            <div className="metric-row">
              <UnansweredDoseSummary
                doses={recent.doseEvents}
                medications={medications}
                today={dateKeyInSeoul()}
              />
              <div className="metric">
                <strong>{symptomDays === 0 ? "기록 없음" : `${symptomDays}일`}</strong>
                <span>몸 상태 기록</span>
              </div>
              <div className="metric">
                <strong>{medications.length}개</strong>
                <span>현재 복용약</span>
              </div>
            </div>
            <p className="causal-note">복약 수치는 답한 기록만 집계하며, 실제 복용 여부나 무응답 회차를 나타내지 않아요.</p>
          </Card>

          {dizzinessDays >= 3 ? (
            <Card tone="warning" className="signal-card">
              <div className="signal-card__headline">
                <TriangleAlert size={22} aria-hidden="true" />
                <div>
                  <Badge tone="warning">함께 확인하기</Badge>
                  <h2>어지러움이 {dizzinessDays}일 기록됐어요</h2>
                </div>
              </div>
              <p>
                기록이 반복되고 있지만, 약 때문이라고 판단할 수는 없어요. 기록을 보여주며
                의료진이나 약사에게 확인해보세요.
              </p>
              <Link className="button button--secondary" href="/report">
                상담용 기록 보기 <ArrowRight size={17} aria-hidden="true" />
              </Link>
            </Card>
          ) : null}

        </aside>
      </div>
    </>
  );
}
