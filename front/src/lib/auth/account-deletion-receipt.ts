import "server-only";
import { getAccountDeletion, type AccountDeletion } from "@care-atlas/backend";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { sessionSecretBytes } from "./session-security";
import { getAccountDeletionSession } from "./session";

export const DELETION_RECEIPT_COOKIE = "ipillgood_account_deletion";
const secret = () => sessionSecretBytes({ nodeEnv: process.env.NODE_ENV, sessionSecret: process.env.SESSION_SECRET });

export async function setAccountDeletionReceipt(job: AccountDeletion) {
  const token = await new SignJWT({ requestId: job.requestId })
    .setProtectedHeader({ alg: "HS256" }).setSubject(job.userId).setAudience("account-deletion-only")
    .setIssuedAt().setExpirationTime("7d").sign(secret());
  (await cookies()).set(DELETION_RECEIPT_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 7 * 86400,
  });
}

export async function getAccountDeletionReceipt() {
  const token = (await cookies()).get(DELETION_RECEIPT_COOKIE)?.value;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"], audience: "account-deletion-only" });
      if (payload.sub) {
        const job = await getAccountDeletion(payload.sub);
        if (job && job.requestId === payload.requestId && job.status !== "restored") return job;
      }
    } catch { /* A signed old application session can recover a lost start response below. */ }
  }
  const session = await getAccountDeletionSession();
  const job = session?.provider === "google" ? await getAccountDeletion(session.id) : null;
  return job?.status === "restored" ? null : job;
}
