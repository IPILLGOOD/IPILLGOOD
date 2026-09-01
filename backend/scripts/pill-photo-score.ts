import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadPillPhotoEvaluationFixture, type PillPhotoEvaluationSplit } from "../test-support/pill-photo-evaluation.ts";
import { loadFrozenPillPhotoFixture } from "../test-support/pill-photo-fixture.ts";
import { scorePillPhotoEvaluation } from "../test-support/pill-photo-score.ts";
import { readBoundedJson } from "./pill-catalog.ts";
import { serializePillProfile } from "./profile-pill-catalog.ts";

const OUTPUT = fileURLToPath(new URL("../../verification-artifacts/pill-photo-score/", import.meta.url));
const MAX_SCORE_INPUT_BYTES = 512 * 1024;
const HELP = `Offline pill-photo feature score (no model/API calls):
  --input <saved-features.json> --split validation
  --input <saved-features.json> --split holdout --confirm-holdout-final

The input must contain exactly the four opaque case IDs for the selected split.
Labels are loaded only after inference from the fixed Git evaluation fixture.
The holdout flag confirms that tuning rules are already frozen.
Reports are written under ignored verification-artifacts/pill-photo-score/.`;

export function parsePillPhotoScoreArgs(args: string[]) {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!;
    if (!["--input", "--split", "--confirm-holdout-final"].includes(flag) || flags.has(flag)) throw new Error("invalid_arguments");
    if (flag === "--confirm-holdout-final") { flags.set(flag, "true"); continue; }
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error("invalid_arguments");
    flags.set(flag, value);
  }
  if (!flags.has("--input") || !flags.has("--split")) throw new Error("missing_arguments");
  const split = flags.get("--split");
  if (split !== "validation" && split !== "holdout") throw new Error("invalid_split");
  const confirmed = flags.has("--confirm-holdout-final");
  if (split === "holdout" && !confirmed) throw new Error("holdout_confirmation_required");
  if (split === "validation" && confirmed) throw new Error("holdout_confirmation_not_allowed");
  return { inputPath: resolve(flags.get("--input")!), split: split as PillPhotoEvaluationSplit };
}

export async function runPillPhotoScore(
  args: string[],
  options: { outputDirectory?: string } = {},
) {
  const parsed = parsePillPhotoScoreArgs(args);
  const [value, evaluation, frozen] = await Promise.all([
    readBoundedJson(parsed.inputPath, MAX_SCORE_INPUT_BYTES),
    loadPillPhotoEvaluationFixture(),
    loadFrozenPillPhotoFixture(),
  ]);
  const report = scorePillPhotoEvaluation(value, evaluation.manifest, frozen.catalog, parsed.split);
  const root = options.outputDirectory ?? OUTPUT;
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "score-"));
  await writeFile(join(directory, "report.json"), serializePillProfile(report), { flag: "wx", mode: 0o600 });
  return { directory, report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length === 3 && process.argv[2] === "--help") console.log(HELP);
  else runPillPhotoScore(process.argv.slice(2)).then(({ directory, report }) => {
    console.log(serializePillProfile({
      status: report.passed ? "passed" : "failed",
      directory,
      split: report.split,
      scope: report.scope,
      metrics: report.metrics,
      gates: report.gates,
    }));
    if (!report.passed) process.exitCode = 1;
  }).catch((error: unknown) => {
    const safe = new Set([
      "invalid_arguments", "missing_arguments", "invalid_split", "holdout_confirmation_required",
      "holdout_confirmation_not_allowed", "invalid_file_size", "invalid_file_size_limit",
      "invalid_evaluation_input", "evaluation_case_mismatch", "evaluation_fixture_duplicate_entry",
      "evaluation_fixture_duplicate_product", "evaluation_fixture_duplicate_image",
      "evaluation_fixture_overlaps_development_images", "evaluation_fixture_case_mapping_invalid",
      "evaluation_fixture_receipt_path_mismatch", "evaluation_fixture_requires_opposite_sides",
      "evaluation_fixture_photo_reused", "evaluation_fixture_unreferenced_image",
      "evaluation_fixture_split_unbalanced", "evaluation_fixture_catalog_version_mismatch",
      "evaluation_fixture_official_label_mismatch", "evaluation_fixture_image_hash_mismatch",
      "fixture_catalog_hash_mismatch", "fixture_baseline_hash_mismatch", "fixture_baseline_mismatch",
      "fixture_image_manifest_mismatch", "fixture_catalog_invalid", "fixture_catalog_decode_failed",
      "fixture_size_exceeded",
    ]);
    console.error(JSON.stringify({ status: "unavailable", reason: error instanceof Error && safe.has(error.message) ? error.message : "local_operation_failed" }));
    process.exitCode = 1;
  });
}
