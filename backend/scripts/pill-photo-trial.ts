import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { z } from "zod";
import type { PillCatalog } from "../src/pill-identification.ts";
import { extractReviewedPillPhotos, prepareReviewedPillPhotoRequests, pillPhotoExperimentVersions } from "../src/pill-photo-experiment.ts";
import { loadRegisteredPillPhotoEvaluationFixture } from "../test-support/pill-photo-evaluation-registry.ts";
import { loadFrozenPillPhotoFixture, readBoundedFixtureFile } from "../test-support/pill-photo-fixture.ts";
import { PILL_PHOTO_SCORE_SCHEMA_VERSION, scorePillPhotoEvaluation, type PillPhotoScoreInput, type PillPhotoScoringManifest } from "../test-support/pill-photo-score.ts";
import { assertCurrentPillPhotoTrialProtocol, assertPillPhotoTrialPreparation, createPillPhotoTrialRequestGuard,
  describePillPhotoTrialPreparation, PILL_PHOTO_TRIAL_CASE_IDS, PILL_PHOTO_TRIAL_PROTOCOL,
  summarizePillPhotoTrialRepeats, trialSha256, renderPillPhotoTrialPlan, pillPhotoTrialProtocol,
  type PillPhotoTrialProtocol, type PillPhotoTrialCasePreparation } from "../test-support/pill-photo-trial.ts";
import { serializePillProfile } from "./profile-pill-catalog.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUTPUT = join(ROOT, "verification-artifacts/pill-photo-trials");
const CODE_FILES = [
  "backend/src/pill-photo-experiment.ts", "backend/src/pill-photo-features.ts", "backend/src/pill-photo-ocr.ts",
  "backend/src/pill-photo-prompt-profiles.ts",
  "backend/src/pill-photo-preprocessing.ts", "backend/src/pill-identification.ts", "backend/src/pill-form-policy.ts",
  "backend/src/official-pill-catalog.ts", "backend/src/pill-catalog-snapshot.ts", "backend/test-support/pill-photo-score.ts",
  "backend/test-support/pill-photo-phone-validation.ts", "backend/test-support/pill-photo-fixture.ts",
  "backend/test-support/pill-photo-evaluation-registry.ts", "backend/test-support/pill-photo-trial.ts",
  "backend/scripts/pill-photo-trial.ts", "package-lock.json",
];
const HELP = `Controlled v4 validation only (never holdout):
  prepare [--protocol <id>]                    # keyless; no API; writes exact request-image PNGs
  run --plan <plan-directory> [--protocol <id>] --live --confirm-reviewed-transfer

Protocols: validation-baseline-v1 (default), validation-structured-observation-v1 (Vision instructions only).

The versioned baseline uses Sol Vision + Sol OCR, the current prompts, and THREE repetitions.
A complete live trial makes at most 54 requests; no retries, no selective repeats or best-run selection.
Set OPENAI_API_KEY only for run. OPENAI_MODEL / OPENAI_OCR_MODEL do not override the protocol.
run verifies code/runtime/input/request fingerprints and all saved PNGs before the first request.
Outputs are private ignored artifacts. Run success is not production readiness.`;

export function parsePillPhotoTrialArgs(args: string[]) {
  if (args[0] !== "prepare" && args[0] !== "run") throw new Error("trial_invalid_arguments");
  const mode = args[0];
  const flags = new Map<string, string>();
  for (let index = 1; index < args.length; index++) {
    const flag = args[index]!;
    const allowed = mode === "prepare" ? ["--protocol"] : ["--plan", "--live", "--confirm-reviewed-transfer", "--protocol"];
    if (!allowed.includes(flag) || flags.has(flag)) throw new Error("trial_invalid_arguments");
    const value = flag === "--plan" || flag === "--protocol" ? args[++index] : "true";
    if (!value || value.startsWith("--")) throw new Error("trial_invalid_arguments");
    flags.set(flag, value);
  }
  const protocolId = flags.get("--protocol");
  pillPhotoTrialProtocol(protocolId);
  const selected = protocolId ? { protocolId } : {};
  if (mode === "prepare") return { mode: "prepare" as const, ...selected };
  if (!flags.has("--plan") || !flags.has("--live") || !flags.has("--confirm-reviewed-transfer")) throw new Error("trial_explicit_transfer_required");
  return { mode: "run" as const, planDirectory: resolve(flags.get("--plan")!), ...selected };
}

async function codeFingerprint() {
  return Promise.all(CODE_FILES.map(async (path) => ({ path,
    sha256: trialSha256(await readBoundedFixtureFile(join(ROOT, path), 4 * 1024 * 1024)) })));
}
async function saveJson(directory: string, name: string, value: unknown) {
  await writeFile(join(directory, name), serializePillProfile(value), { flag: "wx", mode: 0o600 });
}

async function prepareContext(protocol: PillPhotoTrialProtocol) {
  assertCurrentPillPhotoTrialProtocol(protocol);
  const [fixture, frozen, code] = await Promise.all([
    loadRegisteredPillPhotoEvaluationFixture("v4"), loadFrozenPillPhotoFixture(), codeFingerprint(),
  ]);
  if (fixture.fixtureVersion !== PILL_PHOTO_TRIAL_PROTOCOL.fixtureVersion || fixture.products.length !== 6 || fixture.images.length !== 12
    || !isDeepStrictEqual(fixture.inferenceInputs.map((entry) => entry.id), PILL_PHOTO_TRIAL_CASE_IDS)
    || fixture.inferenceInputs.some((entry) => entry.split !== "validation")) throw new Error("trial_validation_fixture_required");
  const images = new Map<string, Buffer>();
  const pairs = [];
  const cases = [];
  for (const entry of fixture.inferenceInputs) {
    const photos = await Promise.all(entry.photos.map((path) => readBoundedFixtureFile(path, 5 * 1024 * 1024))) as [Buffer, Buffer];
    const prepared = await prepareReviewedPillPhotoRequests(photos, { photoSet: "phone_validation",
      model: protocol.model, ocrModel: protocol.ocrModel, visionPromptVersion: protocol.visionPrompt });
    if (!prepared.ok) throw new Error("trial_preparation_failed");
    const described = await describePillPhotoTrialPreparation(prepared, protocol);
    for (const [hash, bytes] of described.images) images.set(hash, bytes);
    pairs.push({ id: entry.id, photos });
    cases.push({ id: entry.id, ...described.manifest });
  }
  const condition = { schemaVersion: "pill-photo-trial-condition.v1", protocol,
    runtime: { node: process.version, platform: process.platform, arch: process.arch, sharp: sharp.versions }, code,
    fixtureVersion: fixture.fixtureVersion, fixtureContentSha256: trialSha256(JSON.stringify({
      products: fixture.products, images: fixture.images, cases: fixture.cases,
    })), catalogVersion: frozen.catalog.version, catalogSha256: frozen.manifest.catalog.sha256, cases };
  // Detect source edits while preparations were running, rather than silently binding mixed code versions.
  if (!isDeepStrictEqual(code, await codeFingerprint())) throw new Error("trial_code_changed_during_preparation");
  return { condition, conditionSha256: trialSha256(JSON.stringify(condition)), images, pairs, fixture, catalog: frozen.catalog };
}
export interface PillPhotoTrialExecutionContext {
  condition: { protocol: PillPhotoTrialProtocol; code: { path: string; sha256: string }[];
    cases: ({ id: string } & PillPhotoTrialCasePreparation)[] };
  conditionSha256: string;
  pairs: { id: string; photos: readonly [Uint8Array, Uint8Array] }[];
  fixture: PillPhotoScoringManifest;
  catalog: PillCatalog;
}

const planSchema = z.object({ schemaVersion: z.literal("pill-photo-trial-plan.v1"), preparedAt: z.string().datetime(),
  externalRequests: z.literal(0), conditionSha256: z.string().regex(/^[a-f0-9]{64}$/), condition: z.unknown() }).strict();

export function assertPillPhotoTrialPlan(value: unknown, condition: unknown) {
  const parsed = planSchema.safeParse(value);
  if (!parsed.success || parsed.data.conditionSha256 !== trialSha256(JSON.stringify(parsed.data.condition))
    || !isDeepStrictEqual(parsed.data.condition, condition)) throw new Error("trial_plan_changed_or_invalid");
  return parsed.data;
}

/** Testable repetition/order orchestration. Incomplete repeats are NEVER scored as smaller successful sets. */
export async function executePillPhotoTrialRepeats(
  executeCase: (repetition: number, id: string) => Promise<boolean>,
  finishRepeat: (repetition: number) => Promise<void>,
) {
  for (let repetition = 1; repetition <= PILL_PHOTO_TRIAL_PROTOCOL.repetitions; repetition++) {
    for (const id of PILL_PHOTO_TRIAL_CASE_IDS) if (!await executeCase(repetition, id)) return { status: "incomplete" as const, repetition, failedCaseId: id };
    await finishRepeat(repetition);
  }
  return { status: "complete" as const };
}

/** Filesystem executor; injected extractor is for synthetic tests only, never a CLI option. */
export async function executePillPhotoTrialRun(context: PillPhotoTrialExecutionContext, directory: string, apiKey: string,
  extractor: typeof extractReviewedPillPhotos = extractReviewedPillPhotos) {
  const { condition, pairs, fixture, catalog } = context;
  const attempts = { attempted: 0 };
  const reports: { repetition: number; rows: ReturnType<typeof scorePillPhotoEvaluation>["rows"]; passed: boolean }[] = [];
  const responseModels: { stage: string; value: string | null }[] = [];
  let cases: PillPhotoScoreInput["cases"] = [];
  let repeatDirectory = "";
  let repeatCreatedAt = "";
  let startAttempts = 0;
  let activeRepetition = 0;
  let activeCase: string | null = null;
  await saveJson(directory, "trial-start.json", { schemaVersion: "pill-photo-trial-execution.v1", conditionSha256: context.conditionSha256,
    protocol: condition.protocol, startedAt: new Date().toISOString(), code: condition.code });
  await saveJson(directory, "condition.json", condition);
  try {
    const status = await executePillPhotoTrialRepeats(async (repetition, id) => {
      activeRepetition = repetition; activeCase = id;
      if (id === PILL_PHOTO_TRIAL_CASE_IDS[0]) {
        cases = []; repeatCreatedAt = new Date().toISOString(); startAttempts = attempts.attempted;
        repeatDirectory = join(directory, `repeat-${repetition}`);
        await mkdir(repeatDirectory);
        await saveJson(repeatDirectory, "preflight.json", { status: "ready", fixtureVersion: fixture.fixtureVersion, split: "validation",
          cases: PILL_PHOTO_TRIAL_CASE_IDS, maximumRequests: 18,
          pipeline: { ...pillPhotoExperimentVersions, preprocessing: condition.protocol.preprocessing, prompt: condition.protocol.visionPrompt },
          model: condition.protocol.model, ocrModel: condition.protocol.ocrModel });
      }
      const pair = pairs.find((pair) => pair.id === id)!;
      const prepared = condition.cases.find((entry) => entry.id === id)!;
      const guard = createPillPhotoTrialRequestGuard(prepared, attempts);
      const result = await extractor(pair.photos, {
        allowExternalTransfer: true, apiKey, model: condition.protocol.model, ocrModel: condition.protocol.ocrModel,
        visionPromptVersion: condition.protocol.visionPrompt,
        photoSet: "phone_validation",
        onPrepared: async (actual) => { assertPillPhotoTrialPreparation(prepared, actual); },
        onRequestTrace: async (event) => {
          if (event.phase === "started") guard.start(event.stage, event.requestSha256);
          else { guard.finish(event.stage); responseModels.push({ stage: event.stage, value: event.responseModel }); }
          // Persist intent BEFORE fetch and completion AFTER it; no Authorization headers, API keys or raw error bodies.
          await saveJson(repeatDirectory, `${id}-${event.stage}-${event.phase}.json`, { at: new Date().toISOString(), ...event });
        },
      });
      await saveJson(repeatDirectory, `case-${id}.json`, { id, extraction: result });
      console.error(JSON.stringify({ repetition, case: id, status: result.ok ? "extracted" : result.reason, requestIntents: attempts.attempted }));
      if (!result.ok) return false;
      if (!guard.complete()) throw new Error("trial_incomplete_request_trace");
      cases.push({ id, extraction: { status: "ok", features: result.features, usage: result.usage } });
      return true;
    }, async (repetition) => {
      const input: PillPhotoScoreInput = { schemaVersion: PILL_PHOTO_SCORE_SCHEMA_VERSION, fixtureVersion: fixture.fixtureVersion,
        split: "validation", createdAt: repeatCreatedAt, requests: attempts.attempted - startAttempts,
        pipeline: { mode: "vision_ocr", preprocessingVersion: condition.protocol.preprocessing,
          visionVersion: condition.protocol.visionPrompt, model: condition.protocol.model, ocrModel: condition.protocol.ocrModel,
          ocrVersion: condition.protocol.ocrPrompt, fusionVersion: condition.protocol.fusion }, cases };
      await saveJson(repeatDirectory, "features.json", input);
      const score = scorePillPhotoEvaluation(input, fixture, catalog, "validation");
      await saveJson(repeatDirectory, "score.json", score);
      reports.push({ repetition, rows: score.rows, passed: score.passed });
    });
    const summary = { ...status, conditionSha256: context.conditionSha256, requestIntents: attempts.attempted,
      responseModels, completedRepetitions: reports.length, productionReadinessClaim: false,
      comparison: status.status === "complete" ? summarizePillPhotoTrialRepeats(reports) : null };
    await saveJson(directory, "summary.json", summary);
    return summary;
  } catch (error: unknown) {
    const reason = error instanceof Error && /^trial_[a-z_]+$/.test(error.message) ? error.message : "trial_recording_or_execution_failed";
    const summary = { status: "incomplete", reason, activeRepetition, activeCase,
      conditionSha256: context.conditionSha256, requestIntents: attempts.attempted, completedRepetitions: reports.length,
      comparison: null, productionReadinessClaim: false };
    await saveJson(directory, "incomplete.json", summary);
    return summary;
  }
}

export async function runPillPhotoTrial(args: string[]) {
  const parsed = parsePillPhotoTrialArgs(args);
  const apiKey = parsed.mode === "run" ? process.env.OPENAI_API_KEY?.trim() : undefined;
  if (parsed.mode === "run" && !apiKey) throw new Error("trial_api_key_required");
  const context = await prepareContext(pillPhotoTrialProtocol(parsed.protocolId));
  if (parsed.mode === "run") {
    const bytes = await readBoundedFixtureFile(join(parsed.planDirectory, "plan.json"), 2 * 1024 * 1024);
    assertPillPhotoTrialPlan(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), context.condition);
    for (const [sha256, expected] of context.images) {
      const stored = await readBoundedFixtureFile(join(parsed.planDirectory, "images", `${sha256}.png`), expected.length);
      if (trialSha256(stored) !== sha256) throw new Error("trial_saved_image_changed");
    }
  }
  await mkdir(OUTPUT, { recursive: true });
  const directory = await mkdtemp(join(OUTPUT, parsed.mode === "prepare" ? "plan-" : "run-"));
  if (parsed.mode === "prepare") {
    await mkdir(join(directory, "images"));
    for (const [hash, bytes] of context.images) await writeFile(join(directory, "images", `${hash}.png`), bytes, { flag: "wx", mode: 0o600 });
    await saveJson(directory, "plan.json", { schemaVersion: "pill-photo-trial-plan.v1", preparedAt: new Date().toISOString(),
      externalRequests: 0, conditionSha256: context.conditionSha256, condition: context.condition });
    await writeFile(join(directory, "preview.html"), renderPillPhotoTrialPlan(context.condition.cases), { flag: "wx", mode: 0o600 });
    return { status: "prepared", directory, externalRequests: 0, images: context.images.size,
      repetitions: context.condition.protocol.repetitions, maximumLiveRequests: context.condition.protocol.maximumRequests,
      conditionSha256: context.conditionSha256 };
  }
  return { directory, ...await executePillPhotoTrialRun(context, directory, apiKey!) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length === 3 && process.argv[2] === "--help") console.log(HELP);
  else runPillPhotoTrial(process.argv.slice(2)).then((result) => {
    console.log(serializePillProfile(result));
    if (result.status === "incomplete") process.exitCode = 1;
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    console.error(JSON.stringify({ status: "unavailable", reason: /^trial_[a-z_]+$/.test(message) ? message : "trial_local_input_missing_or_invalid" }));
    process.exitCode = 1;
  });
}
