import { NextResponse } from "next/server";

import { createSession } from "@/lib/auth/session";
import { isDemoLoginAllowed } from "@/lib/auth/session-security";

export async function POST(request: Request) {
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

  await createSession({
    id: "demo-caregiver",
    name: "데모 보호자",
    provider: "demo",
  });

  return NextResponse.redirect(new URL("/today", request.url), 303);
}
