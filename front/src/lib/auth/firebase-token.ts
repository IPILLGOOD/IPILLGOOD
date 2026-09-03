import "server-only";

import { createRemoteJWKSet, jwtVerify } from "jose";
import { getFirebaseAccountAdmin, getAccountSessionState } from "@care-atlas/backend";

const FIREBASE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ?? "care-atlas-seoul-2026-v3";
const FIREBASE_ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);

type FirebaseClaims = {
  auth_time?: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  firebase?: {
    sign_in_provider?: string;
  };
};

export async function verifyFirebaseGoogleIdToken(idToken: string, options: { recoverySignIn?: boolean } = {}) {
  const { payload } = await jwtVerify(idToken, FIREBASE_JWKS, {
    algorithms: ["RS256"],
    audience: FIREBASE_PROJECT_ID,
    issuer: FIREBASE_ISSUER,
  });
  const claims = payload as typeof payload & FirebaseClaims;

  if (
    !claims.sub ||
    !claims.email ||
    claims.email_verified !== true ||
    claims.firebase?.sign_in_provider !== "google.com"
  ) {
    throw new Error("Firebase Google ID token claims are invalid.");
  }

  const account = await (await getFirebaseAccountAdmin()).lookup(claims.sub);
  const state = await getAccountSessionState(claims.sub);
  if (!account || account.disabled || typeof claims.auth_time !== "number" ||
      claims.auth_time < Math.max(Number(account.validSince ?? 0), state.authValidAfter) ||
      (!options.recoverySignIn && !state.active)) {
    throw new Error("Firebase account is no longer active.");
  }

  return {
    id: claims.sub,
    name: claims.name?.trim() || claims.email.split("@")[0],
    email: claims.email,
    picture: claims.picture,
    authTime: claims.auth_time,
  };
}
