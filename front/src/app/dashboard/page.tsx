import { CareDiaryCalendar } from "@/components/dashboard/CareDiaryCalendar";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCareSnapshot } from "@care-atlas/backend";
import {
  activeMedications,
  createMedicationSchedule,
} from "@/lib/presentation";
import { requireCareScope } from "@/lib/auth/care-scope";
import { dateKeyInSeoul } from "@care-atlas/backend/dates";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const scope = await requireCareScope();
  const snapshot = await getCareSnapshot(scope);
  const medications = activeMedications(snapshot.medications);
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
  return (
    <>
      <PageHeader
        appearance="new-work"
        eyebrow="돌봄 대시보드"
        title={`${snapshot.recipient.displayName}의 돌봄 다이어리`}
        description="달력에서 매일의 복약 일정과 몸 상태 기록을 한눈에 확인하세요."
      />

      <CareDiaryCalendar
        initialDate={dateKeyInSeoul()}
        medications={medications}
        doses={calendarDoses}
        symptoms={snapshot.symptomEvents}
        revision={snapshot.revision}
      />
    </>
  );
}
