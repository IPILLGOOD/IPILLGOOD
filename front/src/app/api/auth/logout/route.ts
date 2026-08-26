import {
  deactivatePushSubscription,
  deleteEphemeralDemoSession,
} from "@care-atlas/backend";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { deleteSession, getSession } from "@/lib/auth/session";

export async function POST() {
  const [session, cookieStore] = await Promise.all([getSession(), cookies()]);
  const pushDeviceId = cookieStore.get("ipillgood_push_device")?.value;
  if (session && pushDeviceId) {
    try {
      await deactivatePushSubscription({ userId: session.id, deviceId: pushDeviceId });
    } catch (error) {
      console.error("Current device push deactivation failed during logout", error);
    }
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
  return new NextResponse(null, { status: 303, headers: { Location: "/" } });
}
