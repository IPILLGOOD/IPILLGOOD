import { formatInSeoul } from "@care-atlas/backend/dates";
import { History, ShieldCheck } from "lucide-react";

import { ProfileForm } from "@/components/profile/ProfileForm";
import { AccountDeletionCard } from "@/components/profile/AccountDeletionCard";
import { AccountDeletionProgress } from "@/components/profile/AccountDeletionProgress";
import { CareConnectionCard } from "@/components/profile/CareConnectionCard";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCareConnection, getCareSnapshot, getAccountDeletionPolicy, publicAccountDeletion } from "@care-atlas/backend";
import { careScopeFor } from "@/lib/auth/care-scope";
import { getSession } from "@/lib/auth/session";
import { getAccountDeletionReceipt } from "@/lib/auth/account-deletion-receipt";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ account_reauth?: string; restored?: string; onboarding?: string }> }) {
  const deletion = await getAccountDeletionReceipt();
  if (deletion) return <><PageHeader eyebrow="계정 관리" title="회원 탈퇴 처리 상태" description="탈퇴 후 3개월 안에 같은 Google 계정으로 로그인하면 복구할 수 있어요." /><Card><AccountDeletionProgress initial={publicAccountDeletion(deletion)} /></Card></>;
  const user = await getSession();
  if (!user) redirect("/login");
  const scope = careScopeFor(user);
  const snapshot = await getCareSnapshot(scope);
  const connection = user.provider === "google" ? await getCareConnection(user.id, { ownerDisplayName: user.name }) : null;
  const params = await searchParams;
  const reauthenticating = params.account_reauth === "1";
  return (
    <>
      <PageHeader
        eyebrow="어르신 프로필"
        title="돌봄에 필요한 정보만 관리해요"
        description="정확한 복약 설명과 편한 사용을 위해 필요한 최소 정보만 입력해주세요. 각 정보의 활용 목적은 입력란 아래에서 확인할 수 있어요."
      />
      {params.onboarding === "1" && !snapshot.recipient.consentConfirmed ? (
        <p className="account-deletion-notice" role="status">
          건강정보를 처리하기 전에 대상자 정보와 동의를 먼저 확인해 주세요.
        </p>
      ) : null}
      {params.restored === "1" && <p className="account-deletion-notice" role="status">계정과 돌봄 기록이 복구됐어요. 복약 알림은 이 기기에서 다시 설정해주세요.</p>}
      <div className="profile-layout">
        <Card>
          <ProfileForm recipient={snapshot.recipient} revision={snapshot.revision} onboarding={params.onboarding === "1"} />
        </Card>
        <aside className="profile-aside">
          <Card tone="accent">
            <ShieldCheck size={24} aria-hidden="true" />
            <h2>건강정보는 민감한 정보예요</h2>
            <p>실제 서비스에서는 별도 동의, 암호화, 보관 기간과 삭제 기능이 필요해요.</p>
          </Card>
          <Card tone="soft">
            <History size={22} aria-hidden="true" />
            <h2>마지막 확인</h2>
            <p>
              {snapshot.recipient.consentConfirmed
                ? formatInSeoul(snapshot.recipient.lastConfirmedAt, { dateStyle: "long", timeStyle: "short" })
                : "아직 프로필을 확인하지 않았어요."}
            </p>
          </Card>
        </aside>
      </div>
      {user.provider === "google" ? <CareConnectionCard connection={connection} /> : null}
      {user.provider !== "connected" ? <AccountDeletionCard userId={user.id} email={user.email} demo={user.provider === "demo"} policy={getAccountDeletionPolicy()} reauthenticating={reauthenticating} /> : null}
    </>
  );
}
