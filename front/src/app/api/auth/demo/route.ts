import { NextResponse } from "next/server";

import { createSession } from "@/lib/auth/session";
import { isDemoLoginAllowed } from "@/lib/auth/session-security";
import { isSameOriginRequest } from "@/lib/api-security";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rateLimitResponse } from "@/lib/rate-limit-core";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const requestUrl = new URL(request.url);
  if (
    !isDemoLoginAllowed({
      demoMode: process.env.IPILLGOOD_DEMO_MODE,
      hostname: requestUrl.hostname,
      nodeEnv: process.env.NODE_ENV,
    })
  ) {
    return NextResponse.json({ error: "demo_login_unavailable" }, { status: 404 });
  }
  const rateLimit = await enforceRateLimit("auth", { request });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);
  await createSession({
    id: "demo-caregiver",
    name: "데모 보호자",
    provider: "demo",
  });

  return new NextResponse(null, { status: 303, headers: { Location: "/today" } });
}
