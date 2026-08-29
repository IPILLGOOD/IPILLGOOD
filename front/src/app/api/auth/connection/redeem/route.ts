import { CONNECTED_SESSION_DURATION_SECONDS, redeemCareConnectionCode } from "@care-atlas/backend";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createSession } from "@/lib/auth/session";
import { isSameOriginBrowserRequest } from "@/lib/request-origin";
import { enforceRateLimit } from "@/lib/rate-limit";

const schema = z.object({ code: z.string().min(8).max(20) });

export async function POST(request: Request) {
  if (!isSameOriginBrowserRequest(request)) {
    return NextResponse.redirect(new URL("/login?error=connection_login_failed", request.url), 303);
  }
  const rate = await enforceRateLimit("connectionAuth", { request });
  if (!rate.allowed) {
    return NextResponse.redirect(new URL("/login?error=connection_login_limited", request.url), 303);
  }
  try {
    const input = schema.parse(Object.fromEntries(await request.formData()));
    const connected = await redeemCareConnectionCode(input.code);
    await createSession({ ...connected, provider: "connected" }, {
      durationSeconds: CONNECTED_SESSION_DURATION_SECONDS,
    });
    return new NextResponse(null, { status: 303, headers: { Location: "/today" } });
  } catch {
    return NextResponse.redirect(new URL("/login?error=connection_login_failed", request.url), 303);
  }
}
