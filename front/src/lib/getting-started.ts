import type { CareSnapshot } from "@care-atlas/backend";

/** Presentation only: this does not establish onboarding completion or authorize processing. */
export function gettingStartedGuide(snapshot: CareSnapshot, isDemo = false) {
  if (isDemo || snapshot.documents.length > 0 || snapshot.medications.length > 0 ||
      snapshot.doseEvents.length > 0 || snapshot.symptomEvents.length > 0 || snapshot.todayCheckIn) {
    return null;
  }
  const consentConfirmed = snapshot.recipient.consentConfirmed === true;
  return {
    consentConfirmed,
    nextHref: consentConfirmed ? "/documents" : "/profile",
    nextLabel: consentConfirmed ? "첫 문서 등록하기" : "프로필과 동의 확인하기",
  };
}

export type GettingStartedGuide = NonNullable<ReturnType<typeof gettingStartedGuide>>;
