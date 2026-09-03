import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  extractReviewedPillPhotos,
  pillPhotoExperimentVersions,
  type PhotoExtractionResult,
} from "../src/pill-photo-experiment.ts";
import {
  loadRegisteredPillPhotoEvaluationFixture,
  parsePillPhotoEvaluationFixtureKey,
  type PillPhotoEvaluationFixtureKey,
} from "../test-support/pill-photo-evaluation-registry.ts";
import { PILL_PHOTO_SCORE_SCHEMA_VERSION, type PillPhotoScoreInput } from "../test-support/pill-photo-score.ts";
import { serializePillProfile } from "./profile-pill-catalog.ts";

const OUTPUT = fileURLToPath(new URL("../../verification-artifacts/pill-photo-evaluation/", import.meta.url));
const STOP_FAILURES = new Set(["invalid_request", "access_denied", "rate_limited", "provider_unavailable", "timeout", "network_error", "not_configured"]);
const SCORE_FAILURES = new Set([
  "invalid_photo", "refused", "incomplete_response", "invalid_response", "access_denied",
  "rate_limited", "provider_unavailable", "timeout", "network_error", "ocr_failed", "fusion_failed",
]);
const HELP = `Reviewed evaluation photos (NOT a user-upload service):
  validation [--fixture v2|v3] --live --confirm-public-transfer
  validation --fixture v4 --live --confirm-reviewed-transfer
  holdout [--fixture v2|v3] --live --confirm-public-transfer --confirm-holdout-final
  holdout --fixture v5 --live --confirm-reviewed-transfer --confirm-holdout-final

The selected manifest's fixed, hash-verified photo pairs are processed sequentially.
Each pair uses one Vision and two surface-specific OCR requests without retries.
Labels and official product data never enter model requests. The output feature file
contains opaque case IDs only and is scored separately with pill:score.`;

export function parsePillPhotoEvaluationArgs(args: string[]) {
  const [split, ...rest] = args;
  if (split !== "validation" && split !== "holdout") throw new Error("invalid_split");
  const flags = new Set<string>();
  let fixture: PillPhotoEvaluationFixtureKey = "v2";
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index]!;
    if (flag === "--fixture") {
      if (flags.has(flag)) throw new Error("invalid_arguments");
      fixture = parsePillPhotoEvaluationFixtureKey(rest[++index]);
      flags.add(flag);
      continue;
    }
    if (!["--live", "--confirm-public-transfer", "--confirm-reviewed-transfer", "--confirm-holdout-final"].includes(flag) || flags.has(flag)) {
      throw new Error("invalid_arguments");
    }
    flags.add(flag);
  }
  if (!flags.has("--live")) throw new Error("explicit_transfer_required");
  if (fixture === "v4" || fixture === "v5") {
    if (fixture === "v4" && split !== "validation") throw new Error("phone_validation_split_required");
    if (fixture === "v5" && split !== "holdout") throw new Error("phone_holdout_split_required");
    if (!flags.has("--confirm-reviewed-transfer") || flags.has("--confirm-public-transfer")) {
      throw new Error("explicit_reviewed_transfer_required");
    }
  } else if (!flags.has("--confirm-public-transfer") || flags.has("--confirm-reviewed-transfer")) {
    throw new Error("explicit_public_transfer_required");
  }
  if (split === "holdout" && !flags.has("--confirm-holdout-final")) throw new Error("holdout_confirmation_required");
  if (split === "validation" && flags.has("--confirm-holdout-final")) throw new Error("holdout_confirmation_not_allowed");
  return { split: split as "validation" | "holdout", fixture };
}

type Extractor = typeof extractReviewedPillPhotos;

function scoreExtraction(result: PhotoExtractionResult): PillPhotoScoreInput["cases"][number]["extraction"] {
  if (result.ok) return { status: "ok", features: result.features, usage: result.usage };
  if (!SCORE_FAILURES.has(result.reason)) throw new Error("evaluation_preflight_failed");
  return { status: "failed", reason: result.reason as Extract<PillPhotoScoreInput["cases"][number]["extraction"], { status: "failed" }>["reason"] };
}

export async function runPillPhotoEvaluation(
  args: string[],
  options: {
    outputDirectory?: string;
    extractor?: Extractor;
    fetcher?: typeof fetch;
    now?: () => Date;
  } = {},
) {
  const parsed = parsePillPhotoEvaluationArgs(args);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-5.6-luna";
  const ocrModel = process.env.OPENAI_OCR_MODEL?.trim() || "gpt-5.6-sol";
  if (!apiKey || ![model, ocrModel].every((value) => /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,100}$/.test(value))) throw new Error("not_configured");
  const evaluation = await loadRegisteredPillPhotoEvaluationFixture(parsed.fixture);
  const selected = evaluation.inferenceInputs.filter((input) => input.split === parsed.split);
  const expectedCases = evaluation.cases.filter((fixtureCase) => fixtureCase.split === parsed.split);
  const preprocessingVersion = evaluation.preprocessing === "phone_centered"
    ? pillPhotoExperimentVersions.phonePreprocessing
    : pillPhotoExperimentVersions.preprocessing;
  if (!selected.length || selected.length !== expectedCases.length) throw new Error("evaluation_case_mismatch");

  // Read every selected image before the first request. The extractor independently
  // rechecks bytes against the fixed evaluation manifest to close the read/use gap.
  const pairs = await Promise.all(selected.map(async (input) => ({
    id: input.id,
    photos: await Promise.all(input.photos.map((path) => readFile(path))) as [Buffer, Buffer],
  })));
  const root = options.outputDirectory ?? OUTPUT;
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "run-"));
  const createdAt = (options.now ?? (() => new Date()))().toISOString();
  const extractor = options.extractor ?? extractReviewedPillPhotos;
  let requests = 0;
  const countedFetch: typeof fetch = async (input, init) => {
    requests++;
    return (options.fetcher ?? fetch)(input, init);
  };
  await writeFile(join(directory, "preflight.json"), serializePillProfile({
    status: "ready",
    fixtureVersion: evaluation.fixtureVersion,
    split: parsed.split,
    cases: selected.map((input) => input.id),
    maximumRequests: selected.length * 3,
    pipeline: { ...pillPhotoExperimentVersions, preprocessing: preprocessingVersion },
    model,
    ocrModel,
  }), { flag: "wx", mode: 0o600 });

  const cases: PillPhotoScoreInput["cases"] = [];
  for (const pair of pairs) {
    const result = await extractor(pair.photos, {
      allowExternalTransfer: true,
      photoSet: evaluation.photoSet,
      apiKey,
      model,
      ocrModel,
      fetchImpl: countedFetch,
    });
    await writeFile(join(directory, `case-${pair.id}.json`), serializePillProfile({ id: pair.id, extraction: result }), { flag: "wx", mode: 0o600 });
    cases.push({ id: pair.id, extraction: scoreExtraction(result) });
    console.error(serializePillProfile({ case: pair.id, status: result.ok ? "extracted" : result.reason, requests }));
    if (!result.ok && STOP_FAILURES.has(result.reason)) break;
  }

  if (cases.length !== selected.length) {
    await writeFile(join(directory, "incomplete.json"), serializePillProfile({ status: "incomplete", split: parsed.split, requests, completedCases: cases.map((entry) => entry.id) }), { flag: "wx", mode: 0o600 });
    throw new Error("evaluation_incomplete");
  }
  const output: PillPhotoScoreInput = {
    schemaVersion: PILL_PHOTO_SCORE_SCHEMA_VERSION,
    fixtureVersion: evaluation.fixtureVersion,
    split: parsed.split,
    createdAt,
    requests,
    pipeline: {
      mode: "vision_ocr",
      preprocessingVersion,
      visionVersion: pillPhotoExperimentVersions.prompt,
      model,
      ocrModel,
      ocrVersion: pillPhotoExperimentVersions.ocrPrompt,
      fusionVersion: pillPhotoExperimentVersions.fusion,
    },
    cases,
  };
  const featureFile = join(directory, "features.json");
  await writeFile(featureFile, serializePillProfile(output), { flag: "wx", mode: 0o600 });
  return { directory, featureFile, output };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length === 3 && process.argv[2] === "--help") console.log(HELP);
  else runPillPhotoEvaluation(process.argv.slice(2)).then(({ directory, featureFile, output }) => {
    console.log(serializePillProfile({ status: "saved", directory, featureFile, split: output.split, requests: output.requests }));
  }).catch((error: unknown) => {
    const safe = new Set([
      "invalid_split", "invalid_fixture", "invalid_arguments", "explicit_transfer_required", "explicit_public_transfer_required",
      "explicit_reviewed_transfer_required", "phone_validation_split_required", "phone_holdout_split_required", "holdout_confirmation_required",
      "holdout_confirmation_not_allowed", "not_configured", "evaluation_case_mismatch", "evaluation_preflight_failed",
      "evaluation_incomplete", "phone_validation_fixture_scope_mismatch", "phone_validation_fixture_duplicate_entry",
      "phone_validation_fixture_duplicate_product", "phone_validation_fixture_duplicate_official_record",
      "phone_validation_fixture_duplicate_image", "phone_validation_fixture_overlaps_previous_images",
      "phone_validation_fixture_history_mismatch", "phone_validation_fixture_case_mapping_invalid",
      "phone_validation_fixture_side_mapping_invalid", "phone_validation_fixture_requires_opposite_sides",
      "phone_validation_fixture_photo_reused", "phone_validation_fixture_unreferenced_image",
      "phone_validation_fixture_catalog_version_mismatch", "phone_validation_fixture_official_label_mismatch",
      "phone_validation_fixture_image_hash_mismatch", "phone_validation_fixture_image_metadata_mismatch",
    ]);
    console.error(JSON.stringify({ status: "unavailable", reason: error instanceof Error && safe.has(error.message) ? error.message : "local_operation_failed" }));
    process.exitCode = 1;
  });
}
