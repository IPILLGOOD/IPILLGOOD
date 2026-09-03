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
  formatDate,
  uniqueSymptomDays,
} from "@/lib/presentation";
import { observationEvidenceCounts, recentCareRecords } from "@/lib/recent-care-records";
import { requireCareScope } from "@/lib/auth/care-scope";

export const dynamic = "force-dynamic";

export default async function ReportPage() {
  const scope = await requireCareScope();
  const snapshot = await getCareSnapshot(scope);
  const medications = activeMedications(snapshot.medications);
  const recent = recentCareRecords(snapshot);
  const adherence = adherenceSummary(recent.doseEvents);
  const symptomDays = uniqueSymptomDays(recent.symptomEvents);
  const doseEvidence = observationEvidenceCounts(recent.doseEvents);
  const symptomEvidence = observationEvidenceCounts(recent.symptomEvents);

  return (
    <>
      <PageHeader
        eyebrow="Care Report · 최근 7일"
        title={`${snapshot.recipient.displayName} 돌봄 기록`}
        description={`${formatDate(recent.range.startDate)}–${formatDate(recent.range.endDate)} · 오늘 포함 · 한국 시간 기준으로 답한 기록을 정리했어요.`}
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
                <strong>{adherence.total === 0 ? "기록 없음" : `${adherence.confirmed}/${adherence.total}회`}</strong>
                <span>응답 중 복용 완료</span>
              </div>
              <div>
                <strong>{symptomDays === 0 ? "기록 없음" : `${symptomDays}일`}</strong>
                <span>몸 상태 기록</span>
              </div>
            </div>
            <p className="causal-note">복약 수치는 답한 기록만 집계하며, 실제 복용 여부나 무응답 회차를 나타내지 않아요.</p>
            <div className="report-evidence-summary" aria-label="기록 근거별 건수">
              <p><strong>복약 응답 근거</strong> {doseEvidence.length ? doseEvidence.map((item) => `${item.label} ${item.count}건`).join(" · ") : "기록 없음"}</p>
              <p><strong>몸 상태 근거</strong> {symptomEvidence.length ? symptomEvidence.map((item) => `${item.label} ${item.count}건`).join(" · ") : "기록 없음"}</p>
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
            <CareTimeline medications={recent.medications} symptoms={recent.symptomEvents} />
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
                    {question.status === "answered" ? (
                      <p><strong>답변 완료:</strong> {question.answer}</p>
                    ) : question.status === "resolved" ? (
                      <p><strong>해결됨</strong></p>
                    ) : question.status === "open" ? (
                      <p><strong>아직 답하지 않음</strong></p>
                    ) : null}
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
