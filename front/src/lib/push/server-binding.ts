import "server-only";

import { createHash } from "node:crypto";
import { deactivatePushSubscription } from "@care-atlas/backend";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { sessionSecretBytes } from "@/lib/auth/session-security";

export const PUSH_BINDING_COOKIE = "ipillgood_push_binding";
const audience = "ipillgood-push-cleanup";
const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 365 * 24 * 60 * 60 };
type PushBinding = { userId: string; deviceId: string; bindingId: string; sessionKey: string };

function secret() {
  return sessionSecretBytes({ nodeEnv: process.env.NODE_ENV, sessionSecret: process.env.SESSION_SECRET });
}

/** Fingerprint only; neither the session credential nor its claims leave the server. */
export async function getPushSessionKey() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return "";
  const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
  // Connected sessions refresh their expiry during activity without changing their login identity.
  const sessionId = typeof payload.jti === "string" ? payload.jti : createHash("sha256").update(token).digest("hex");
  return createHash("sha256").update(sessionId).digest("hex");
}

export async function readPushBinding(): Promise<PushBinding | null> {
  const token = (await cookies()).get(PUSH_BINDING_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { audience, algorithms: ["HS256"] });
    if ([payload.userId, payload.deviceId, payload.bindingId, payload.sessionKey].some((value) => typeof value !== "string" || !value)) return null;
    return { userId: payload.userId as string, deviceId: payload.deviceId as string, bindingId: payload.bindingId as string, sessionKey: payload.sessionKey as string };
  } catch { return null; }
}

export async function writePushBinding(binding: PushBinding) {
  const token = await new SignJWT(binding).setProtectedHeader({ alg: "HS256" }).setAudience(audience)
    .setIssuedAt().setExpirationTime("365d").sign(secret());
  (await cookies()).set(PUSH_BINDING_COOKIE, token, cookieOptions);
}

/** The signed cookie authorizes only revoking this exact generation, never health-data access.
 * Keep it on failure so cleanup survives session deletion and can retry after reload/login. */
export async function cleanupPushBinding(currentSessionKey = "") {
  const binding = await readPushBinding();
  if (!binding || (currentSessionKey && binding.sessionKey === currentSessionKey)) return false;
  await deactivatePushSubscription(binding);
  const store = await cookies();
  store.delete(PUSH_BINDING_COOKIE);
  store.delete("ipillgood_push_device");
  return true;
}
