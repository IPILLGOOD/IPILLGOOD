import { spawn } from "node:child_process";
import { resolve } from "node:path";
import net from "node:net";

const root = resolve(import.meta.dirname, "..");

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function ready(url, child) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Next.js local server exited before it was ready.");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The development server is still compiling.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error("Next.js local server readiness timed out.");
}

const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}`;
const nextCli = resolve(root, "node_modules/next/dist/bin/next");
const app = spawn(process.execPath, [nextCli, "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: resolve(root, "front"),
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
app.stdout.pipe(process.stdout);
app.stderr.pipe(process.stderr);

let idToken;
try {
  await ready(`${baseUrl}/login`, app);
  const identityResponse = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-local`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestUri: baseUrl,
        returnSecureToken: true,
        postBody: new URLSearchParams({
          providerId: "google.com",
          id_token: JSON.stringify({
            sub: "local-smoke-user",
            email: "local-smoke@example.test",
            email_verified: true,
            name: "로컬 검증 보호자",
          }),
        }).toString(),
      }),
    },
  );
  const identity = await identityResponse.json();
  if (!identityResponse.ok || typeof identity.idToken !== "string") {
    throw new Error(`Auth Emulator sign-in failed (${identityResponse.status}).`);
  }
  idToken = identity.idToken;

  const loginResponse = await fetch(`${baseUrl}/api/auth/google`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: baseUrl,
    },
    body: JSON.stringify({ idToken }),
    redirect: "manual",
  });
  const login = await loginResponse.json();
  if (
    loginResponse.status !== 200 ||
    login.redirectTo !== "/profile?onboarding=1" ||
    !loginResponse.headers.getSetCookie().some((value) => value.startsWith("care_atlas_session="))
  ) {
    throw new Error(`Local Google login smoke test failed (${loginResponse.status}): ${JSON.stringify(login)}`);
  }
  console.log("✓ Auth Emulator Google token → server validation → Firestore Emulator session flow");
} finally {
  if (idToken) {
    await fetch(
      `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:delete?key=demo-local`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      },
    ).catch(() => undefined);
  }
  app.kill("SIGTERM");
  await new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      app.kill("SIGKILL");
      resolveExit();
    }, 5_000);
    app.once("exit", () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
}
