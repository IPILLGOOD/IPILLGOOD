// Capture BEFORE changing the search implementation. Offline; never overwrite an old run.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { comparePillPhotoFeatures, migratePillPhotoFeaturesV1 } from "../src/pill-photo-features.ts";
import { loadFrozenPillPhotoFixture } from "../test-support/pill-photo-fixture.ts";
import { runPillPhotoSignalCross } from "./pill-photo-signal-cross.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export async function fingerprintAuditInputs() {
  const paths: string[] = [];
  async function walk(relative: string) {
    for (const entry of await readdir(join(ROOT, relative), { withFileTypes: true })) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) paths.push(path);
      else throw new Error("audit_symlink_not_allowed");
    }
  }
  for (const path of ["verification-artifacts/pill-photo-trials/run-9EINEQ", "verification-artifacts/pill-photo-trials/run-Ao0hXp",
    "verification-artifacts/pill-photo-evaluation/run-zEpDgX", "verification-artifacts/pill-photo-score/score-E06wJf",
    "verification-artifacts/pill-photo-v4-intake"]) await walk(path);
  paths.push("backend/test-support/pill-photo-fixtures/catalog.json.gz", "backend/test-support/pill-photo-phone-evaluation/results-2026-09-02.json");
  return Promise.all(paths.sort().map(async path => ({ path, sha256: sha(await readFile(join(ROOT, path))) })));
}

export async function captureAuditBaseline(head: string) {
  if (!/^[a-f0-9]{40}$/.test(head)) throw new Error("audit_head_required");
  const inputFiles = await fingerprintAuditInputs();
  const cross = await runPillPhotoSignalCross(["--baseline", join(ROOT, "verification-artifacts/pill-photo-trials/run-9EINEQ"),
    "--candidate", join(ROOT, "verification-artifacts/pill-photo-trials/run-Ao0hXp")]);
  const frozen = await loadFrozenPillPhotoFixture();
  const rows = cross.bundle.report.repetitions.flatMap(repeat => repeat.cells.flatMap(cell => cell.observations.map(row => ({
    id: `${repeat.repetition}/${cell.id}/${row.id}`, scope: "validation_cross", features: row.features,
    result: comparePillPhotoFeatures(row.features, frozen.catalog),
  }))));
  for (const row of frozen.baseline.rows) {
    const features = migratePillPhotoFeaturesV1(row.extraction.features);
    rows.push({ id: `public/${row.id}`, scope: "public_saved_observation", features, result: comparePillPhotoFeatures(features, frozen.catalog) });
  }
  const historical = JSON.parse(await readFile(join(ROOT, "verification-artifacts/pill-photo-evaluation/run-zEpDgX/features.json"), "utf8"));
  for (const row of historical.cases) {
    if (row.extraction.status !== "ok") throw new Error("audit_historical_features_missing");
    rows.push({ id: `historical/${row.id}`, scope: "v5_current_prechange_not_historical_internal_trace", features: row.extraction.features,
      result: comparePillPhotoFeatures(row.extraction.features, frozen.catalog) });
  }
  const code = await Promise.all(["backend/src/pill-identification.ts", "backend/src/pill-photo-features.ts",
    "backend/src/pill-photo-ocr.ts", "backend/src/pill-photo-experiment.ts", "backend/src/pill-photo-pipeline.ts", "backend/src/pill-photo-preprocessing.ts",
    "backend/src/pill-photo-prompt-profiles.ts", "backend/test-support/pill-photo-score.ts"].map(async path => ({ path, sha256: sha(await readFile(join(ROOT, path))) })));
  const outputRoot = join(ROOT, "verification-artifacts/pill-photo-audit");
  await mkdir(outputRoot, { recursive: true });
  const directory = await mkdtemp(join(outputRoot, "baseline-"));
  const value = { schemaVersion: "pill-photo-behavior-baseline.v1", createdAt: new Date().toISOString(), head,
    runtime: process.version, externalRequests: 0, catalogVersion: frozen.catalog.version, catalogSha256: frozen.manifest.catalog.sha256,
    inputFiles, code, crossDirectory: cross.directory, rows };
  await writeFile(join(directory, "baseline.json"), JSON.stringify(value), { flag: "wx", mode: 0o600 });
  return { directory, rows: rows.length, protectedInputFiles: inputFiles.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  globalThis.fetch = async () => { throw new Error("audit_network_forbidden"); };
  captureAuditBaseline(process.argv[2] ?? "").then(value => console.log(JSON.stringify(value))).catch(() => {
    console.error("audit_baseline_failed"); process.exitCode = 1;
  });
}
