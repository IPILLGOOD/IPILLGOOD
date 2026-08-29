import { NextRequest, NextResponse } from "next/server";

import {
  contentSecurityPolicy,
  cspResponseHeaderName,
} from "@/lib/security-headers";

const SESSION_COOKIE_NAME = "care_atlas_session";
const protectedPagePaths = [
  "/today",
  "/dashboard",
  "/medications",
  "/nutrition",
  "/check-in",
  "/documents",
  "/profile",
  "/report",
];

function isProtectedRoute(pathname: string) {
  // Authenticate real pages (including medication details). Unmatched children
  // such as /documents/typo should reach the canonical 404, not the login page.
  return protectedPagePaths.includes(pathname) || /^\/medications\/[^/]+$/.test(pathname);
}

// OpenNext Cloudflare currently bundles the middleware convention for the Edge
// runtime, while Next.js Proxy is emitted as an unsupported Node.js function.
export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const policy = contentSecurityPolicy({
    development: process.env.NODE_ENV === "development",
    nonce,
    upgradeInsecureRequests: request.nextUrl.protocol === "https:",
  });
  const responseHeaderName = cspResponseHeaderName(process.env.CSP_MODE);

  const deletionRecovery = request.nextUrl.pathname === "/profile" && request.cookies.has("ipillgood_account_deletion");
  if (isProtectedRoute(request.nextUrl.pathname) && !request.cookies.has(SESSION_COOKIE_NAME) && !deletionRecovery) {
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
