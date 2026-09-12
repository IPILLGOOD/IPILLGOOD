import {
  ArrowRight,
  CheckCircle2,
  FileText,
  MoreHorizontal,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { MedicationReminderCard } from "@/components/notifications/MedicationReminderCard";
import { TodayTaskList } from "@/components/today/TodayTaskList";
import { TodayGettingStarted } from "@/components/today/TodayGettingStarted";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { createMedicationSchedule } from "@/lib/presentation";
import { getCareSnapshot } from "@care-atlas/backend";
import { requireCareScope } from "@/lib/auth/care-scope";
import { gettingStartedGuide } from "@/lib/getting-started";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "오늘 할 일",
  description: "오늘의 복약 일정과 완료 여부를 확인합니다.",
};

export default async function TodayPage() {
  const scope = await requireCareScope();
  const snapshot = await getCareSnapshot(scope, { includeClinicianQuestions: false });
  const guide = gettingStartedGuide(snapshot, scope.useDemoData);
  if (guide) {
    return (
      <>
        <PageHeader
          eyebrow="오늘 할 일"
          title="나의 돌봄 공간"
          description="대상자 정보를 확인하고 첫 기록을 준비해 주세요."
        />
        <TodayGettingStarted guide={guide} />
      </>
    );
  }
  const tasks = createMedicationSchedule(
    snapshot.medications,
    snapshot.doseEvents,
  );
  const completed = tasks.filter(
    (task) => task.response === "completed",
  ).length;
  const progress =
    tasks.length === 0 ? 0 : Math.round((completed / tasks.length) * 100);
  return (
    <>
      <PageHeader
        eyebrow="오늘 할 일"
        title={`${snapshot.recipient.displayName}의 오늘 돌봄`}
        description="오늘 예정된 복용 시간과 완료 여부를 확인하세요."
      />

      <MedicationReminderCard />

      <div className="today-workspace">
        <div className="today-workspace__main">
          {tasks.length > 0 ? (
            <Card className="today-progress-card">
              <div className="today-progress-card__header">
                <div>
                  <span className="today-progress-card__eyebrow">
                    오늘 진행 상황
                  </span>
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
              <div
                className="today-dose-progress"
                role="img"
                aria-label={`오늘 복약 확인 ${tasks.length}개 중 ${completed}개 완료`}
              >
                {tasks.map((task, index) => (
                  <span
                    key={task.id}
                    className={index < completed ? "is-complete" : ""}
                    aria-hidden="true"
                  ><i /></span>
                ))}
              </div>
            </Card>
          ) : null}

          <Card className="today-tasks-card">
            <div className="section-heading today-tasks-heading">
              <div>
                <h2>오늘 복용할 것</h2>
                <p>현재 복용약의 횟수와 주기를 반영한 일정이에요.</p>
              </div>
              <Link
                className="today-tasks-heading__more"
                href="/dashboard"
                aria-label="대시보드에서 복약 기록 확인"
                title="복약 기록 확인"
              >
                <MoreHorizontal size={24} aria-hidden="true" />
              </Link>
            </div>
            {tasks.length > 0 ? (
              <TodayTaskList tasks={tasks} />
            ) : (
              <div className="empty-state" role="status">
                <CheckCircle2 size={28} aria-hidden="true" />
                <strong>오늘 예정된 복용 일정이 없어요</strong>
                <p>
                  2일 1회처럼 복용 간격이 있는 약은 해당하는 날에만 나타나요.
                </p>
              </div>
            )}
          </Card>

          <section
            className="visit-record-prompt"
            aria-labelledby="visit-record-title"
          >
            <div className="visit-record-prompt__visual" aria-hidden="true">
              <span>
                <FileText size={27} />
              </span>
            </div>
            <div className="visit-record-prompt__copy">
              <span className="visit-record-prompt__eyebrow">
                AFTER YOUR VISIT
              </span>
              <h2 id="visit-record-title">새로운 처방전이 생겼나요?</h2>
              <p>
                사진이나 PDF를 올리면 어려운 처방 내용을 쉬운 복약 정보로
                정리해드려요.
              </p>
            </div>
            <Link
              className="button button--primary visit-record-prompt__action"
              href="/documents"
            >
              내원 기록 추가 <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </section>
        </div>
      </div>
    </>
  );
}
