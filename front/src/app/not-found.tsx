import Link from "next/link";

import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { getSession } from "@/lib/auth/session";

export default async function NotFound() {
  const session = await getSession();

  return (
    <Card aria-label="페이지 없음 안내">
      <PageHeader
        eyebrow="404 · 페이지 없음"
        title="페이지를 찾을 수 없어요"
        description="주소가 바뀌었거나 삭제된 페이지예요. 아래 버튼으로 돌아가 다시 확인해 주세요."
      />
      <Link className="button button--primary" href={session ? "/today" : "/"}>
        {session ? "오늘 할 일로 돌아가기" : "홈으로 돌아가기"}
      </Link>
    </Card>
  );
}
