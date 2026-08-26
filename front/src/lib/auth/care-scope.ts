import "server-only";

import {
  isEphemeralDemoSessionId,
  type CareDataScope,
} from "@care-atlas/backend";
import { redirect } from "next/navigation";

import { getSession, type SessionUser } from "./session";

export function careScopeFor(user: SessionUser): CareDataScope {
  if (user.provider === "demo") {
    if (!isEphemeralDemoSessionId(user.id)) {
      throw new Error("만료되었거나 올바르지 않은 데모 세션입니다.");
    }
    return { recipientId: user.id, useDemoData: true };
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
