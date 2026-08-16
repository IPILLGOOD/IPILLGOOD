import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyFirebaseGoogleIdToken } from "@/lib/auth/firebase-token";
import { createSession } from "@/lib/auth/session";

const requestSchema = z.object({
  idToken: z.string().min(100).max(8192),
});

export async function POST(request: Request) {
  const requestOrigin = new URL(request.url).origin;
  const browserOrigin = request.headers.get("origin");
  if (browserOrigin && browserOrigin !== requestOrigin) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  try {
    const body = requestSchema.parse(await request.json());
    const user = await verifyFirebaseGoogleIdToken(body.idToken);

    await createSession({ ...user, provider: "google" });
    return NextResponse.json({ redirectTo: "/today" });
  } catch (error) {
    console.error("Firebase Google sign-in failed", error);
    return NextResponse.json({ error: "google_login_failed" }, { status: 401 });
  }
}
