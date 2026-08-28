import { NextResponse } from "next/server";
import { z } from "zod";
import { getAccountDeletion } from "@care-atlas/backend";
import { cookies } from "next/headers";

import { verifyFirebaseGoogleIdToken } from "@/lib/auth/firebase-token";
import { createSession, deleteSession } from "@/lib/auth/session";
import { setAccountRecoverySession } from "@/lib/auth/account-recovery-session";
import { DELETION_RECEIPT_COOKIE } from "@/lib/auth/account-deletion-receipt";
import { isSameOriginBrowserRequest } from "@/lib/request-origin";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rateLimitResponse } from "@/lib/rate-limit-core";

const requestSchema = z.object({
  idToken: z.string().min(100).max(8192),
});

export async function POST(request: Request) {
  if (!isSameOriginBrowserRequest(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  const rateLimit = await enforceRateLimit("auth", { request });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  try {
    const body = requestSchema.parse(await request.json());
    const user = await verifyFirebaseGoogleIdToken(body.idToken, { recoverySignIn: true });
    const deletion = await getAccountDeletion(user.id);
    if (deletion && deletion.status !== "restored") {
      await setAccountRecoverySession(deletion, user);
      await deleteSession();
      const store = await cookies();
      store.delete(DELETION_RECEIPT_COOKIE);
      store.delete("ipillgood_push_device");
      return NextResponse.json({ redirectTo: "/account/recovery" }, { headers: { "Cache-Control": "no-store" } });
    }

    await createSession({ ...user, provider: "google" });
    return NextResponse.json({ redirectTo: "/today" });
  } catch {
    return NextResponse.json({ error: "google_login_failed" }, { status: 401 });
  }
}
