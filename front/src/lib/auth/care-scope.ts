import "server-only";

import {
  DEMO_RECIPIENT_ID,
  type CareDataScope,
} from "@care-atlas/backend";
import { redirect } from "next/navigation";

import { getSession, type SessionUser } from "./session";

export function careScopeFor(user: SessionUser): CareDataScope {
  if (user.provider === "demo") {
    return { recipientId: DEMO_RECIPIENT_ID, useDemoData: true };
  }

  return {
    recipientId: `google-${user.id}`,
    initialDisplayName: "돌봄 대상자",
  };
}

export async function requireCareScope() {
  const user = await getSession();
  if (!user) redirect("/login");
  return careScopeFor(user);
}
