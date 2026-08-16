import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE_NAME = "care_atlas_session";

export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE_NAME)) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/today/:path*",
    "/dashboard/:path*",
    "/medications/:path*",
    "/check-in/:path*",
    "/documents/:path*",
    "/profile/:path*",
    "/report/:path*",
  ],
};
