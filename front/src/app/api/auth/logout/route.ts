import { deactivatePushSubscription } from "@care-atlas/backend";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { deleteSession, getSession } from "@/lib/auth/session";

export async function POST(request: Request) {
  const [session, cookieStore] = await Promise.all([getSession(), cookies()]);
  const pushDeviceId = cookieStore.get("ipillgood_push_device")?.value;
  if (session && pushDeviceId) {
    try {
      await deactivatePushSubscription({ userId: session.id, deviceId: pushDeviceId });
    } catch (error) {
      console.error("Current device push deactivation failed during logout", error);
    }
  }
  await deleteSession();
  cookieStore.delete("ipillgood_push_device");
  return NextResponse.redirect(new URL("/", request.url), 303);
}
