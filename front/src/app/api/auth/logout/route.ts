import {
  deleteEphemeralDemoSession,
} from "@care-atlas/backend";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { cleanupPushBinding, getPushSessionKey, readPushBinding, writePushBinding } from "@/lib/push/server-binding";
import { isSameOriginRequest } from "@/lib/api-security";
import { deleteSession, getSession } from "@/lib/auth/session";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: "invalid_origin" }, { status: 403 });
  const [session, cookieStore] = await Promise.all([getSession(), cookies()]);
  try {
    const legacyDevice = cookieStore.get("ipillgood_push_device")?.value;
    if (session && legacyDevice && !await readPushBinding()) {
      await writePushBinding({ userId: session.id, deviceId: legacyDevice, bindingId: "legacy", sessionKey: await getPushSessionKey() });
    }
    await cleanupPushBinding();
  } catch {
    // Preserve the signed, generation-scoped revocation capability after session deletion.
    console.error("Push cleanup deferred until browser reentry");
  }
  if (session?.provider === "demo") {
    try {
      await deleteEphemeralDemoSession({ id: session.id });
    } catch (error) {
      console.error("Ephemeral demo data cleanup failed during logout", error);
    }
  }
  await deleteSession();
  cookieStore.delete("ipillgood_push_device");
  cookieStore.delete("ipillgood_account_recovery");
  cookieStore.delete("ipillgood_account_deletion");
  return new NextResponse(null, { status: 303, headers: { Location: "/" } });
}
