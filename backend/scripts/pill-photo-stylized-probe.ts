import { readFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { runPillPhotoSignalCross } from "./pill-photo-signal-cross.ts";
import { readPillPhotoDiagnosticRuns } from "./pill-photo-diagnose.ts";
import { readBoundedFixtureFile, loadFrozenPillPhotoFixture } from "../test-support/pill-photo-fixture.ts";
import { fusePillPhotoSignals, pillPhotoOcrFeaturesSchema } from "../src/pill-photo-ocr.ts";
import { inspectPillFeatures } from "../test-support/pill-photo-vision-fields.ts";
import { buildVisionProbeRequests, executeVisionProbeOrder, probeHash, requestVisionProbe, STYLIZED_PROBE_VERSION,
  STYLIZED_TEXT_ADDITION, visionProbeOrder } from "../test-support/pill-photo-stylized-probe.ts";
import { serializePillProfile } from "./profile-pill-catalog.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUTPUT = join(ROOT, "verification-artifacts/pill-photo-stylized-probe");
const FILES = ["backend/scripts/pill-photo-stylized-probe.ts", "backend/test-support/pill-photo-stylized-probe.ts",
  "backend/test-support/pill-photo-vision-fields.ts", "backend/scripts/pill-photo-signal-cross.ts",
  "backend/test-support/pill-photo-signal-cross.ts", "backend/scripts/pill-photo-diagnose.ts", "backend/test-support/pill-photo-diagnostics.ts",
  "backend/test-support/pill-photo-trial-comparison.ts", "backend/scripts/pill-photo-trial-compare.ts"];
const fingerprints = () => Promise.all(FILES.map(async path => ({ path, sha256: probeHash(await readFile(join(ROOT, path))) })));
const candidateCondition = z.object({ code: z.array(z.object({ path: z.string(), sha256: z.string() })),
  cases: z.array(z.object({ id: z.string(), requests: z.array(z.object({ bodySha256: z.string(),
    images: z.array(z.object({ path: z.string(), sha256: z.string(), bytes: z.number() })) })) })) });
const rawOcr = z.object({ id: z.string(), extraction: z.object({ signals: z.object({ ocr: z.object({ features: pillPhotoOcrFeaturesSchema }) }) }) });
export function parseStylizedProbeArgs(args: string[]) {
  const mode = args[0]; if (mode !== "prepare" && mode !== "run") throw Error("probe_arguments");
  const values = new Map<string, string>();
  for (let i = 1; i < args.length; i++) {
    const flag = args[i]!;
    const allowed = ["--baseline", "--candidate", "--image-root", ...(mode === "run" ? ["--plan", "--live", "--confirm-validation-transfer"] : [])];
    if (!allowed.includes(flag) || values.has(flag)) throw Error("probe_arguments");
    const value = flag === "--live" || flag === "--confirm-validation-transfer" ? "true" : args[++i];
    if (!value || value.startsWith("--")) throw Error("probe_arguments"); values.set(flag, value);
  }
  if (!["--baseline", "--candidate", "--image-root"].every(flag => values.has(flag))
    || mode === "run" && !["--plan", "--live", "--confirm-validation-transfer"].every(flag => values.has(flag))) throw Error("probe_explicit_arguments_required");
  return { mode, baseline: resolve(values.get("--baseline")!), candidate: resolve(values.get("--candidate")!),
    imageRoot: resolve(values.get("--image-root")!), plan: values.has("--plan") ? resolve(values.get("--plan")!) : null };
}
const save = (directory: string, name: string, value: unknown) => writeFile(join(directory, name), serializePillProfile(value), { flag: "wx", mode: 0o600 });

async function prepare(options: ReturnType<typeof parseStylizedProbeArgs>) {
  const ownCode = await fingerprints();
  const { bundle } = await runPillPhotoSignalCross(["--baseline", options.baseline, "--candidate", options.candidate]);
  const conditionBytes = await readBoundedFixtureFile(join(options.candidate, "condition.json"), 2 * 1024 * 1024);
  if (probeHash(conditionBytes) !== bundle.sourceTrialFileHashes.candidate.condition) throw Error("probe_source_changed");
  // The complete condition schema and all six identities were checked by the original comparison above.
  const condition = candidateCondition.parse(JSON.parse(conditionBytes.toString("utf8")));
  const requests = [], imageBindings = [];
  for (const entry of condition.cases) {
    const images = [];
    for (const image of entry.requests[0]!.images) {
      if (image.path !== `images/${image.sha256}.png` || !/^[a-f0-9]{64}$/.test(image.sha256)) throw Error("probe_image_path");
      const bytes = await readBoundedFixtureFile(join(options.imageRoot, image.path), 8 * 1024 * 1024);
      if (bytes.length !== image.bytes || probeHash(bytes) !== image.sha256) throw Error("probe_image_changed");
      images.push(bytes); imageBindings.push({ id: entry.id, ...image });
    }
    const built = buildVisionProbeRequests(images);
    if (probeHash(JSON.stringify(built.structured_control)) !== entry.requests[0]!.bodySha256) throw Error("probe_control_body_changed");
    requests.push({ id: entry.id, bodies: built });
  }
  const rawSources = [];
  for (const repeat of [1,2,3]) {
    const inputs = await readPillPhotoDiagnosticRuns([join(options.baseline, `repeat-${repeat}`), join(options.candidate, `repeat-${repeat}`)]);
    const hashes = bundle.sourceHashes[repeat - 1]!;
    if (!isDeepStrictEqual(inputs[0]!.inputHashes, hashes.baseline) || !isDeepStrictEqual(inputs[1]!.inputHashes, hashes.candidate)) throw Error("probe_ocr_changed");
    rawSources.push(inputs.map(input => input.saved.cases.map(row => rawOcr.parse(row))));
  }
  const { catalog } = await loadFrozenPillPhotoFixture();
  if (!isDeepStrictEqual(ownCode, await fingerprints())) throw Error("probe_code_changed");
  const plan = { schemaVersion: STYLIZED_PROBE_VERSION, split: "validation", products: 6, images: 12, repetitions: 3,
    maximumRequests: 36, newOcrRequests: 0, model: "gpt-5.6-sol", reasoningEffort: "low",
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    code: condition.code, ownCode, sourceTrialFileHashes: bundle.sourceTrialFileHashes, sourceHashes: bundle.sourceHashes,
    catalogVersion: catalog.version, sources: { baseline: options.baseline, candidate: options.candidate, imageRoot: options.imageRoot },
    imageBindings, instructionAddition: STYLIZED_TEXT_ADDITION, order: visionProbeOrder(),
    requestHashes: requests.map(entry => ({ id: entry.id, arms: Object.fromEntries(Object.entries(entry.bodies).map(([arm, body]) => [arm, probeHash(JSON.stringify(body))])) })),
    evaluation: { primaryFixedOcr: 0, secondaryFixedOcr: 1, completeRowsRequired: 36,
      criteria: "both OCR sources: no recall1/5 total or recall5 minimum-repeat loss; primary recall1 or recall5 gain; zero strong wrong and retake exposure",
      notEndToEndEvaluation: true, defaultPromotion: false, holdoutUsed: false, retries: 0 } };
  return { plan, requests, rawSources, catalog, expected: bundle.report.repetitions[0]!.cells[0]!.rows.map(row => ({ id: row.id, itemSeq: row.expectedItemSeq })) };
}
type Context = Awaited<ReturnType<typeof prepare>>;
type Scored = { task: ReturnType<typeof visionProbeOrder>[number]; vision: Awaited<ReturnType<typeof requestVisionProbe>>;
  scores: ReturnType<typeof inspectPillFeatures>[] };
export function summarizeStylizedProbe(rows: Scored[]) {
  const tasks = visionProbeOrder();
  if (!isDeepStrictEqual(rows.map(row => row.task), tasks)) throw Error("probe_incomplete_or_reordered");
  const arms = (["structured_control", "stylized_text"] as const).map(arm => ({ arm,
    fixedOcr: [0,1].map(source => ({ source,
      recall: [1,5,20].map(k => ({ k, hits: [1,2,3].map(repetition => rows.filter(row => row.task.arm === arm
        && row.task.repetition === repetition && row.scores[source]!.expectedRank !== null && row.scores[source]!.expectedRank! <= k).length) })),
      strongWrong: rows.filter(row => row.task.arm === arm).reduce((sum,row) => sum + row.scores[source]!.strongWrongCandidates, 0),
      retakeExposure: rows.filter(row => row.task.arm === arm && row.scores[source]!.retakeCandidateExposure).length,
    })) }));
  const total = (value: number[]) => value.reduce((sum, n) => sum + n, 0);
  const noLoss = arms[0]!.fixedOcr.every((before, index) => {
    const after = arms[1]!.fixedOcr[index]!;
    return [0,1].every(k => total(after.recall[k]!.hits) >= total(before.recall[k]!.hits))
      && Math.min(...after.recall[1]!.hits) >= Math.min(...before.recall[1]!.hits);
  });
  const gain = [0,1].some(k => total(arms[1]!.fixedOcr[0]!.recall[k]!.hits) > total(arms[0]!.fixedOcr[0]!.recall[k]!.hits));
  const safe = arms[1]!.fixedOcr.every(score => score.strongWrong === 0 && score.retakeExposure === 0);
  return { arms, conditionalSignal: noLoss && gain && safe ? "promising_requires_fresh_full_pipeline" : "no_clear_gain",
    independentProducts: 6, repeatedCasesPerArm: 18, primaryFixedOcr: 0, newOcrRequests: 0,
    productionReady: false, endToEndAccuracyClaim: false, defaultChanged: false };
}
async function run(context: Context, planDirectory: string, key: string) {
  const planBytes = await readBoundedFixtureFile(join(planDirectory, "plan.json"), 512 * 1024);
  if (!isDeepStrictEqual(JSON.parse(planBytes.toString("utf8")), context.plan)) throw Error("probe_plan_changed");
  if (!key.trim()) throw Error("probe_key_missing");
  // Exclusive consumption before a request: interrupted plans cannot silently be retried.
  await save(planDirectory, "consumed.json", { at: new Date().toISOString(), planSha256: probeHash(planBytes) });
  const directory = await mkdtemp(join(OUTPUT, "run-")); await save(directory, "plan.json", context.plan);
  const rows: Scored[] = [];
  const checkCode = async () => {
    const core = await Promise.all(context.plan.code.map(async file => ({ path: file.path,
      sha256: probeHash(await readBoundedFixtureFile(join(ROOT, file.path), 4 * 1024 * 1024)) })));
    if (!isDeepStrictEqual(context.plan.code, core) || !isDeepStrictEqual(context.plan.ownCode, await fingerprints())) throw Error("probe_code_changed");
  };
  try {
    await executeVisionProbeOrder(async (task, index) => {
      await checkCode();
      const bodies = context.requests.find(entry => entry.id === task.id)!.bodies, body = bodies[task.arm];
      const expectedHash = context.plan.requestHashes.find(entry => entry.id === task.id)!.arms[task.arm];
      if (probeHash(JSON.stringify(body)) !== expectedHash) throw Error("probe_body_changed");
      await save(directory, `${index + 1}-started.json`, { task, at: new Date().toISOString(), requestSha256: expectedHash });
      const vision = await requestVisionProbe(body, key);
      // Preserve provider evidence before scoring; a failure here stops all subsequent requests.
      await save(directory, `${index + 1}-response.json`, { task, requestSha256: expectedHash, vision });
      await checkCode();
      const item = context.expected.find(item => item.id === task.id)!;
      const scores = [0,1].map(source => {
        const ocr = context.rawSources[task.repetition - 1]![source]!.find(row => row.id === task.id)!.extraction.signals.ocr.features;
        return inspectPillFeatures(fusePillPhotoSignals(vision.features, ocr).features, item.itemSeq, context.catalog);
      });
      const row = { task, vision, scores }; await save(directory, `${index + 1}-score.json`, { task, scores }); rows.push(row);
      console.log(JSON.stringify({ completed: rows.length, maximum: 36, ...task }));
    });
    const summary = summarizeStylizedProbe(rows); await save(directory, "summary.json", { status: "complete", ...summary });
    console.log(serializePillProfile({ directory, requests: rows.length, ...summary }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "";
    await save(directory, "incomplete.json", { status: "incomplete", completedScoredRows: rows.length, noSuccessSummary: true,
      reason: /^probe_[a-z0-9_]+$/.test(message) ? message : "request_recording_or_scoring_failed" });
    throw Error("probe_run_incomplete");
  }
}
export async function runStylizedProbe(args: string[]) {
  const options = parseStylizedProbeArgs(args), context = await prepare(options);
  await mkdir(OUTPUT, { recursive: true });
  if (options.mode === "prepare") {
    const directory = await mkdtemp(join(OUTPUT, "plan-")); await save(directory, "plan.json", context.plan);
    console.log(JSON.stringify({ directory, maximumRequests: 36, externalRequests: 0, newOcrRequests: 0 })); return;
  }
  await run(context, options.plan!, process.env.OPENAI_API_KEY ?? "");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runStylizedProbe(process.argv.slice(2)).catch(() => { console.error("stylized_probe_unavailable_or_incomplete"); process.exitCode = 1; });
}
