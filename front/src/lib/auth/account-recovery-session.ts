import "server-only";
import { assertRecentAccountAuthentication, getAccountDeletion, type AccountDeletion } from "@care-atlas/backend";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { sessionSecretBytes } from "./session-security";
import type { SessionUser } from "./session";

export const RECOVERY_COOKIE = "ipillgood_account_recovery";
const secret = () => sessionSecretBytes({ nodeEnv: process.env.NODE_ENV, sessionSecret: process.env.SESSION_SECRET });

/** A fresh Google login can authorize recovery, never health data or a normal service session. */
export async function setAccountRecoverySession(job: AccountDeletion, user: Omit<SessionUser, "provider"> & { authTime: number }) {
  assertRecentAccountAuthentication({ userId: job.userId, tokenUserId: user.id, authTime: user.authTime });
  const token = await new SignJWT({ requestId: job.requestId, authTime: user.authTime, name: user.name, email: user.email, picture: user.picture })
    .setProtectedHeader({ alg: "HS256" }).setSubject(user.id).setAudience("account-recovery-only")
    .setIssuedAt().setExpirationTime(user.authTime + 300).sign(secret());
  (await cookies()).set(RECOVERY_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 300,
  });
}

export async function getAccountRecoverySession() {
  const token = (await cookies()).get(RECOVERY_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"], audience: "account-recovery-only" });
    if (!payload.sub || typeof payload.name !== "string" || typeof payload.authTime !== "number") return null;
    const job = await getAccountDeletion(payload.sub);
    if (!job || job.requestId !== payload.requestId || job.userId !== payload.sub) return null;
    assertRecentAccountAuthentication({ userId: payload.sub, tokenUserId: job.userId, authTime: payload.authTime });
    return { job, authTime: payload.authTime, user: {
      id: payload.sub, name: payload.name, provider: "google" as const,
      email: typeof payload.email === "string" ? payload.email : undefined,
      picture: typeof payload.picture === "string" ? payload.picture : undefined,
    } };
  } catch { return null; }
}
