// Prepare only. This CLI intentionally has NO live/run command or API-key loading path.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { z } from "zod";
import { prepareReviewedPillPhotoRequests } from "../src/pill-photo-experiment.ts";
import { comparePillPhotoFeatures, pillPhotoFeaturesSchema } from "../src/pill-photo-features.ts";
import { loadPillPhotoPhoneValidationFixture } from "../test-support/pill-photo-phone-validation.ts";
import { loadRegisteredPillPhotoEvaluationFixture } from "../test-support/pill-photo-evaluation-registry.ts";
import { parseHumanPhotoReadings } from "../test-support/pill-photo-human-oracle.ts";
import { loadFrozenPillPhotoFixture, readBoundedFixtureFile } from "../test-support/pill-photo-fixture.ts";
import { assertCurrentPillPhotoTrialProtocol, describePillPhotoTrialPreparation, renderPillPhotoTrialPlan,
  trialSha256, PILL_PHOTO_TRIAL_PROTOCOL as BASE } from "../test-support/pill-photo-trial.ts";
import { buildOcrAbRequestPair, freezeOcrAbVision, ocrAbSchedule, OCR_AB_PROTOCOL } from "../test-support/pill-photo-ocr-ab.ts";
import { readPillPhotoDiagnosticRuns } from "./pill-photo-diagnose.ts";
import { fingerprintAuditInputs } from "./pill-photo-audit-baseline.ts";
import { serializePillProfile } from "./profile-pill-catalog.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUTPUT = join(ROOT, "verification-artifacts/pill-photo-ocr-ab");
const SOURCE = "verification-artifacts/pill-photo-trials/run-9EINEQ";
const BASELINE = "verification-artifacts/pill-photo-audit/baseline-zIf2Sd/baseline.json";
const HUMAN_REPORT = "verification-artifacts/pill-photo-audit/human-comparison-4Ntp5e/report.json";
const HUMAN_INPUT = "verification-artifacts/pill-photo-audit/human-input-20260907/readings.json";
const HELP = `OCR instructions A/B PREPARATION ONLY (no API key, network or server):
  prepare

Uses fixed v4 validation run-9EINEQ repetitions 1..3 as frozen Vision evidence.
Existing OCR vs stroke-check OCR; same model, image bytes, schema, preprocessing, fusion and search.
Writes a NEW ignored plan directory with image PNGs, frozen Vision, request hashes and schedule.
No run/live option exists here. A future live executor requires separate review/authorization.
Success means preparation verified, NOT improved photo accuracy or production readiness.`;
const check = (ok: boolean, reason: string) => { if (!ok) throw new Error(`ocr_ab_${reason}`); };
const hashObject = (value: unknown) => trialSha256(JSON.stringify(value));
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const recordedCondition = z.object({ protocol: z.unknown(), catalogSha256: hashSchema,
  fixtureContentSha256: hashSchema,
  cases: z.array(z.object({ id: z.string(), sourceSha256: z.array(hashSchema), preprocessing: z.unknown(),
    requests: z.array(z.object({ stage: z.string(), bodySha256: hashSchema, images: z.unknown() })) })).length(6) });
const baselineSchema = z.object({ rows: z.array(z.object({ id: z.string(), features: pillPhotoFeaturesSchema, result: z.unknown() })).length(84) });
export function parseOcrAbPrepareArgs(args: string[]) {
  check(args.length === 1 && args[0] === "prepare", "prepare_only_no_live_arguments"); return "prepare" as const;
}
async function readJson(path: string, maximum = 2 * 1024 * 1024) {
  const bytes = await readBoundedFixtureFile(join(ROOT, path), maximum);
  return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown, sha256: trialSha256(bytes) };
}
async function save(directory: string, name: string, value: unknown) {
  await writeFile(join(directory, name), serializePillProfile(value), { flag: "wx", mode: 0o600 });
}

export async function prepareOcrAb() {
  assertCurrentPillPhotoTrialProtocol();
  const protectedBefore = await fingerprintAuditInputs();
  const baselineFile = await readJson(BASELINE, 32 * 1024 * 1024);
  check(baselineFile.sha256 === "76602845d23400335199aafec211db8b877a8fc61450336a801e674d46dc3ffd", "baseline_changed");
  const [historicalFile, humanFile, humanInput, validation, frozen, registered] = await Promise.all([
    readJson(`${SOURCE}/condition.json`), readJson(HUMAN_REPORT, 32 * 1024 * 1024), readJson(HUMAN_INPUT),
    loadPillPhotoPhoneValidationFixture(), loadFrozenPillPhotoFixture(), loadRegisteredPillPhotoEvaluationFixture("v4"),
  ]);
  const humanMetadata = z.object({ currentCode: z.array(z.object({ path: z.string(), sha256: hashSchema })) }).parse(humanFile.value);
  const codePaths = [...new Set([...humanMetadata.currentCode.map(file => file.path),
    "backend/test-support/pill-photo-ocr-ab.ts", "backend/scripts/pill-photo-ocr-ab.ts",
    "backend/test-support/pill-photo-ocr-ab.test.ts", "backend/test-support/pill-photo-ocr-profiles.test.ts", "backend/package.json", "package-lock.json"])];
  const fingerprintCode = async () => Promise.all(codePaths.map(async path => ({ path,
    sha256: trialSha256(await readBoundedFixtureFile(join(ROOT, path), 4 * 1024 * 1024)) })));
  const code = await fingerprintCode();
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", windowsHide: true }).trim();
  const historical = recordedCondition.parse(historicalFile.value);
  check(isDeepStrictEqual(historical.protocol, BASE) && historical.catalogSha256 === frozen.manifest.catalog.sha256, "historical_settings_changed");
  // The historical trial hashed the registry adapter, not the richer raw private manifest.
  check(historical.fixtureContentSha256 === hashObject({ products: registered.products,
    images: registered.images, cases: registered.cases }), "historical_fixture_changed");
  const humanEvidence = parseHumanPhotoReadings(humanInput.value, validation.manifest);
  const humanSides = humanEvidence.cases.flatMap(row => row.sides);
  const baseline = baselineSchema.parse(baselineFile.value);
  for (const row of baseline.rows) check(isDeepStrictEqual(comparePillPhotoFeatures(row.features, frozen.catalog), row.result), "default_search_behavior_changed");
  const savedRuns = [];
  for (const repetition of [1, 2, 3]) {
    const id = `${SOURCE}/repeat-${repetition}`;
    const [loaded] = await readPillPhotoDiagnosticRuns([join(ROOT, id)]);
    savedRuns.push({ id, ...loaded! });
  }
  const frozenVision = freezeOcrAbVision(savedRuns, validation.manifest, frozen.catalog, historical.cases.map(row => ({
    caseId: row.id, sourceSha256: row.sourceSha256,
    legacyBodySha256: { front: row.requests.find(request => request.stage === "ocrFront")?.bodySha256 ?? "",
      back: row.requests.find(request => request.stage === "ocrBack")?.bodySha256 ?? "" },
  })));
  const images = new Map<string, Buffer>();
  const cases = [];
  const previewCases = [];
  for (const entry of validation.inferenceInputs) {
    const photos = await Promise.all(entry.photos.map(path => readBoundedFixtureFile(path, 5 * 1024 * 1024))) as [Buffer, Buffer];
    const prepared = await prepareReviewedPillPhotoRequests(photos, { photoSet: "phone_validation", model: BASE.model,
      ocrModel: BASE.ocrModel, visionPromptVersion: BASE.visionPrompt });
    if (!prepared.ok) throw new Error("ocr_ab_preparation_failed");
    const description = await describePillPhotoTrialPreparation(prepared);
    const old = historical.cases.find(row => row.id === entry.id);
    check(!!old && isDeepStrictEqual(old.sourceSha256, description.manifest.sourceSha256)
      && isDeepStrictEqual(old.preprocessing, description.manifest.preprocessing), "historical_preprocessing_changed");
    // Exact hashes prove current default bytes/settings still match the stored baseline; no image approximation.
    check(description.manifest.requests.every((request, index) => request.stage === old!.requests[index]?.stage
      && request.bodySha256 === old!.requests[index]?.bodySha256
      && isDeepStrictEqual(request.images, old!.requests[index]?.images)), "historical_request_changed");
    const pair = buildOcrAbRequestPair(prepared);
    const ocrDescriptions = description.manifest.requests.filter(request => request.stage !== "vision");
    for (const request of ocrDescriptions) for (const image of request.images) images.set(image.sha256, description.images.get(image.sha256)!);
    const requestConditions = (["legacy", "stroke_check"] as const).map(condition => ({ condition,
      requests: ocrDescriptions.map((request, index) => {
        const actual = pair[condition][index === 0 ? "front" : "back"];
        return { ...request, bodySha256: hashObject(actual), instructionsSha256: trialSha256(actual.instructions),
          requestDescription: { ...request.requestDescription, instructions: actual.instructions } };
      }) }));
    cases.push({ caseId: entry.id, sourceSha256: prepared.sourceSha256, preprocessing: prepared.preprocessing, requestConditions });
    previewCases.push({ id: entry.id, ...description.manifest, requests: ocrDescriptions });
  }
  const sources = [
    { path: BASELINE, sha256: baselineFile.sha256, maximum: 32 * 1024 * 1024 },
    { path: `${SOURCE}/condition.json`, sha256: historicalFile.sha256, maximum: 2 * 1024 * 1024 },
    { path: HUMAN_REPORT, sha256: humanFile.sha256, maximum: 32 * 1024 * 1024 },
    { path: HUMAN_INPUT, sha256: humanInput.sha256, maximum: 2 * 1024 * 1024 },
  ];
  const verifySources = async () => {
    check(isDeepStrictEqual(code, await fingerprintCode()), "code_changed_during_preparation");
    check(isDeepStrictEqual(protectedBefore, await fingerprintAuditInputs()), "protected_inputs_changed");
    for (const file of sources) check((await readJson(file.path, file.maximum)).sha256 === file.sha256, "historical_file_changed");
  };
  await verifySources();
  const condition = { protocol: OCR_AB_PROTOCOL, currentHead: head, code,
    runtime: { node: process.version, platform: process.platform, arch: process.arch, sharp: sharp.versions },
    catalogVersion: frozen.catalog.version, catalogSha256: frozen.manifest.catalog.sha256,
    fixtureSha256: hashObject(validation.manifest), sources,
    frozenVisionSha256: hashObject(frozenVision), savedRuns: savedRuns.map(run => ({ id: run.id, hashes: run.inputHashes })),
    imageBindings: validation.manifest.images.map(({ path, sha256 }) => ({ path, sha256 })), cases,
    schedule: ocrAbSchedule(), safetyCoverage: {
      humanReviewedTextSides: humanSides.filter(side => side.imprintCandidates.length > 0).length,
      humanReviewedNoTextSides: humanSides.filter(side => side.reviewState === "reviewed_no_text").length,
      humanReviewedUnreadableSides: humanSides.filter(side => side.reviewState === "reviewed_unreadable").length,
      humanReviewedLogoPresentSides: humanSides.filter(side => side.nonTextMark === "present").length,
      additionalReviewedSafetyExamplesRequired: true },
    limits: ["Preparation, not inference. No automatic live execution or prompt promotion.",
      "Human labels and stored Vision are never part of the OCR request body.",
      "Model alias is unchanged, not a pinned provider snapshot; future response-model IDs and repeat variability must be recorded.",
      "Historical OCR is a reference, not the fresh legacy arm. Failures cannot be replaced with it.",
      "v5 is not an experiment input. A new unused evaluation set is needed after development."] };
  await mkdir(OUTPUT, { recursive: true });
  const directory = await mkdtemp(join(OUTPUT, "plan-"));
  await mkdir(join(directory, "images"));
  for (const [hash, bytes] of images) await writeFile(join(directory, "images", `${hash}.png`), bytes, { flag: "wx", mode: 0o600 });
  await save(directory, "frozen-vision.json", frozenVision);
  await save(directory, "plan.json", { schemaVersion: "pill-photo-ocr-ab-plan.v1", preparedAt: new Date().toISOString(),
    externalRequests: 0, newInference: false, conditionSha256: hashObject(condition), condition,
    preservation: { protectedFiles: protectedBefore.length, unchangedSearchResults: baseline.rows.length,
      includingSavedCrossCombinations: 72, historicalDefaultRequestBodiesEqual: 18 } });
  const preview = renderPillPhotoTrialPlan(previewCases).replace(
    "Vision: A 전체·세부, B 전체·세부 순서. OCR:",
    "Vision은 저장 관찰로 고정하며 새 요청을 보내지 않습니다. 아래 두 OCR 지침은 같은 이미지들을 사용합니다. OCR:");
  await writeFile(join(directory, "preview.html"), preview, { flag: "wx", mode: 0o600 });
  await verifySources();
  return { status: "prepared", directory: relative(ROOT, directory), externalRequests: 0, visionRequests: 0,
    uniquePreparedImages: images.size, frozenObservations: frozenVision.length, scheduledConditionCases: condition.schedule.length,
    maximumFutureOcrRequests: 72, unchangedSearchResults: baseline.rows.length, historicalDefaultRequestBodiesEqual: 18,
    accuracyImprovementMeasured: false, liveExecutionAvailableInThisCli: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length === 3 && process.argv[2] === "--help") console.log(HELP);
  else Promise.resolve().then(() => { parseOcrAbPrepareArgs(process.argv.slice(2)); return prepareOcrAb(); })
    .then(result => console.log(serializePillProfile(result))).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      console.error(JSON.stringify({ status: "unavailable", externalRequests: 0,
        reason: /^ocr_ab_[a-z_]+$/.test(message) ? message : "ocr_ab_private_input_missing_or_invalid" })); process.exitCode = 1;
    });
}
