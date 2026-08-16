import {
  ArrowLeft,
  CalendarClock,
  CircleHelp,
  Info,
  PackageCheck,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { createMedicationSchedule, formatDate } from "@/lib/presentation";
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
        description={`${medication.ingredientName} · ${medication.purposePlain}`}
        action={
          <div className="medication-category-badges" aria-label="약 분류 및 상태">
            <Badge tone="success">{medication.categoryPlain ?? "분류 확인 필요"}</Badge>
            {medication.isNew ? <Badge tone="info">최근 시작한 약</Badge> : null}
          </div>
        }
      />

      <div className="medication-detail-page">
        <div className="medication-detail-page__main">
          <Card tone="accent">
            <div className="detail-section-heading">
              <Sparkles size={22} aria-hidden="true" />
              <div>
                <h2>어떤 도움을 주는 약인가요?</h2>
                <p>{medication.descriptionPlain}</p>
              </div>
            </div>
            <div className="plain-explanation detail-explanation">
              <strong>몸에서는 이렇게 작용해요</strong>
              <p>
                {medication.howItWorksPlain ??
                  "몸의 불편함을 줄이는 데 사용되는 약이에요. 자세한 작용은 의사나 약사에게 확인해주세요."}
              </p>
            </div>
          </Card>

          {id !== "med-amlodipine" ? (
            <Card>
              <div className="section-heading">
                <div>
                  <h2>먹는 방법과 오늘 일정</h2>
                  <p>처방전에서 보호자가 확인한 복용 계획이에요.</p>
                </div>
                <CalendarClock size={21} color="var(--color-primary-700)" aria-hidden="true" />
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
                <div>
                  <dt>먹는 시점</dt>
                  <dd>{medication.timing}</dd>
                </div>
              </dl>
              {schedule.length > 0 ? (
                <ul className="detail-schedule">
                  {schedule.map((task) => (
                    <li key={task.id}>
                      <time dateTime={task.scheduledAt}>{task.timeLabel}</time>
                      <span>{task.slotLabel}</span>
                      <Badge tone={task.response === "completed" ? "success" : "neutral"}>
                        {task.response === "completed" ? "확인 완료" : "복용 예정"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="detail-empty-schedule">복용 간격에 따라 오늘은 예정된 일정이 없어요.</p>
              )}
            </Card>
          ) : null}

          <div className="detail-two-column">
            <Card>
              <div className="detail-section-heading">
                <Info size={21} aria-hidden="true" />
                <div>
                  <h2>흔히 느낄 수 있는 변화</h2>
                  <p>모든 사람에게 나타나는 것은 아니에요.</p>
                </div>
              </div>
              <ul className="watch-list">
                {(medication.commonEffects ?? medication.watchFor).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Card>
            <Card tone="warning">
              <div className="detail-section-heading">
                <TriangleAlert size={21} aria-hidden="true" />
                <div>
                  <h2>보호자가 주의할 점</h2>
                  <p>부양자의 특성을 고려하여 알려드려요.</p>
                </div>
              </div>
              <ul className="watch-list">
                {(medication.precautions ?? medication.watchFor).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Card>
          </div>
        </div>

        <aside className="medication-detail-page__side">
          <Card>
            <div className="detail-section-heading">
              <CircleHelp size={21} aria-hidden="true" />
              <div>
                <h2>상담 때 물어보기</h2>
                <p>{medication.clinicianQuestion ?? "이 약을 먹으며 어떤 변화를 기록하면 좋을까요?"}</p>
              </div>
            </div>
          </Card>
          <Card tone="soft">
            <div className="detail-section-heading">
              <PackageCheck size={21} aria-hidden="true" />
              <div>
                <h2>보관 방법</h2>
                <p>
                  {medication.storagePlain ??
                    "원래 포장에 넣어 습기와 햇빛을 피해 보관해주세요."}
                </p>
              </div>
            </div>
          </Card>
          <Card className="detail-source-card">
            <ShieldCheck size={20} aria-hidden="true" />
            <div>
              <strong>확인한 정보</strong>
              <p>{medication.sourceLabel}</p>
              <small>
                {formatDate(medication.startDate)} 시작
                {medication.endDate ? ` · ${formatDate(medication.endDate)}까지` : ""}
              </small>
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
