import "server-only";

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

import { sessionSecretBytes } from "./session-security";

export const SESSION_COOKIE_NAME = "care_atlas_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;

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

async function signSession(user: SessionUser) {
  return new SignJWT({
    name: user.name,
    email: user.email,
    picture: user.picture,
    provider: user.provider,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSessionSecret());
}

export async function createSession(user: SessionUser) {
  const token = await signSession(user);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSessionSecret(), {
      algorithms: ["HS256"],
    });
    if (
      !payload.sub ||
      typeof payload.name !== "string" ||
      (payload.provider !== "google" && payload.provider !== "demo")
    ) {
      return null;
    }

    return {
      id: payload.sub,
      name: payload.name,
      email: typeof payload.email === "string" ? payload.email : undefined,
      picture: typeof payload.picture === "string" ? payload.picture : undefined,
      provider: payload.provider,
    };
  } catch {
    return null;
  }
}

export async function deleteSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
