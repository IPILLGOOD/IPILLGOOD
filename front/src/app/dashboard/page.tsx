import {
  ArrowRight,
  CalendarCheck2,
  ChevronRight,
  ClipboardCheck,
  MessageCircleQuestion,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";

import { CareTimeline } from "@/components/dashboard/CareTimeline";
import { MedicationSummaryList } from "@/components/dashboard/MedicationSummaryList";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ConnectionStatus } from "@/components/ui/ConnectionStatus";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCareSnapshot } from "@care-atlas/backend";
import {
  activeMedications,
  adherenceSummary,
  uniqueSymptomDays,
} from "@/lib/presentation";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const snapshot = await getCareSnapshot();
  const medications = activeMedications(snapshot.medications);
  const adherence = adherenceSummary(snapshot.doseEvents);
  const symptomDays = uniqueSymptomDays(snapshot.symptomEvents);

  return (
    <>
      <PageHeader
        eyebrow="돌봄 대시보드"
        title={`${snapshot.recipient.displayName}의 최근 돌봄 기록`}
        description="현재 복용약, 최근 몸 상태와 다음 상담에서 물어볼 내용을 한눈에 확인하세요."
        action={<ConnectionStatus source={snapshot.dataSource} />}
      />

      <div className="dashboard-grid">
        <div className="dashboard-main">
          <Card className="today-card">
            <div className="today-card__content">
              <div className="today-card__copy">
                <span className="today-card__icon" aria-hidden="true">
                  <ClipboardCheck size={24} />
                </span>
                <div>
                  <Badge tone="success">약 1분</Badge>
                  <h2>오늘의 안부를 확인할 시간이에요</h2>
                  <p>복용 여부와 어지러움 같은 몸 상태를 짧게 물어볼게요.</p>
                </div>
              </div>
              <Link className="button button--primary" href="/check-in">
                확인 시작 <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </div>
          </Card>

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

          <Card>
            <div className="section-heading">
              <div>
                <h2>최근 복약·몸 상태 기록</h2>
                <p>약 변화와 증상을 한 시간축에 모았어요.</p>
              </div>
              <Badge tone="neutral">최근 7일</Badge>
            </div>
            <CareTimeline medications={medications} symptoms={snapshot.symptomEvents} />
            <p className="causal-note">
              두 기록의 시기가 겹치더라도 약이 증상의 원인이라는 뜻은 아니에요.
            </p>
          </Card>
        </div>

        <aside className="dashboard-side" aria-label="돌봄 요약">
          <Card>
            <div className="section-heading">
              <div>
                <h2>최근 7일 요약</h2>
                <p>사용자가 답한 기록 기준</p>
              </div>
              <CalendarCheck2 size={21} color="var(--color-primary-700)" aria-hidden="true" />
            </div>
            <div className="metric-row">
              <div className="metric">
                <strong>{adherence.rate}%</strong>
                <span>복용 완료 응답</span>
              </div>
              <div className="metric">
                <strong>{symptomDays}일</strong>
                <span>어지러움 기록</span>
              </div>
              <div className="metric">
                <strong>{medications.length}개</strong>
                <span>현재 복용약</span>
              </div>
            </div>
          </Card>

          <Card tone="warning" className="signal-card">
            <div className="signal-card__headline">
              <TriangleAlert size={22} aria-hidden="true" />
              <div>
                <Badge tone="warning">함께 확인하기</Badge>
                <h2>어지러움이 3일 기록됐어요</h2>
              </div>
            </div>
            <p>
              새 약을 시작한 다음 날부터 기록됐지만, 약 때문이라고 판단할 수는 없어요.
              기록을 보여주며 약사에게 확인해보세요.
            </p>
            <Link className="button button--secondary" href="/report">
              상담용 기록 보기 <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </Card>

          <Card>
            <div className="section-heading">
              <div>
                <h2>의료진에게 물어볼 내용</h2>
                <p>관찰 기록을 질문으로 정리했어요.</p>
              </div>
              <MessageCircleQuestion
                size={21}
                color="var(--color-primary-700)"
                aria-hidden="true"
              />
            </div>
            <ul className="question-list">
              {snapshot.clinicianQuestions.slice(0, 2).map((question) => (
                <li className="question-item" key={question.id}>
                  <Badge tone={question.priority === "today" ? "warning" : "neutral"}>
                    {question.priority === "today" ? "오늘 확인" : "다음 진료"}
                  </Badge>
                  <strong>{question.question}</strong>
                  <p>{question.reason}</p>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </>
  );
}
