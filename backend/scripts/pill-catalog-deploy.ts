// Invoked explicitly by cf:deploy/cf:upload. Never collects data in a user request.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { collectPillCatalogSnapshot } from "../src/pill-catalog-snapshot.ts";
import { savePillSnapshot } from "./pill-catalog.ts";
const root = fileURLToPath(new URL("../../", import.meta.url));
const envFile = resolve(root, "front/.env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);
let source = process.env.PILL_CATALOG_FILE?.trim();
if (!source) {
  const result = await collectPillCatalogSnapshot({
    beforeRequest: () => new Promise(resolve => setTimeout(resolve, 250)),
    onProgress: progress => { if (progress.pageNo % 50 === 0) console.log(`Official catalog pass ${progress.pass}: ${progress.pageNo}/${progress.totalPages}`); },
  });
  if (result.status !== "collected") {
    console.error(`Pill catalog preparation failed: ${result.reason}. Configure an approved MFDS_PILL_API_KEY or a fresh PILL_CATALOG_FILE. Deployment was not started.`);
    process.exitCode = 1;
  } else {
    source = (await savePillSnapshot(result.snapshot, resolve(root, "verification-artifacts/pill-catalog"))).catalogPath;
  }
}
if (source) {
  const child = spawnSync(process.execPath, ["--experimental-strip-types", resolve(root, "backend/scripts/pill-catalog-web.ts"), resolve(source)], { cwd: root, stdio: "inherit" });
  process.exitCode = child.status ?? 1;
}
