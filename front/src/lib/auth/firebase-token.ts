import "server-only";

import { createRemoteJWKSet, jwtVerify } from "jose";

const FIREBASE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ?? "care-atlas-seoul-2026-v2";
const FIREBASE_ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);

type FirebaseClaims = {
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  firebase?: {
    sign_in_provider?: string;
  };
};

export async function verifyFirebaseGoogleIdToken(idToken: string) {
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

  return {
    id: claims.sub,
    name: claims.name?.trim() || claims.email.split("@")[0],
    email: claims.email,
    picture: claims.picture,
  };
}
