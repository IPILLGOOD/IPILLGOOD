import { Accessibility, History, ShieldCheck } from "lucide-react";

import { ProfileForm } from "@/components/profile/ProfileForm";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCareSnapshot } from "@care-atlas/backend";
import { requireCareScope } from "@/lib/auth/care-scope";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const scope = await requireCareScope();
  const snapshot = await getCareSnapshot(scope);
  return (
    <>
      <PageHeader
        eyebrow="어르신 프로필"
        title="돌봄에 필요한 정보만 관리해요"
        description="정확한 복약 설명과 편한 사용을 위해 필요한 최소 정보만 입력해주세요. 각 정보의 활용 목적은 입력란 아래에서 확인할 수 있어요."
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
            <p>
              {snapshot.recipient.consentConfirmed
                ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeStyle: "short" }).format(new Date(snapshot.recipient.lastConfirmedAt))
                : "아직 프로필을 확인하지 않았어요."}
            </p>
          </Card>
        </aside>
      </div>
    </>
  );
}
