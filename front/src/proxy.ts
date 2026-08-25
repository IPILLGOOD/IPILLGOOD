import { NextRequest, NextResponse } from "next/server";

import {
  contentSecurityPolicy,
  cspResponseHeaderName,
} from "@/lib/security-headers";

const SESSION_COOKIE_NAME = "care_atlas_session";
const protectedRoutePrefixes = [
  "/today",
  "/dashboard",
  "/medications",
  "/check-in",
  "/documents",
  "/profile",
  "/report",
];

function isProtectedRoute(pathname: string) {
  return protectedRoutePrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy({
    development: process.env.NODE_ENV === "development",
    nonce,
    upgradeInsecureRequests: request.nextUrl.protocol === "https:",
  });
  const responseHeaderName = cspResponseHeaderName(process.env.CSP_MODE);

  if (isProtectedRoute(request.nextUrl.pathname) && !request.cookies.has(SESSION_COOKIE_NAME)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    const response = NextResponse.redirect(loginUrl);
    response.headers.set(responseHeaderName, policy);
    return response;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next.js가 framework/inline 태그에 nonce를 붙일 수 있도록 내부 요청에는 항상 차단형 이름을 사용합니다.
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(responseHeaderName, policy);
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
};
