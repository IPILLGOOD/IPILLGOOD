import { CalendarDays, CircleHelp, Info, Pill } from "lucide-react";

import { CareTimeline } from "@/components/dashboard/CareTimeline";
import { PrintButton } from "@/components/report/PrintButton";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCareSnapshot } from "@care-atlas/backend";
import {
  activeMedications,
  adherenceSummary,
  uniqueSymptomDays,
} from "@/lib/presentation";
import { requireCareScope } from "@/lib/auth/care-scope";

export const dynamic = "force-dynamic";

export default async function ReportPage() {
  const scope = await requireCareScope();
  const snapshot = await getCareSnapshot(scope);
  const medications = activeMedications(snapshot.medications);
  const adherence = adherenceSummary(snapshot.doseEvents);
  const symptomDays = uniqueSymptomDays(snapshot.symptomEvents);

  return (
    <>
      <PageHeader
        eyebrow="Care Report · 최근 7일"
        title={`${snapshot.recipient.displayName} 돌봄 기록`}
        description="보호자와 어르신이 답한 내용을 의료진·약사와 이야기하기 쉽게 정리했어요."
        action={<PrintButton />}
      />

      <div className="report-layout">
        <div className="report-main">
          <Card>
            <div className="report-summary">
              <div>
                <strong>{medications.length}개</strong>
                <span>현재 복용약</span>
              </div>
              <div>
                <strong>{adherence.confirmed}/{adherence.total}회</strong>
                <span>복용 완료 응답</span>
              </div>
              <div>
                <strong>{symptomDays}일</strong>
                <span>어지러움 기록</span>
              </div>
            </div>
          </Card>

          <Card>
            <div className="section-heading">
              <div>
                <h2>현재 복용 중인 약</h2>
                <p>처방된 계획과 실제 응답 기록은 서로 다른 정보예요.</p>
              </div>
              <Pill size={21} color="var(--color-primary-700)" aria-hidden="true" />
            </div>
            <ul className="report-medication-list">
              {medications.map((medication) => (
                <li key={medication.id}>
                  <div>
                    <strong>{medication.productName}</strong>
                    {medication.isNew ? <Badge tone="info">최근 시작</Badge> : null}
                  </div>
                  <p>
                    {medication.doseAmount} · {medication.frequency} · {medication.timing}
                  </p>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <div className="section-heading">
              <div>
                <h2>약과 몸 상태의 시간 기록</h2>
                <p>원인을 판정하지 않고 기록된 시점만 함께 보여줘요.</p>
              </div>
              <CalendarDays size={21} color="var(--color-primary-700)" aria-hidden="true" />
            </div>
            <CareTimeline medications={medications} symptoms={snapshot.symptomEvents} />
          </Card>
        </div>

        <aside className="report-side">
          {snapshot.clinicianQuestions.length > 0 ? (
            <Card tone="warning">
              <div className="section-heading">
                <div>
                  <h2>의료진에게 확인할 질문</h2>
                  <p>진료나 약국 방문 때 보여주세요.</p>
                </div>
                <CircleHelp size={22} color="var(--color-warning)" aria-hidden="true" />
              </div>
              <ol className="report-questions">
                {snapshot.clinicianQuestions.map((question) => (
                  <li key={question.id}>
                    <strong>{question.question}</strong>
                    <p>{question.reason}</p>
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}

          <Card tone="soft" className="report-limit">
            <Info size={22} aria-hidden="true" />
            <div>
              <h2>이 자료의 범위</h2>
              <p>
                이 보고서는 진단서나 의료기록이 아니며, 보호자가 관찰하거나 사용자가 직접 답한
                내용을 정리한 상담 보조자료예요.
              </p>
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
