import { randomUUID } from "node:crypto";
import {
  activatePushSubscription,
  deactivatePushSubscription,
  getCareSnapshot,
  getNotificationScheduleStatus,
  getPushDeviceHealth,
  registerPushSubscription,
} from "@care-atlas/backend";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { cleanupPushBinding, getPushSessionKey, readPushBinding, writePushBinding, PUSH_BINDING_COOKIE } from "@/lib/push/server-binding";
import { z } from "zod";

import { careScopeFor } from "@/lib/auth/care-scope";
import { getSession } from "@/lib/auth/session";
import { isAllowedPushEndpoint, isSameOriginRequest } from "@/lib/api-security";

const subscriptionSchema = z.object({
  deviceId: z.string().min(16).max(128),
  platform: z.enum(["ios", "android", "macos", "windows", "other"]),
  browser: z.enum(["chrome", "safari", "edge", "firefox", "other"]),
  userAgent: z.string().max(512),
  timeZone: z.string().min(1).max(100),
  onlyIfActive: z.boolean().optional(),
  subscription: z.object({
    endpoint: z.string().url().refine(isAllowedPushEndpoint, "지원하지 않는 Push endpoint입니다."),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({
      p256dh: z.string().min(40).max(256),
      auth: z.string().min(16).max(128),
    }),
  }),
});

const deleteSchema = z.object({ deviceId: z.string().min(16).max(128) });

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const scope = careScopeFor(session);
  const sessionKey = await getPushSessionKey();
  if (request.headers.get("x-push-session") !== sessionKey) return Response.json({ error: "session_changed" }, { status: 409 });
  const binding = await readPushBinding();
  const parsed = deleteSchema.safeParse({ deviceId: new URL(request.url).searchParams.get("deviceId") });
  if (!parsed.success) return Response.json({ error: "invalid_device" }, { status: 400 });
  try {
    const [health, status] = await Promise.all([
      getPushDeviceHealth({ userId: session.id, recipientId: scope.recipientId, deviceId: parsed.data.deviceId, sessionKey, bindingId: binding?.bindingId ?? "missing" }),
      getNotificationScheduleStatus(scope.recipientId),
    ]);
    return Response.json({ ...health, status }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "subscription_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const sessionKey = await getPushSessionKey();
    if (!sessionKey || request.headers.get("x-push-session") !== sessionKey) return Response.json({ error: "session_changed" }, { status: 409 });
    await cleanupPushBinding(sessionKey);
    const input = subscriptionSchema.parse(await request.json());
    const bindingId = randomUUID();
    const scope = careScopeFor(session);
    const snapshot = await getCareSnapshot(scope);
    const registration = await registerPushSubscription({
      userId: session.id,
      recipientId: scope.recipientId,
      medications: snapshot.medications,
      ...input,
      bindingId, sessionKey, deferActivation: true,
    });
    if (!registration.record) return Response.json({ error: "subscription_no_longer_active" }, { status: 409 });
    // No active subscription exists until the browser acknowledges this cookie in PATCH.
    await writePushBinding({ userId: session.id, deviceId: input.deviceId, bindingId, sessionKey });
    return NextResponse.json({ prepared: true, bindingId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "invalid_subscription" }, { status: 400 });
    }
    console.error("Push subscription registration failed");
    return Response.json({ error: "subscription_failed" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { deviceId } = deleteSchema.parse(await request.json());
    const sessionKey = await getPushSessionKey();
    if (request.headers.get("x-push-session") !== sessionKey) return Response.json({ error: "session_changed" }, { status: 409 });
    const binding = await readPushBinding();
    if (!binding || binding.userId !== session.id || binding.deviceId !== deviceId || binding.sessionKey !== sessionKey) return Response.json({ error: "binding_changed" }, { status: 409 });
    await deactivatePushSubscription(binding);
    (await cookies()).delete(PUSH_BINDING_COOKIE);
    const response = NextResponse.json({ ok: true });
    response.cookies.delete("ipillgood_push_device");
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "invalid_device" }, { status: 400 });
    }
    console.error("Push subscription deactivation failed", error);
    return Response.json({ error: "deactivation_failed" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: "invalid_origin" }, { status: 403 });
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const sessionKey = await getPushSessionKey();
    const binding = await readPushBinding();
    const { bindingId } = z.object({ bindingId: z.string().uuid() }).parse(await request.json());
    if (!binding || binding.userId !== session.id || binding.bindingId !== bindingId || binding.sessionKey !== sessionKey
      || request.headers.get("x-push-session") !== sessionKey) return Response.json({ error: "binding_changed" }, { status: 409 });
    const status = await activatePushSubscription({ ...binding, recipientId: careScopeFor(session).recipientId });
    if (!status) return Response.json({ error: "subscription_no_longer_active" }, { status: 409 });
    // Do not perform a fallible status read after the activation transaction commits.
    return Response.json({ ok: true, status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: "activation_failed" }, { status: error instanceof z.ZodError ? 400 : 503 });
  }
}
