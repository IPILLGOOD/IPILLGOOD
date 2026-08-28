import "server-only";

import { isEphemeralDemoSessionActive, getAccountSessionState, MAX_SESSION_SECONDS } from "@care-atlas/backend";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

import { sessionSecretBytes } from "./session-security";

export const SESSION_COOKIE_NAME = "care_atlas_session";
const SESSION_DURATION_SECONDS = MAX_SESSION_SECONDS;

export type SessionUser = {
  id: string;
  name: string;
  email?: string;
  picture?: string;
  provider: "google" | "demo";
};

function getSessionSecret() {
  return sessionSecretBytes({
    nodeEnv: process.env.NODE_ENV,
    sessionSecret: process.env.SESSION_SECRET,
  });
}

async function signSession(user: SessionUser, durationSeconds: number) {
  const state = user.provider === "google" ? await getAccountSessionState(user.id) : null;
  if (state && !state.active) throw new Error("ACCOUNT_NOT_ACTIVE");
  return new SignJWT({
    accountVersion: state?.version,
    name: user.name,
    email: user.email,
    picture: user.picture,
    provider: user.provider,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${durationSeconds}s`)
    .sign(getSessionSecret());
}

export async function createSession(
  user: SessionUser,
  options: { durationSeconds?: number } = {},
) {
  const durationSeconds = options.durationSeconds ?? SESSION_DURATION_SECONDS;
  const token = await signSession(user, durationSeconds);
  const cookieStore = await cookies();
  cookieStore.delete("ipillgood_account_deletion");
  cookieStore.delete("ipillgood_account_recovery");
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: durationSeconds,
  });
}

async function readSession(allowDeleting = false): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSessionSecret(), {
      algorithms: ["HS256"],
    });
    if (
      !payload.sub ||
      payload.aud !== undefined ||
      typeof payload.iat !== "number" || typeof payload.exp !== "number" ||
      payload.exp - payload.iat > MAX_SESSION_SECONDS ||
      typeof payload.name !== "string" ||
      (payload.provider !== "google" && payload.provider !== "demo")
    ) {
      return null;
    }

    const user = {
      id: payload.sub,
      name: payload.name,
      email: typeof payload.email === "string" ? payload.email : undefined,
      picture: typeof payload.picture === "string" ? payload.picture : undefined,
      provider: payload.provider,
    } satisfies SessionUser;
    if (
      user.provider === "demo" &&
      !(await isEphemeralDemoSessionActive(user.id))
    ) {
      return null;
    }
    if (!allowDeleting && user.provider === "google") {
      const state = await getAccountSessionState(user.id);
      if (!state.active || payload.accountVersion !== state.version) return null;
    }
    return user;
  } catch {
    return null;
  }
}

export function getSession() { return readSession(); }

/** Recovery only: this identity must never authorize care reads or writes. */
export function getAccountDeletionSession() { return readSession(true); }

export async function deleteSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
