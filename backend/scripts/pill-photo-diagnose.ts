import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  comparePillPhotoDiagnostics, diagnosePillPhotoValidation, parsePillPhotoDiagnosticPreflight,
  renderPillPhotoDiagnostics, type PillPhotoDiagnosticsReport,
} from "../test-support/pill-photo-diagnostics.ts";
import { loadFrozenPillPhotoFixture, readBoundedFixtureFile } from "../test-support/pill-photo-fixture.ts";
import { loadPillPhotoPhoneValidationFixture } from "../test-support/pill-photo-phone-validation.ts";
import { loadPillPhotoPhoneEvaluationRecord, type PillPhotoPhoneEvaluationRecord } from "../test-support/pill-photo-phone-evaluation-record.ts";
import { serializePillProfile } from "./profile-pill-catalog.ts";

const OUTPUT = fileURLToPath(new URL("../../verification-artifacts/pill-photo-diagnostics/", import.meta.url));
const HELP = `Offline smartphone validation diagnostics (no server, API key or network requests):
  --run <saved-validation-run-directory> [--compare <another-validation-run-directory>]

Requires the private v4 validation fixture plus saved preflight.json, features.json and six case files.
Only v4 validation is accepted; holdout runs are rejected before loading their features.
Writes NEW report.json and report.html under ignored verification-artifacts/pill-photo-diagnostics/.
Exit 0 means diagnostic generation succeeded, NOT that recognition passed. See report.score.gates.`;

export function parsePillPhotoDiagnosticArgs(args: string[]) {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!;
    const value = args[++index];
    if (!["--run", "--compare"].includes(flag) || flags.has(flag) || !value || value.startsWith("--")) throw new Error("invalid_arguments");
    flags.set(flag, value);
  }
  if (!flags.has("--run")) throw new Error("missing_arguments");
  return [resolve(flags.get("--run")!), ...(flags.has("--compare") ? [resolve(flags.get("--compare")!)] : [])];
}

async function readRecordedJson(path: string, maxBytes: number) {
  const bytes = await readBoundedFixtureFile(path, maxBytes);
  return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown,
    sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** No private fixture or feature loader runs before every requested preflight passes. */
export async function readPillPhotoDiagnosticRuns(directories: string[]) {
  if (directories.length < 1 || directories.length > 2) throw new Error("invalid_arguments");
  const approved = [];
  for (const directory of directories) {
    const preflight = await readRecordedJson(join(directory, "preflight.json"), 16 * 1024);
    const parsed = parsePillPhotoDiagnosticPreflight(preflight.value);
    approved.push({ directory, preflight, parsed });
  }
  return Promise.all(approved.map(async ({ directory, preflight, parsed }) => {
    const features = await readRecordedJson(join(directory, "features.json"), 512 * 1024);
    const cases = await Promise.all(parsed.cases.map((id) => readRecordedJson(join(directory, `case-${id}.json`), 128 * 1024)));
    return {
      saved: { preflight: preflight.value, features: features.value, cases: cases.map((record) => record.value) },
      inputHashes: { preflight: preflight.sha256, features: features.sha256,
        cases: cases.map((record, index) => ({ id: parsed.cases[index]!, sha256: record.sha256 })) },
    };
  }));
}

function historicalComparison(report: PillPhotoDiagnosticsReport, ledger: PillPhotoPhoneEvaluationRecord) {
  const baseline = ledger.runs.find((run) => run.split === "validation"
    && run.fixtureVersion === report.fixtureVersion && run.createdAt === report.createdAt);
  if (!baseline) return { status: "no_matching_historical_record" };
  const metrics = report.score.metrics;
  const currentMetrics = {
    totalCases: metrics.totalCases, evaluatedCases: metrics.evaluatedCases,
    recallAt1: { hits: metrics.recallAt["1"]!.hits, total: metrics.recallAt["1"]!.total },
    recallAt5: { hits: metrics.recallAt["5"]!.hits, total: metrics.recallAt["5"]!.total },
    recallAt20: { hits: metrics.recallAt["20"]!.hits, total: metrics.recallAt["20"]!.total },
    strongWrongCandidates: metrics.strongWrongCandidateCount,
    retakeCandidateExposureCases: metrics.retakeCandidateExposureCaseCount,
  };
  return {
    status: "matched_by_fixture_and_timestamp_not_cryptographic_run_attestation",
    id: baseline.id, historical: baseline, currentMetrics,
    sameMetrics: JSON.stringify(baseline.metrics) === JSON.stringify(currentMetrics),
    sameRecordedVersions: baseline.pipeline.model === report.pipeline.model
      && baseline.pipeline.ocrModel === report.pipeline.ocrModel
      && baseline.pipeline.preprocessingVersion === report.pipeline.preprocessingVersion
      && baseline.pipeline.visionPromptVersion === report.pipeline.visionVersion
      && baseline.pipeline.ocrPromptVersion === report.pipeline.ocrVersion
      && baseline.pipeline.fusionVersion === report.pipeline.fusionVersion
      && baseline.pipeline.searchVersion === report.searchRulesVersion
      && baseline.pipeline.catalogVersion === report.catalogVersion,
    currentScorePolicy: report.score.policyVersion,
    historicalPassIsNotRewritten: true,
  };
}

export async function runPillPhotoDiagnostics(args: string[]) {
  const runs = await readPillPhotoDiagnosticRuns(parsePillPhotoDiagnosticArgs(args));
  const [{ manifest }, frozen, ledger] = await Promise.all([
    loadPillPhotoPhoneValidationFixture(), loadFrozenPillPhotoFixture(), loadPillPhotoPhoneEvaluationRecord(),
  ]);
  const reports = runs.map((run) => diagnosePillPhotoValidation(run.saved, manifest, frozen.catalog));
  const comparison = reports.length === 2 ? comparePillPhotoDiagnostics(reports[0]!, reports[1]!) : null;
  const bundle = { status: "diagnosed", externalRequests: 0, productionReadinessClaim: false,
    evidenceScope: "private_validation_saved_signals_not_new_inference",
    manifestContentSha256: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
    imageHashes: manifest.images.map(({ path, sha256 }) => ({ path, sha256 })),
    sourceHashes: runs.map((run) => run.inputHashes),
    reports, historicalComparison: reports.map((report) => historicalComparison(report, ledger)), comparison };
  // Redact environment secrets in both formats, never interpolate unescaped model text into HTML.
  const safeJson = serializePillProfile(bundle);
  const safe = JSON.parse(safeJson) as typeof bundle;
  await mkdir(OUTPUT, { recursive: true });
  const directory = await mkdtemp(join(OUTPUT, "diagnose-"));
  await writeFile(join(directory, "report.json"), safeJson, { flag: "wx", mode: 0o600 });
  await writeFile(join(directory, "report.html"), renderPillPhotoDiagnostics(safe.reports, safe.comparison), { flag: "wx", mode: 0o600 });
  return { directory, bundle };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length === 3 && process.argv[2] === "--help") console.log(HELP);
  else runPillPhotoDiagnostics(process.argv.slice(2)).then(({ directory, bundle }) => {
    console.log(serializePillProfile({ status: "diagnosed", directory, externalRequests: 0,
      runs: bundle.reports.map((report) => ({ createdAt: report.createdAt, pipeline: report.pipeline,
        metrics: report.score.metrics, recognitionGatePassed: report.score.passed })),
      comparison: bundle.comparison?.interpretation ?? null }));
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    const safe = /^(diagnostic_[a-z_]+|invalid_arguments|missing_arguments|invalid_evaluation_input|evaluation_case_mismatch|fixture_size_exceeded)$/.test(message);
    console.error(JSON.stringify({ status: "unavailable", reason: safe ? message : "local_input_missing_or_invalid" }));
    process.exitCode = 1;
  });
}
