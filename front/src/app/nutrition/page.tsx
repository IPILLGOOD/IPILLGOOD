import Link from "next/link";
import { BookOpen, Leaf } from "lucide-react";
import { getCareSnapshot } from "@care-atlas/backend";
import { NutritionExplorer } from "@/components/nutrition/NutritionExplorer";
import { requireCareScope } from "@/lib/auth/care-scope";

export const dynamic = "force-dynamic";

export default async function NutritionPage() {
  const snapshot = await getCareSnapshot(await requireCareScope(), { includeClinicianQuestions: false });
  const conditions = (snapshot.recipient.confirmedConditions ?? []).map(
    ({ id, standardName }) => ({ id, standardName }),
  );

  return (
    <div className="nutrition-page">
      <header className="nutrition-page__heading">
        <span className="nutrition-page__icon" aria-hidden="true">
          <Leaf size={25} />
        </span>
        <p className="eyebrow">식사/영양</p>
        <h1>건강 챙기기</h1>
        <p>확인받은 질환을 바탕으로 식사에 참고할 영양 자료를 모아드려요.</p>
      </header>
      {conditions.length ? (
        <NutritionExplorer conditions={conditions} />
      ) : (
        <div className="nutrition-resource-empty">
          <BookOpen size={28} aria-hidden="true" />
          <h2>내게 필요한 자료부터 찾아보세요</h2>
          <p>먼저 프로필에서 의료진에게 확인받은 질환을 등록해주세요.</p>
          <Link className="button button--primary" href="/profile">
            질환 등록하기
          </Link>
        </div>
      )}
    </div>
  );
}
