import { formatInSeoul } from "@care-atlas/backend/dates";
import { History } from "lucide-react";

import { MedicationReminderCard } from "@/components/notifications/MedicationReminderCard";
import { PushKeyNotice } from "@/components/notifications/PushKeyNotice";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { AccountDeletionCard } from "@/components/profile/AccountDeletionCard";
import { AccountDeletionProgress } from "@/components/profile/AccountDeletionProgress";
import { HealthDataResetCard } from "@/components/profile/HealthDataResetCard";
import { HealthDataResetProgress } from "@/components/profile/HealthDataResetProgress";
import { CareConnectionCard } from "@/components/profile/CareConnectionCard";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  getCareConnection,
  getCareSnapshot,
  getAccountDeletionPolicy,
  getHealthDataReset,
  publicAccountDeletion,
  publicHealthDataReset,
} from "@care-atlas/backend";
import { careScopeFor } from "@/lib/auth/care-scope";
import { getSession } from "@/lib/auth/session";
import { getAccountDeletionReceipt } from "@/lib/auth/account-deletion-receipt";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{
    account_reauth?: string;
    health_data_reset?: string;
    restored?: string;
    onboarding?: string;
  }>;
}) {
  const deletion = await getAccountDeletionReceipt();
  if (deletion)
    return (
      <>
        <PageHeader
          eyebrow="계정 관리"
          title="회원 탈퇴 처리 상태"
          description="탈퇴 후 3개월 안에 같은 Google 계정으로 로그인하면 복구할 수 있어요."
        />
        <Card>
          <AccountDeletionProgress initial={publicAccountDeletion(deletion)} />
        </Card>
      </>
    );
  const user = await getSession();
  if (!user) redirect("/login");
  const reset =
    user.provider === "google" ? await getHealthDataReset(user.id) : null;
  if (reset && reset.status !== "completed")
    return (
      <>
        <PageHeader
          eyebrow="계정 관리"
          title="건강정보 삭제 처리 상태"
          description="중단된 단계가 있으면 남은 작업부터 안전하게 다시 처리해요."
        />
        <Card>
          <HealthDataResetProgress initial={publicHealthDataReset(reset)} />
        </Card>
      </>
    );
  const scope = careScopeFor(user);
  const snapshot = await getCareSnapshot(scope, { includeClinicianQuestions: false });
  const connection =
    user.provider === "google"
      ? await getCareConnection(user.id, { ownerDisplayName: user.name })
      : null;
  const params = await searchParams;
  const accountDeletionReauth =
    params.account_reauth === "1" ||
    params.account_reauth === "account_deletion";
  const healthDataResetReauth = params.account_reauth === "health_data_reset";
  return (
    <>
      <PageHeader
        eyebrow="이용자 프로필"
        title="돌봄에 필요한 정보만 관리해요"
        description="각 정보의 활용 목적은 입력란 아래에서 확인할 수 있어요."
      />
      <PushKeyNotice />
      <MedicationReminderCard />
      {params.onboarding === "1" && !snapshot.recipient.consentConfirmed ? (
        <p className="account-deletion-notice" role="status">
          건강정보를 처리하기 전에 대상자 정보와 동의를 먼저 확인해 주세요.
        </p>
      ) : null}
      {params.restored === "1" && (
        <p className="account-deletion-notice" role="status">
          계정과 돌봄 기록이 복구됐어요. 복약 알림은 이 기기에서 다시
          설정해주세요.
        </p>
      )}
      {params.health_data_reset === "1" && (
        <p className="account-deletion-notice" role="status">
          건강정보를 모두 삭제했어요. 같은 Google 계정으로 빈 돌봄 공간을 다시
          설정할 수 있어요.
        </p>
      )}
      <Card className="profile-settings-group">
        <header className="profile-settings-group__header">
          <span>돌봄 정보</span>
          <h2>대상자 정보 관리</h2>
          <p>필요한 항목만 펼쳐 확인하고 수정할 수 있어요.</p>
        </header>
        <ProfileForm
          recipient={snapshot.recipient}
          revision={snapshot.revision}
          onboarding={params.onboarding === "1"}
        />
        <p className="profile-last-confirmed">
          <History size={16} aria-hidden="true" />
          <span>
            마지막 확인 ·{" "}
            {snapshot.recipient.consentConfirmed
              ? formatInSeoul(snapshot.recipient.lastConfirmedAt, {
                  dateStyle: "long",
                  timeStyle: "short",
                })
              : "아직 프로필을 확인하지 않았어요."}
          </span>
        </p>
      </Card>
      {user.provider === "google" ? (
        <CareConnectionCard connection={connection} />
      ) : null}
      {user.provider !== "connected" ? (
        <Card
          className="account-settings-group"
          aria-labelledby="account-settings-group-title"
        >
          <header>
            <span>계정 설정</span>
            <h2 id="account-settings-group-title">데이터와 계정 정리</h2>
            <p>삭제 범위와 복구 가능 여부를 확인한 뒤 진행할 수 있어요.</p>
          </header>
          <div className="account-settings-list">
            {user.provider === "google" ? (
              <HealthDataResetCard
                userId={user.id}
                email={user.email}
                reauthenticating={healthDataResetReauth}
              />
            ) : null}
            <AccountDeletionCard
              userId={user.id}
              email={user.email}
              demo={user.provider === "demo"}
              policy={getAccountDeletionPolicy()}
              reauthenticating={accountDeletionReauth}
            />
          </div>
        </Card>
      ) : null}
    </>
  );
}
