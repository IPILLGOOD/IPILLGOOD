import { Accessibility, History, ShieldCheck } from "lucide-react";

import { ProfileForm } from "@/components/profile/ProfileForm";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCareSnapshot } from "@care-atlas/backend";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const snapshot = await getCareSnapshot();
  return (
    <>
      <PageHeader
        eyebrow="어르신 프로필"
        title="돌봄에 필요한 정보만 관리해요"
        description="정확한 복약 설명과 편한 사용을 위해 필요한 최소 정보만 입력해주세요."
      />
      <div className="profile-layout">
        <Card>
          <ProfileForm recipient={snapshot.recipient} />
        </Card>
        <aside className="profile-aside">
          <Card tone="accent">
            <ShieldCheck size={24} aria-hidden="true" />
            <h2>건강정보는 민감한 정보예요</h2>
            <p>실제 서비스에서는 별도 동의, 암호화, 보관 기간과 삭제 기능이 필요해요.</p>
          </Card>
          <Card tone="soft">
            <Accessibility size={22} aria-hidden="true" />
            <h2>선호하는 안내 방식</h2>
            <p>{snapshot.recipient.accessibilityPreferences.join(" · ")}</p>
          </Card>
          <Card tone="soft">
            <History size={22} aria-hidden="true" />
            <h2>마지막 확인</h2>
            <p>{new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeStyle: "short" }).format(new Date(snapshot.recipient.lastConfirmedAt))}</p>
          </Card>
        </aside>
      </div>
    </>
  );
}
