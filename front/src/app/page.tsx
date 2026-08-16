import {
  ArrowRight,
  CheckCircle2,
  FileText,
  ListChecks,
} from "lucide-react";
import Link from "next/link";

import { TodayTaskList } from "@/components/today/TodayTaskList";
import { TodayQuickCheckIn } from "@/components/today/TodayQuickCheckIn";
import { Card } from "@/components/ui/Card";
import { ConnectionStatus } from "@/components/ui/ConnectionStatus";
import { PageHeader } from "@/components/ui/PageHeader";
import { createMedicationSchedule } from "@/lib/presentation";
import { getCareSnapshot, getTodayDailyCheckIn } from "@care-atlas/backend";
import type { DailyCheckIn } from "@care-atlas/backend";

export const dynamic = "force-dynamic";

const seoulDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export default async function TodayPage() {
  const [snapshot, todayCheckIn] = await Promise.all([
    getCareSnapshot(),
    getTodayDailyCheckIn(),
  ]);
  const tasks = createMedicationSchedule(snapshot.medications, snapshot.doseEvents);
  const dateKey = seoulDateFormatter.format(new Date());
  const todaySymptoms = snapshot.symptomEvents.filter(
    (event) => seoulDateFormatter.format(new Date(event.occurredAt)) === dateKey,
  );
  const fallbackCheckIn: DailyCheckIn | null = todaySymptoms[0]
    ? {
        id: dateKey,
        completedAt: todaySymptoms[0].occurredAt,
        completedBy:
          todaySymptoms[0].reporterType === "caregiver_observed"
            ? "caregiver"
            : "recipient",
        medicationResponses: [],
        symptoms: [...new Set(todaySymptoms.map((event) => event.symptomType))],
        severity: Math.max(...todaySymptoms.map((event) => event.severity)),
        note: todaySymptoms[0].note ?? "",
      }
    : null;
  const checkIn = todayCheckIn ?? fallbackCheckIn;
  const completed = tasks.filter((task) => task.response === "completed").length;
  const progress = tasks.length === 0 ? 0 : Math.round((completed / tasks.length) * 100);

  return (
    <>
      <PageHeader
        eyebrow="오늘 할 일"
        title={`${snapshot.recipient.displayName}의 오늘 돌봄`}
        description="복용 시간과 완료 여부를 먼저 확인하고, 몸 상태까지 한 번에 기록하세요."
        action={<ConnectionStatus source={snapshot.dataSource} />}
      />

      <div className="today-workspace">
        <div className="today-workspace__main">
          <Card className="today-progress-card">
            <div className="today-progress-card__header">
              <div>
                <span className="today-progress-card__eyebrow">오늘 진행 상황</span>
                <strong>
                  {completed}/{tasks.length}개 완료
                </strong>
                <p>
                  {completed === tasks.length && tasks.length > 0
                    ? "오늘 예정된 복약 확인을 모두 마쳤어요."
                    : `남은 복약 확인 ${Math.max(tasks.length - completed, 0)}개가 있어요.`}
                </p>
              </div>
              <span className="today-progress-card__value">{progress}%</span>
            </div>
            <progress
              className="today-progress"
              aria-label="오늘 복약 확인 진행률"
              max={100}
              value={progress}
            />
          </Card>

          <Card>
            <div className="section-heading">
              <div>
                <h2>오늘 해야 하는 일</h2>
                <p>현재 복용약의 횟수와 주기를 반영한 일정이에요.</p>
              </div>
              <Link className="button button--quiet" href="/medications">
                복용약 보기 <ArrowRight size={17} aria-hidden="true" />
              </Link>
            </div>
            {tasks.length > 0 ? (
              <TodayTaskList tasks={tasks} />
            ) : (
              <div className="empty-state" role="status">
                <CheckCircle2 size={28} aria-hidden="true" />
                <strong>오늘 예정된 복용 일정이 없어요</strong>
                <p>2일 1회처럼 복용 간격이 있는 약은 해당하는 날에만 나타나요.</p>
              </div>
            )}
          </Card>

          <div className="today-quick-actions">
            <Link className="today-action-card" href="/documents">
              <FileText size={21} aria-hidden="true" />
              <span>
                <strong>새 문서 분석</strong>
                <small>처방전·진단서 내용을 쉬운 말로 확인</small>
              </span>
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link className="today-action-card" href="/dashboard">
              <ListChecks size={21} aria-hidden="true" />
              <span>
                <strong>돌봄 대시보드</strong>
                <small>최근 7일 기록과 상담 질문 확인</small>
              </span>
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </div>

        <aside className="today-checklist">
          <Card tone="accent">
            <TodayQuickCheckIn tasks={tasks} checkIn={checkIn} />
          </Card>
        </aside>
      </div>
    </>
  );
}
