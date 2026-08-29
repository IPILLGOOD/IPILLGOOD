import { spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import net from "node:net";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fullCycleOnly = process.argv.includes("--account-full-cycle-only");
if (fullCycleOnly && !existsSync(resolve(root, "front/.next/standalone/front/server.js"))) {
  throw new Error("Build the application with npm run verify before the focused full-cycle run.");
}
// Next loads dotenv files itself; refusing them is safer than silently inheriting production credentials.
for (const directory of [root, resolve(root, "front")]) {
  for (const file of [".env", ".env.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local", ".dev.vars"]) {
    if (existsSync(resolve(directory, file))) throw new Error(`Use a clean worktree without ${resolve(directory, file)} for verification.`);
  }
}
const temporary = mkdtempSync(resolve(tmpdir(), "ipillgood-verify-"));
const children = new Set();
const steps = [];
mkdirSync(resolve(root, "verification-artifacts"), { recursive: true });
const log = createWriteStream(resolve(root, fullCycleOnly ? "verification-artifacts/full-cycle.log" : "verification-artifacts/run.log"));
const env = Object.fromEntries(["PATH", "JAVA_HOME", "TMPDIR", "TEMP", "SystemRoot", "LANG", "PLAYWRIGHT_BROWSERS_PATH"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
Object.assign(env, {
  CI: "1", NEXT_TELEMETRY_DISABLED: "1", FIREBASE_CLI_DISABLE_UPDATE_CHECK: "1",
  XDG_CONFIG_HOME: temporary, FIREBASE_PROJECT_ID: `demo-rel-${randomBytes(6).toString("hex")}`,
  SESSION_SECRET: randomBytes(48).toString("base64url"), IPILLGOOD_DEMO_MODE: "true",
  CONNECTION_CODE_SECRET: randomBytes(48).toString("base64url"),
  IPILLGOOD_PUBLIC_DEMO_MODE: "isolated", IPILLGOOD_DEMO_ALLOWED_HOSTS: "127.0.0.1,localhost",
  OPENAI_API_KEY: "", MEDICAL_DOCUMENT_API_KEY: "", FIREBASE_SERVICE_ACCOUNT_JSON: "",
});
async function port() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
function launch(command, args, extraEnv = {}) {
  const child = spawn(command, args, { cwd: root, env: { ...env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (data) => { process.stdout.write(data); log.write(data); });
  child.stderr.on("data", (data) => { process.stderr.write(data); log.write(data); });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}
async function run(name, command, args, extraEnv) {
  console.log(`\n[verify] ${name}`);
  const start = Date.now();
  const child = launch(command, args, extraEnv);
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  steps.push({ name, passed: code === 0, durationMs: Date.now() - start });
  if (code !== 0) throw new Error(`${name} failed (${code})`);
}
async function ready(url, child, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited before ${url} was ready.`);
    try { await fetch(url, { signal: AbortSignal.timeout(1000) }); return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server readiness timeout: ${url}`);
}
async function stop() {
  for (const child of children) child.kill("SIGTERM");
  await Promise.all([...children].map((child) => new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  })));
}
process.once("SIGINT", () => { void stop().then(() => process.exit(130)); });
process.once("SIGTERM", () => { void stop().then(() => process.exit(143)); });
try {
  if (!fullCycleOnly) {
    await run("unit", "npm", ["test"]);
    await run("typecheck", "npm", ["run", "typecheck"]);
    await run("lint", "npm", ["run", "lint"]);
    // Build may fetch Google Fonts. Runtime and test processes below cannot reach external services.
    await run("production-build", "npm", ["run", "build"]);
  }
  const [firestorePort, authPort, hubPort, loggingPort, appPort] = await Promise.all(Array.from({ length: 5 }, port));
  const config = resolve(temporary, "firebase.json");
  writeFileSync(config, JSON.stringify({
    firestore: { rules: resolve(root, "backend/firestore.rules"), indexes: resolve(root, "backend/firestore.indexes.json") },
    emulators: { firestore: { host: "127.0.0.1", port: firestorePort }, auth: { host: "127.0.0.1", port: authPort }, hub: { host: "127.0.0.1", port: hubPort }, logging: { host: "127.0.0.1", port: loggingPort }, ui: { enabled: false }, singleProjectMode: true },
  }));
  env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${firestorePort}`;
  env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${authPort}`;
  env.IPILLGOOD_TEST_BASE_URL = `http://127.0.0.1:${appPort}`;
  const emulator = launch(process.execPath, ["node_modules/firebase-tools/lib/bin/firebase.js", "emulators:start", "--only", "firestore,auth", "--project", env.FIREBASE_PROJECT_ID, "--config", config]);
  await Promise.all([ready(`http://${env.FIRESTORE_EMULATOR_HOST}`, emulator), ready(`http://${env.FIREBASE_AUTH_EMULATOR_HOST}`, emulator)]);
  const guarded = { NODE_OPTIONS: `--import=${pathToFileURL(resolve(root, "scripts/test-network-guard.mjs")).href}` };
  if (!fullCycleOnly) await run("emulator-contracts", process.execPath, ["--experimental-strip-types", "--test", "backend/integration/*.test.ts"], guarded);
  cpSync(resolve(root, "front/.next/static"), resolve(root, "front/.next/standalone/front/.next/static"), { recursive: true });
  cpSync(resolve(root, "front/public"), resolve(root, "front/.next/standalone/front/public"), { recursive: true });
  if (!fullCycleOnly) {
    const app = launch(process.execPath, ["front/.next/standalone/front/server.js"], { ...guarded, NODE_ENV: "production", PORT: String(appPort), HOSTNAME: "127.0.0.1" });
    await ready(`${env.IPILLGOOD_TEST_BASE_URL}/login`, app);
    await run("browser-and-api", process.execPath, ["node_modules/@playwright/test/cli.js", "test"], guarded);
  }
  if (fullCycleOnly || process.argv.includes("--account-full-cycle")) {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwksPath = resolve(temporary, "identity-public.json");
    const keyPath = resolve(temporary, "identity-private.pem");
    const clockPath = resolve(temporary, "identity-clock.json");
    writeFileSync(jwksPath, JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "isolated-verification", alg: "RS256", use: "sig" }] }));
    writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    writeFileSync(clockPath, "0");
    const identityPort = await port();
    const identityEnv = {
      IPILLGOOD_TEST_BASE_URL: `http://127.0.0.1:${identityPort}`,
      IPILLGOOD_TEST_JWKS_PATH: jwksPath, IPILLGOOD_TEST_CLOCK_PATH: clockPath,
      PUSH_CRON_SECRET: randomBytes(48).toString("base64url"),
    };
    const identityApp = launch(process.execPath, ["front/.next/standalone/front/server.js"], {
      ...identityEnv, NODE_ENV: "production", PORT: String(identityPort), HOSTNAME: "127.0.0.1",
      NODE_OPTIONS: `${guarded.NODE_OPTIONS} --import=${pathToFileURL(resolve(root, "scripts/test-identity-provider.mjs")).href}`,
    });
    await ready(`${identityEnv.IPILLGOOD_TEST_BASE_URL}/login`, identityApp);
    await run("account-full-cycle (synthetic Google boundary)", process.execPath,
      ["node_modules/@playwright/test/cli.js", "test", "--config", "playwright.full-cycle.config.ts"],
      { ...guarded, ...identityEnv, IPILLGOOD_TEST_IDENTITY_KEY_PATH: keyPath });
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await stop();
  writeFileSync(resolve(root, fullCycleOnly ? "verification-artifacts/verification-full-cycle.json" : "verification-artifacts/verification.json"), JSON.stringify({ project: env.FIREBASE_PROJECT_ID, steps }, null, 2));
  log.end();
  rmSync(temporary, { recursive: true, force: true });
}
