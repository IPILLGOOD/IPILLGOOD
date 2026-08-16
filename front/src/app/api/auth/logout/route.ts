import { NextResponse } from "next/server";

import { deleteSession } from "@/lib/auth/session";

export async function POST(request: Request) {
  await deleteSession();
  return NextResponse.redirect(new URL("/", request.url), 303);
}
