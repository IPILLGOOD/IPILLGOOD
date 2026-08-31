import { Pill } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { MedicationCabinet } from "@/components/medications/MedicationCabinet";
import { OfficialMedicationSearch } from "@/components/medications/OfficialMedicationSearch";
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
  const limitedResult: OfficialMedicationLookupResult = {
    status: "unavailable",
    items: [],
    totalCount: 0,
    sourceUrl: PRODUCT_SOURCE_URL,
    message: `검색 요청이 많아요. ${rateLimit?.retryAfterSeconds ?? 60}초 뒤 다시 시도해주세요.`,
    reason: "rate_limited",
  };
  const [snapshot, officialMedicationResult] = await Promise.all([
    getCareSnapshot(scope),
    query
      ? rateLimit?.allowed
        ? withCareAccountProcessing(scope.recipientId, () => searchOfficialMedicationInfo(query))
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
        officialApiConfigured={Boolean(
          process.env.MFDS_MEDICATION_API_KEY ?? process.env.MFDS_PARMGEN_API_KEY,
        )}
      />

      {medications.length > 0 ? (
        <MedicationCabinet
          medications={medications.map((medication) => ({
            id: medication.id,
            productName: medication.productName,
            ingredientName: medication.ingredientName,
            category: medication.categoryPlain ?? "분류 확인 필요",
            isNew: medication.isNew,
            purpose: medication.purposePlain,
            description: medication.descriptionPlain,
            dose: medication.doseAmount.replace("한 번에 ", ""),
            frequency: medication.frequency,
            timing: medication.timing,
            watchFor: medication.watchFor,
            startSummary: `${formatDate(medication.startDate)} 시작 · ${daysSince(medication.startDate)}일째${medication.endDate ? ` · ${formatDate(medication.endDate)}까지` : ""}`,
            sourceLabel: medication.sourceLabel,
            clinicianQuestion: medication.clinicianQuestion,
          }))}
        />
      ) : null}

      <div className="medication-cards">
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
