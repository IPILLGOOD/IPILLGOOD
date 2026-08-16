import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { createSession } from "@/lib/auth/session";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
};

type GoogleProfile = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

function matchesState(received: string, stored: string) {
  const receivedBuffer = Buffer.from(received);
  const storedBuffer = Buffer.from(stored);
  return (
    receivedBuffer.length === storedBuffer.length &&
    timingSafeEqual(receivedBuffer, storedBuffer)
  );
}

function clearOauthCookies(response: NextResponse) {
  response.cookies.delete("care_atlas_oauth_state");
  response.cookies.delete("care_atlas_oauth_verifier");
  return response;
}

function loginError(request: NextRequest, code: string) {
  return clearOauthCookies(
    NextResponse.redirect(new URL(`/login?error=${code}`, request.url)),
  );
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");
  const storedState = request.cookies.get("care_atlas_oauth_state")?.value;
  const verifier = request.cookies.get("care_atlas_oauth_verifier")?.value;

  if (oauthError) return loginError(request, "google_cancelled");
  if (!code || !state || !storedState || !verifier || !matchesState(state, storedState)) {
    return loginError(request, "invalid_oauth_state");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return loginError(request, "google_not_configured");

  try {
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${request.nextUrl.origin}/api/auth/google/callback`,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
      cache: "no-store",
    });
    const tokens = (await tokenResponse.json()) as GoogleTokenResponse;
    if (!tokenResponse.ok || !tokens.access_token) {
      return loginError(request, "google_token_failed");
    }

    const profileResponse = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      cache: "no-store",
    });
    const profile = (await profileResponse.json()) as GoogleProfile;
    if (
      !profileResponse.ok ||
      !profile.sub ||
      !profile.name ||
      !profile.email ||
      profile.email_verified !== true
    ) {
      return loginError(request, "google_profile_failed");
    }

    await createSession({
      id: profile.sub,
      name: profile.name,
      email: profile.email,
      picture: profile.picture,
      provider: "google",
    });
    return clearOauthCookies(NextResponse.redirect(new URL("/today", request.url)));
  } catch (error) {
    console.error("Google OAuth callback failed", error);
    return loginError(request, "google_login_failed");
  }
}
