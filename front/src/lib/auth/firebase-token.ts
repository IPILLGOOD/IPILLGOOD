import "server-only";

import { createRemoteJWKSet, jwtVerify } from "jose";
import { getFirebaseAccountAdmin, getAccountSessionState } from "@care-atlas/backend";

import { localFirebaseAuthEmulator } from "./firebase-emulator-config.ts";
import {
  verifyFirebaseEmulatorGoogleIdToken,
  type FirebaseGoogleClaims,
} from "./firebase-emulator-token.ts";

const FIREBASE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ?? "care-atlas-seoul-2026-v2";
const FIREBASE_ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);

export async function verifyFirebaseGoogleIdToken(idToken: string, options: { recoverySignIn?: boolean } = {}) {
  const emulator = localFirebaseAuthEmulator({
    authHost: process.env.FIREBASE_AUTH_EMULATOR_HOST,
    firestoreHost: process.env.FIRESTORE_EMULATOR_HOST,
    nodeEnv: process.env.NODE_ENV,
    projectId: FIREBASE_PROJECT_ID,
  });
  const claims = emulator
    ? await verifyFirebaseEmulatorGoogleIdToken(idToken, {
        authHost: process.env.FIREBASE_AUTH_EMULATOR_HOST,
        firestoreHost: process.env.FIRESTORE_EMULATOR_HOST,
        nodeEnv: process.env.NODE_ENV,
        projectId: FIREBASE_PROJECT_ID,
      })
    : (await jwtVerify(idToken, FIREBASE_JWKS, {
        algorithms: ["RS256"],
        audience: FIREBASE_PROJECT_ID,
        issuer: FIREBASE_ISSUER,
      })).payload as FirebaseGoogleClaims;

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
