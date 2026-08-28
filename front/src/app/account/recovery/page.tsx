import { publicAccountDeletion } from "@care-atlas/backend";
import { redirect } from "next/navigation";
import { AccountRecoveryPanel } from "@/components/profile/AccountRecoveryPanel";
import { getAccountRecoverySession } from "@/lib/auth/account-recovery-session";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AccountRecoveryPage() {
  if (await getSession()) redirect("/profile");
  const recovery = await getAccountRecoverySession();
  if (!recovery) redirect("/login");
  return <AccountRecoveryPanel initial={publicAccountDeletion(recovery.job)} email={recovery.user.email} />;
}
