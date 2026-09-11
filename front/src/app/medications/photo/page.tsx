import Link from "next/link";
import { requireCareScope } from "@/lib/auth/care-scope";
import { PageHeader } from "@/components/ui/PageHeader";
import { PillPhotoForm } from "@/components/pills/PillPhotoForm";
export const dynamic = "force-dynamic";
export const metadata = { title: "알약 사진 비교" };
export default async function PillPhotoPage() {
  await requireCareScope();
  return <><PageHeader eyebrow="알약 사진 비교" title="앞뒤 사진으로 비교 후보 찾기" description="사진에서 읽은 외형과 각인을 식약처 공식 목록과 비교해요."
    action={<Link className="button button--secondary" href="/medications">복용약으로 돌아가기</Link>} />
    <PillPhotoForm /></>;
}
