import "server-only";

import {
  isEphemeralDemoSessionId,
  isServiceCareProfileComplete,
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

  if (user.provider === "connected") {
    if (!user.recipientId || !/^google-[A-Za-z0-9_-]{1,128}$/.test(user.recipientId)) {
      throw new Error("올바르지 않은 연결 사용자 세션입니다.");
    }
    if (!user.connectionId || !user.sessionVersion) throw new Error("올바르지 않은 연결 사용자 세션입니다.");
    return {
      recipientId: user.recipientId,
      connection: { connectionId: user.connectionId, sessionVersion: user.sessionVersion },
    };
  }

  return { recipientId: `google-${user.id}` };
}

export async function requireCareScope() {
  const user = await getSession();
  if (!user) redirect("/login");
  const scope = careScopeFor(user);
  if (!scope.useDemoData && !await isServiceCareProfileComplete(scope.recipientId)) {
    redirect("/profile?onboarding=1");
  }
  return scope;
}
