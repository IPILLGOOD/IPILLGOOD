// Product policy confirmed for #99: three calendar months, then permanent erasure.
// This does not resolve the unrelated consent/access questions in #62/#88.
const policy = {
  version: "withdrawal-three-months-v1",
  softDeleteMonths: 3,
  notice: "탈퇴 즉시 서비스 이용과 AI 처리·알림 발송이 중단돼요. 계정과 돌봄 기록은 탈퇴일부터 3개월간 복구를 위해 보관해요. 그 안에 같은 Google 계정으로 로그인하고 복구를 확인하면 다시 이용할 수 있어요. 복구하지 않으면 3개월 후 영구 삭제하며, 이후에는 되돌릴 수 없어요.",
} as const;

export type AccountDeletionPolicy = typeof policy;
export function getAccountDeletionPolicy(): AccountDeletionPolicy { return { ...policy }; }

/** Seoul calendar months, clamped to the last day when the target month is shorter. */
export function accountDeletionDeadline(requestedAt: Date) {
  if (!Number.isFinite(requestedAt.getTime())) throw new Error("INVALID_DELETION_DATE");
  const seoul = new Date(requestedAt.getTime() + 9 * 3_600_000);
  const day = seoul.getUTCDate();
  seoul.setUTCDate(1);
  seoul.setUTCMonth(seoul.getUTCMonth() + policy.softDeleteMonths);
  const lastDay = new Date(Date.UTC(seoul.getUTCFullYear(), seoul.getUTCMonth() + 1, 0)).getUTCDate();
  seoul.setUTCDate(Math.min(day, lastDay));
  return new Date(seoul.getTime() - 9 * 3_600_000).toISOString();
}

export function assertRecentAccountAuthentication(input: { userId: string; tokenUserId: string; authTime: number; now?: Date }) {
  if (input.userId !== input.tokenUserId) throw new Error("ACCOUNT_MISMATCH");
  const age = Math.floor((input.now ?? new Date()).getTime() / 1000) - input.authTime;
  if (!Number.isInteger(input.authTime) || age < 0 || age > 300) throw new Error("REAUTHENTICATION_REQUIRED");
}
