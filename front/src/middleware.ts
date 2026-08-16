import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE_NAME = "care_atlas_session";

// OpenNext Cloudflare는 현재 Next.js 16의 Node.js proxy 런타임을 지원하지
// 않으므로 동일한 인증 경계를 Edge Middleware로 유지합니다.
export function middleware(request: NextRequest) {
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
