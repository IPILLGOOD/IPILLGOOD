import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { localFirebaseEnvironment, LOCAL_FIREBASE_PROJECT_ID } from "./local-dev-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
if (!new Set(["dev", "verify"]).has(mode)) {
  throw new Error("Expected local Firebase mode: dev or verify.");
}

const firebaseCli = resolve(root, "node_modules/firebase-tools/lib/bin/firebase.js");
const startNext = resolve(root, "scripts/start-local-next.mjs");
const smoke = resolve(root, "scripts/local-auth-smoke.mjs");
const command = mode === "dev"
  ? `"${process.execPath}" "${startNext}"`
  : `"${process.execPath}" "${smoke}"`;
const child = spawn(process.execPath, [
  firebaseCli,
  "emulators:exec",
  "--only",
  "firestore,auth",
  "--project",
  LOCAL_FIREBASE_PROJECT_ID,
  "--config",
  resolve(root, "firebase.test.json"),
  command,
], {
  cwd: root,
  env: localFirebaseEnvironment(),
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}
child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
