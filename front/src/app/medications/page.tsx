import { Pill, Plus } from "lucide-react";
import Link from "next/link";

import { Card } from "@/components/ui/Card";
import { MedicationCabinet } from "@/components/medications/MedicationCabinet";
import { MedicationSearchAdd } from "@/components/medications/MedicationSearchAdd";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  getCareSnapshot,
  PRODUCT_SOURCE_URL,
  searchOfficialMedicationInfo,
  withCareAccountProcessing,
  type OfficialMedicationLookupResult,
} from "@care-atlas/backend";
import { activeMedications, daysSince, formatDate } from "@/lib/presentation";
import { requireCareScope } from "@/lib/auth/care-scope";
import { enforceRateLimit } from "@/lib/rate-limit";
import { dateKeyInSeoul } from "@care-atlas/backend/dates";

export const dynamic = "force-dynamic";

export default async function MedicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; add?: string | string[] }>;
}) {
  const scope = await requireCareScope();
  const params = await searchParams;
  const queryValue = Array.isArray(params.q) ? params.q[0] : params.q;
  const query = queryValue?.trim().slice(0, 100) ?? "";
  const adding = params.add === "1" || query.length > 0;
  const rateLimit = query
    ? await enforceRateLimit("medicationSearch", { userId: scope.recipientId })
    : null;
  const limitedResult: OfficialMedicationLookupResult = {
    status: "unavailable",
    items: [],
    totalCount: 0,
    sourceUrl: PRODUCT_SOURCE_URL,
    message: `검색 요청이 많아요. ${rateLimit?.retryAfterSeconds ?? 60}초 뒤 다시 시도해주세요.`,
    reason: "rate_limited",
  };
  const [snapshot, result] = await Promise.all([
    getCareSnapshot(scope),
    query
      ? rateLimit?.allowed
        ? withCareAccountProcessing(scope.recipientId, () =>
            searchOfficialMedicationInfo(query, { openAiApiKey: "" }),
          )
        : Promise.resolve(limitedResult)
      : Promise.resolve(null),
  ]);
  const medications = activeMedications(snapshot.medications);

  return (
    <>
      <PageHeader
        eyebrow="현재 복용약"
        title="약 설명을 쉬운 말로 확인하세요"
        description="따로 등록 할 수도 있어요."
        action={
          <Link className="button button--primary" href="/medications?add=1">
            <Plus size={17} aria-hidden="true" /> 약 검색해서 추가
          </Link>
        }
      />

      {adding ? (
        <MedicationSearchAdd
          query={query}
          result={result}
          revision={snapshot.revision}
          today={dateKeyInSeoul()}
        />
      ) : null}

      {medications.length > 0 ? (
        <MedicationCabinet
          revision={snapshot.revision}
          medications={medications.map((medication) => ({
            id: medication.id,
            productName: medication.productName,
            ingredientName: medication.ingredientName,
            category: medication.categoryPlain ?? "분류 확인 필요",
            isNew: medication.isNew,
            purpose: medication.purposePlain,
            dose: medication.doseAmount.replace("한 번에 ", ""),
            frequency: medication.frequency,
            timing: medication.timing,
            startSummary: `${formatDate(medication.startDate)} 시작 · ${daysSince(medication.startDate)}일째${medication.endDate ? ` · ${formatDate(medication.endDate)}까지` : ""}`,
            sourceLabel: medication.sourceLabel,
            clinicianQuestion: medication.clinicianQuestion,
            itemSeq: medication.itemSeq,
            needsExplanation:
              medication.purposePlain ===
                "처방 목적은 의사나 약사에게 확인해주세요." &&
              medication.descriptionPlain ===
                "식약처 검색 결과에서 사용자가 직접 등록한 복용약이에요.",
          }))}
        />
      ) : null}

      <div className="medication-cards">
        {medications.length === 0 ? (
          <Card>
            <div className="empty-state" role="status">
              <Pill size={28} aria-hidden="true" />
              <strong>아직 등록된 복용약이 없어요</strong>
              <p>
                문서 메뉴에서 약봉투나 처방전을 등록하면 복용약을 추가하고
                검토할 수 있어요.
              </p>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
