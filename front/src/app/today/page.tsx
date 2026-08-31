import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  FileText,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { MedicationReminderCard } from "@/components/notifications/MedicationReminderCard";
import { TodayTaskList } from "@/components/today/TodayTaskList";
import { TodayGettingStarted } from "@/components/today/TodayGettingStarted";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { createMedicationSchedule } from "@/lib/presentation";
import { getCareSnapshot } from "@care-atlas/backend";
import { requireCareScope } from "@/lib/auth/care-scope";
import { gettingStartedGuide } from "@/lib/getting-started";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "오늘 할 일",
  description: "오늘의 복약 일정과 몸 상태를 한 번에 확인하고 기록합니다.",
};



export default async function TodayPage() {
  const scope = await requireCareScope();
  const snapshot = await getCareSnapshot(scope);
  const guide = gettingStartedGuide(snapshot, scope.useDemoData);
  if (guide) {
    return (
      <>
        <PageHeader eyebrow="오늘 할 일" title="나의 돌봄 공간" description="대상자 정보를 확인하고 첫 기록을 준비해 주세요." />
        <TodayGettingStarted guide={guide} />
      </>
    );
  }
  const tasks = createMedicationSchedule(snapshot.medications, snapshot.doseEvents);
  const completed = tasks.filter((task) => task.response === "completed").length;
  const progress = tasks.length === 0 ? 0 : Math.round((completed / tasks.length) * 100);
  const todayCheckIn = snapshot.todayCheckIn;
  const checkInTime = todayCheckIn
    ? new Intl.DateTimeFormat("ko-KR", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "Asia/Seoul",
      }).format(new Date(todayCheckIn.completedAt))
    : null;

  return (
    <>
      <PageHeader
        eyebrow="오늘 할 일"
        title={`${snapshot.recipient.displayName}의 오늘 돌봄`}
        description="복용 시간과 완료 여부를 먼저 확인하고, 몸 상태까지 한 번에 기록하세요."
      />

      <MedicationReminderCard />

      <div className="today-workspace">
        <div className="today-workspace__main">
          <Card className={`today-card${todayCheckIn ? " today-card--completed" : ""}`}>
            <div className="today-card__content">
              <div className="today-card__copy">
                <span className="today-card__icon" aria-hidden="true">
                  {todayCheckIn ? <CheckCircle2 size={24} /> : <ClipboardCheck size={24} />}
                </span>
                <div>
                  <Badge tone="success">{todayCheckIn ? "오늘 완료" : "약 1분"}</Badge>
                  <h2>{todayCheckIn ? "오늘의 안부를 기록했어요" : "오늘의 안부를 확인할 시간이에요"}</h2>
                  <p>
                    {todayCheckIn
                      ? `${todayCheckIn.completedBy === "caregiver" ? "보호자" : "어르신"}가 ${checkInTime}에 남긴 기록이에요. 필요한 내용만 다시 수정할 수 있어요.`
                      : "복용 여부와 어지러움 같은 몸 상태를 짧게 물어볼게요."}
                  </p>
                </div>
              </div>
              <Link className="button button--primary" href="/check-in">
                {todayCheckIn ? "내용 수정" : "확인 시작"} <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </div>
          </Card>

          {tasks.length > 0 ? <Card className="today-progress-card">
            <div className="today-progress-card__header">
              <div>
                <span className="today-progress-card__eyebrow">오늘 진행 상황</span>
                <strong>{completed}/{tasks.length}개 완료</strong>
                <p>
                  {completed === tasks.length && tasks.length > 0
                    ? "오늘 예정된 복약 확인을 모두 마쳤어요."
                    : `남은 복약 확인 ${Math.max(tasks.length - completed, 0)}개가 있어요.`}
                </p>
              </div>
              <span className="today-progress-card__value">{progress}%</span>
            </div>
            <progress className="today-progress" aria-label="오늘 복약 확인 진행률" max={100} value={progress} />
          </Card> : null}

          <Card className="today-tasks-card">
            <div className="section-heading today-tasks-heading">
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
              <span><strong>내원 기록 추가하기</strong><small>처방전·진단서 내용을 쉬운 말로 확인</small></span>
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
