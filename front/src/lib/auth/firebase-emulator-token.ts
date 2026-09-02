import { decodeJwt, decodeProtectedHeader } from "jose";

import { localFirebaseAuthEmulator } from "./firebase-emulator-config.ts";

export type FirebaseGoogleClaims = {
  aud?: string | string[];
  auth_time?: number;
  email?: string;
  email_verified?: boolean;
  exp?: number;
  firebase?: {
    sign_in_provider?: string;
  };
  iat?: number;
  iss?: string;
  name?: string;
  picture?: string;
  sub?: string;
};

type EmulatorAccount = {
  disabled?: boolean;
  email?: string;
  emailVerified?: boolean;
  localId?: string;
  providerUserInfo?: Array<{ providerId?: string }>;
};

function audienceIncludes(audience: string | string[] | undefined, projectId: string) {
  return typeof audience === "string" ? audience === projectId : audience?.includes(projectId) === true;
}

export async function verifyFirebaseEmulatorGoogleIdToken(
  idToken: string,
  input: {
    authHost?: string;
    fetcher?: typeof fetch;
    firestoreHost?: string;
    nodeEnv?: string;
    now?: () => number;
    projectId: string;
  },
) {
  const emulator = localFirebaseAuthEmulator(input);
  if (!emulator) throw new Error("Firebase Auth emulator verification is unavailable.");

  const header = decodeProtectedHeader(idToken);
  const claims = decodeJwt(idToken) as FirebaseGoogleClaims;
  const now = Math.floor((input.now?.() ?? Date.now()) / 1_000);
  if (
    header.alg !== "none" ||
    !claims.sub ||
    claims.iss !== `https://securetoken.google.com/${emulator.projectId}` ||
    !audienceIncludes(claims.aud, emulator.projectId) ||
    typeof claims.iat !== "number" ||
    claims.iat > now + 60 ||
    typeof claims.exp !== "number" ||
    claims.exp <= now ||
    !claims.email ||
    claims.email_verified !== true ||
    claims.firebase?.sign_in_provider !== "google.com"
  ) {
    throw new Error("Firebase Auth emulator token claims are invalid.");
  }

  const response = await (input.fetcher ?? fetch)(
    `${emulator.authOrigin}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=demo-local`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
      signal: AbortSignal.timeout(5_000),
    },
  );
  const result = await response.json() as { users?: EmulatorAccount[] };
  const account = result.users?.find(({ localId }) => localId === claims.sub);
  if (
    !response.ok ||
    !account ||
    account.disabled ||
    account.email !== claims.email ||
    account.emailVerified !== true ||
    !account.providerUserInfo?.some(({ providerId }) => providerId === "google.com")
  ) {
    throw new Error("Firebase Auth emulator account verification failed.");
  }
  return claims;
}
