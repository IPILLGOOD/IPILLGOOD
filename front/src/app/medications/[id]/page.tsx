import { ArrowLeft, CalendarClock, Info, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { MedicationExplanationRefresh } from "@/components/medications/MedicationCabinet";
import { PageHeader } from "@/components/ui/PageHeader";
import { createMedicationSchedule } from "@/lib/presentation";
import { getCareSnapshot } from "@care-atlas/backend";
import { requireCareScope } from "@/lib/auth/care-scope";

export const dynamic = "force-dynamic";

export default async function MedicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scope = await requireCareScope();
  const snapshot = await getCareSnapshot(scope);
  const medication = snapshot.medications.find((item) => item.id === id);
  if (!medication) notFound();

  const schedule = createMedicationSchedule([medication], snapshot.doseEvents);

  return (
    <>
      <Link className="back-link" href="/medications">
        <ArrowLeft size={17} aria-hidden="true" /> 현재 복용약으로 돌아가기
      </Link>
      <PageHeader
        eyebrow="약 상세 정보"
        title={medication.productName}
        description={`성분명 · ${medication.ingredientName}`}
        action={
          <div
            className="medication-category-badges"
            aria-label="약 분류 및 상태"
          >
            <Badge tone="success">
              {medication.categoryPlain ?? "분류 확인 필요"}
            </Badge>
            {medication.isNew ? (
              <Badge tone="info">최근 시작한 약</Badge>
            ) : null}
          </div>
        }
      />

      <div className="medication-detail-page">
        <div className="medication-detail-page__main">
          <Card tone="accent">
            <div className="detail-section-heading">
              <Sparkles size={22} aria-hidden="true" />
              <div>
                <h2>이 약을 쉽게 설명하면</h2>
                <p>{medication.purposePlain}</p>
              </div>
            </div>
          </Card>

          {id !== "med-amlodipine" ? (
            <Card>
              <div className="section-heading">
                <div>
                  <h2>먹는 방법</h2>
                  <p>복용량을 확인하고 아래에서 오늘 시간을 살펴보세요.</p>
                </div>
                <CalendarClock
                  size={21}
                  color="var(--color-primary-700)"
                  aria-hidden="true"
                />
              </div>
              <dl className="medication-facts medication-facts--detail">
                <div>
                  <dt>한 번에</dt>
                  <dd>{medication.doseAmount}</dd>
                </div>
                <div>
                  <dt>복용 주기</dt>
                  <dd>{medication.frequency}</dd>
                </div>
              </dl>
              {schedule.length > 0 ? (
                <ul className="detail-schedule">
                  {schedule.map((task) => (
                    <li key={task.id}>
                      <time dateTime={task.scheduledAt}>{task.timeLabel}</time>
                      <span>{task.slotLabel.replace(/\s+\d{2}:\d{2}$/, "")}</span>
                      <Badge
                        tone={
                          task.response === "completed" ? "success" : "neutral"
                        }
                      >
                        {task.response === "completed"
                          ? "확인 완료"
                          : "복용 예정"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="detail-empty-schedule">
                  복용 간격에 따라 오늘은 예정된 일정이 없어요.
                </p>
              )}
            </Card>
          ) : null}

          <Card>
            <div className="detail-section-heading">
              <Info size={21} aria-hidden="true" />
              <div>
                <h2>흔히 느낄 수 있는 변화</h2>
              </div>
            </div>
            {medication.commonEffects?.length ? (
              <ul className="watch-list">
                {medication.commonEffects.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <div className="detail-empty-schedule">
                <p>아직 쉬운 변화 설명을 만들지 않았어요.</p>
                {medication.itemSeq ? (
                  <MedicationExplanationRefresh
                    medicationId={medication.id}
                    itemSeq={medication.itemSeq}
                    revision={snapshot.revision}
                    label="변화 설명 만들기"
                  />
                ) : null}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
