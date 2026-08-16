import { NextResponse } from "next/server";

import { createSession } from "@/lib/auth/session";

export async function POST(request: Request) {
  await createSession({
    id: "demo-caregiver",
    name: "데모 보호자",
    provider: "demo",
  });

  return NextResponse.redirect(new URL("/today", request.url), 303);
}
