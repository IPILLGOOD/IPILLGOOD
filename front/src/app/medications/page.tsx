import { ArrowRight, CalendarDays, CheckCircle2, CircleHelp, Pill } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { OfficialMedicationSearch } from "@/components/medications/OfficialMedicationSearch";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  getCareSnapshot,
  searchPharmacogenomicInfo,
  withCareAccountProcessing,
  type PharmacogenomicLookupResult,
} from "@care-atlas/backend";
import { activeMedications, daysSince, formatDate } from "@/lib/presentation";
import { requireCareScope } from "@/lib/auth/care-scope";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export default async function MedicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const scope = await requireCareScope();
  const rawQuery = (await searchParams).q;
  const query = (Array.isArray(rawQuery) ? rawQuery[0] : rawQuery)?.trim().slice(0, 100) ?? "";
  const rateLimit = query
    ? await enforceRateLimit("medicationSearch", { userId: scope.recipientId })
    : null;
  const limitedResult: PharmacogenomicLookupResult = {
    status: "unavailable",
    items: [],
    totalCount: 0,
    sourceUrl: "https://www.data.go.kr/data/15102548/openapi.do",
    message: `검색 요청이 많아요. ${rateLimit?.retryAfterSeconds ?? 60}초 뒤 다시 시도해주세요.`,
  };
  const [snapshot, officialMedicationResult] = await Promise.all([
    getCareSnapshot(scope),
    query
      ? rateLimit?.allowed
        ? withCareAccountProcessing(scope.recipientId, () => searchPharmacogenomicInfo(query))
        : Promise.resolve(limitedResult)
      : Promise.resolve(null),
  ]);
  const medications = activeMedications(snapshot.medications);

  return (
    <>
      <PageHeader
        eyebrow="현재 복용약"
        title="약 설명을 쉬운 말로 확인하세요"
        description="처방 목적을 추측하지 않고, 문서에서 확인된 복용법과 약의 일반적인 쓰임을 구분해 보여드려요."
      />

      <OfficialMedicationSearch
        query={query}
        result={officialMedicationResult}
        officialApiConfigured={Boolean(process.env.MFDS_PARMGEN_API_KEY)}
      />

      <div className="medication-cards">
        {medications.map((medication) => (
          <Card as="article" key={medication.id}>
            <div className="medication-detail">
              <div>
                <div className="medication-detail__title">
                  <span className="pill-mark" aria-hidden="true">
                    <Pill size={21} />
                  </span>
                  <div>
                    <div className="medication-row__name">
                      <h2>{medication.productName}</h2>
                      <Badge tone="success">{medication.categoryPlain ?? "분류 확인 필요"}</Badge>
                      {medication.isNew ? <Badge tone="info">새로 시작</Badge> : null}
                    </div>
                    <p>성분명: {medication.ingredientName}</p>
                  </div>
                </div>

                <div className="plain-explanation">
                  <strong>이 약은 무엇을 도와주나요?</strong>
                  <p>{medication.purposePlain}</p>
                </div>
                <p>{medication.descriptionPlain}</p>

                <dl className="medication-facts">
                  <div>
                    <dt>한 번에</dt>
                    <dd>{medication.doseAmount.replace("한 번에 ", "")}</dd>
                  </div>
                  <div>
                    <dt>하루 횟수</dt>
                    <dd>{medication.frequency}</dd>
                  </div>
                  <div>
                    <dt>먹는 시점</dt>
                    <dd>{medication.timing}</dd>
                  </div>
                </dl>
              </div>

              <div>
                <h3>보호자가 살펴볼 점</h3>
                <ul className="watch-list">
                  {medication.watchFor.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>

                <div className="source-line">
                  <CalendarDays size={16} aria-hidden="true" />
                  <span>
                    {formatDate(medication.startDate)} 시작 · {daysSince(medication.startDate)}일째
                    {medication.endDate ? ` · ${formatDate(medication.endDate)}까지` : ""}
                  </span>
                </div>
                <div className="source-line">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>{medication.sourceLabel}</span>
                </div>
                {medication.clinicianQuestion ? (
                  <div className="source-line">
                    <CircleHelp size={16} aria-hidden="true" />
                    <span>{medication.clinicianQuestion}</span>
                  </div>
                ) : null}
                <Link
                  className="button button--secondary medication-detail-link"
                  href={`/medications/${medication.id}`}
                >
                  상세 정보 보기 <ArrowRight size={17} aria-hidden="true" />
                </Link>
              </div>
            </div>
          </Card>
        ))}
        {medications.length === 0 ? (
          <Card>
            <div className="empty-state" role="status">
              <Pill size={28} aria-hidden="true" />
              <strong>아직 등록된 복용약이 없어요</strong>
              <p>문서 메뉴에서 처방전을 등록하면 이 계정에 복용약 정보를 모을 수 있어요.</p>
            </div>
          </Card>
        ) : null}
      </div>

      <Card tone="warning" className="safety-strip">
        <p>
          <strong>꼭 기억해주세요.</strong> 일반 안내이므로 약을 임의로 끊거나 양·횟수를
          바꾸지 말고, 의사나 약사에게 확인해주세요.
        </p>
      </Card>
    </>
  );
}
