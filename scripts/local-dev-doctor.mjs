import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LOCAL_AUTH_HOST,
  LOCAL_FIRESTORE_HOST,
  parseJavaMajorVersion,
} from "./local-dev-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor !== 24) failures.push(`Node.js 24가 필요합니다. 현재 버전: ${process.versions.node}`);

const java = spawnSync("java", ["-version"], { encoding: "utf8" });
const javaOutput = `${java.stdout ?? ""}\n${java.stderr ?? ""}`;
const javaMajor = java.status === 0 ? parseJavaMajorVersion(javaOutput) : undefined;
if (!javaMajor || javaMajor < 21) {
  failures.push(`Firebase Emulator에는 Java 21 이상이 필요합니다. 현재 감지: ${javaMajor ?? "없음"}`);
}

const firebaseCli = resolve(root, "node_modules/firebase-tools/lib/bin/firebase.js");
try {
  readFileSync(firebaseCli);
} catch {
  failures.push("firebase-tools를 찾지 못했습니다. 먼저 npm install을 실행하세요.");
}

try {
  const config = JSON.parse(readFileSync(resolve(root, "firebase.test.json"), "utf8"));
  const firestore = `${config.emulators.firestore.host}:${config.emulators.firestore.port}`;
  const auth = `${config.emulators.auth.host}:${config.emulators.auth.port}`;
  if (firestore !== LOCAL_FIRESTORE_HOST || auth !== LOCAL_AUTH_HOST) {
    failures.push("firebase.test.json의 Auth·Firestore 포트가 로컬 실행 설정과 일치하지 않습니다.");
  }
} catch (error) {
  failures.push(`firebase.test.json을 확인하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
}

if (failures.length) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`✓ Node.js ${process.versions.node}`);
  console.log(`✓ Java ${javaMajor}`);
  console.log(`✓ Firestore Emulator ${LOCAL_FIRESTORE_HOST}`);
  console.log(`✓ Auth Emulator ${LOCAL_AUTH_HOST}`);
  console.log("✓ ADC와 Firebase IAM 권한 없이 npm run dev:local을 실행할 수 있습니다.");
}
