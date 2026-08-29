import { NextResponse } from "next/server";

import {
  DEMO_SESSION_DURATION_SECONDS,
  createEphemeralDemoSession,
  createEphemeralDemoSessionId,
  deleteEphemeralDemoSession,
  ephemeralDemoSessionExpiresAt,
} from "@care-atlas/backend";

import { createSession } from "@/lib/auth/session";
import { isDemoLoginAllowed } from "@/lib/auth/session-security";
import { isSameOriginBrowserRequest } from "@/lib/request-origin";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rateLimitResponse } from "@/lib/rate-limit-core";

export async function POST(request: Request) {
  const wantsJson = request.headers.get("accept")?.includes("application/json") === true;
  if (!isSameOriginBrowserRequest(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const requestUrl = new URL(request.url);
  if (
    !isDemoLoginAllowed({
      demoMode: process.env.IPILLGOOD_DEMO_MODE,
      hostname: requestUrl.hostname,
      nodeEnv: process.env.NODE_ENV,
      publicDemoMode: process.env.IPILLGOOD_PUBLIC_DEMO_MODE,
      allowedHosts: process.env.IPILLGOOD_DEMO_ALLOWED_HOSTS,
    })
  ) {
    return NextResponse.json({ error: "demo_login_unavailable" }, { status: 404 });
  }
  const rateLimit = await enforceRateLimit("auth", { request });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);
  const id = createEphemeralDemoSessionId();
  const expiresAt = ephemeralDemoSessionExpiresAt();
  try {
    await createEphemeralDemoSession({ id, expiresAt });
    await createSession(
      {
        id,
        name: "데모 보호자",
        provider: "demo",
      },
      { durationSeconds: DEMO_SESSION_DURATION_SECONDS },
    );
  } catch (error) {
    console.error("Ephemeral demo session creation failed", error);
    try {
      await deleteEphemeralDemoSession({ id, force: true });
    } catch (cleanupError) {
      console.error("Failed demo session cleanup after login error", cleanupError);
    }
    return NextResponse.json({ error: "demo_session_failed" }, { status: 503 });
  }

  return wantsJson
    ? NextResponse.json({ redirectTo: "/today" }, { status: 201 })
    : new NextResponse(null, { status: 303, headers: { Location: "/today" } });
}
