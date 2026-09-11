// Experiment preparation and injected/mock execution only; no default transport, key or filesystem access.
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { pillPhotoOcrRequest, parsePillPhotoOcrResponse, type PreparedPillPhotoRequests } from "../src/pill-photo-experiment.ts";
import { pillPhotoFeaturesSchema, type PillPhotoFeatures } from "../src/pill-photo-features.ts";
import { PILL_PHOTO_FAILURE_REASONS } from "../src/pill-photo-failures.ts";
import { PILL_PHOTO_OCR_PROMPT_VERSION, PILL_PHOTO_STROKE_OCR_PROMPT_VERSION,
  PILL_PHOTO_OCR_SCHEMA_VERSION, pillPhotoOcrInstructions, pillPhotoOcrFeaturesSchema,
  fusePillPhotoSignals, type PillPhotoOcrFeatures } from "../src/pill-photo-ocr.ts";
import { PILL_PHOTO_TRIAL_CASE_IDS as IDS, PILL_PHOTO_TRIAL_PROTOCOL as BASE, trialSha256 } from "./pill-photo-trial.ts";
import { diagnosePillPhotoValidation, type PillPhotoDiagnosticFixture } from "./pill-photo-diagnostics.ts";
import { parsePillPhotoScoreInput, scorePillPhotoEvaluation, PILL_PHOTO_SCORE_SCHEMA_VERSION, type PillPhotoScoreInput } from "./pill-photo-score.ts";
import { summarizeOracleGroups } from "./pill-photo-oracle.ts";
import type { PillCatalog } from "../src/pill-identification.ts";

export const OCR_AB_PROTOCOL = Object.freeze({
  id: "validation-frozen-vision-ocr-strokes-v1", split: "validation", fixtureVersion: BASE.fixtureVersion,
  products: 6, photographs: 12, repetitions: 3, conditions: ["legacy", "stroke_check"],
  maximumOcrRequests: 72, visionRequests: 0, retries: 0,
  model: BASE.ocrModel, modelSnapshotPinned: false, preprocessing: BASE.preprocessing,
  visionPrompt: BASE.visionPrompt, fusion: BASE.fusion, search: BASE.search, scorePolicy: BASE.scorePolicy,
  legacyPrompt: PILL_PHOTO_OCR_PROMPT_VERSION, candidatePrompt: PILL_PHOTO_STROKE_OCR_PROMPT_VERSION,
  injectionPoint: "before_fusion_ocr_signal_only", historicalSource: "run-9EINEQ/repeat-1..3",
  order: "paired_case_alternating_AB_BA_by_repetition_and_case", productionReadinessClaim: false,
} as const);
export type OcrAbCondition = "legacy" | "stroke_check";
export type OcrRequest = ReturnType<typeof pillPhotoOcrRequest>;
export interface FrozenVisionRow {
  repetition: number; caseId: string; sourceRun: string; vision: PillPhotoFeatures;
  visionSha256: string; historicalOcr: PillPhotoOcrFeatures;
  sourceSha256: string[]; legacyBodySha256: { front: string; back: string };
}
export interface OcrAbBinding { caseId: string; sourceSha256: string[]; legacyBodySha256: { front: string; back: string } }
const signalCase = z.object({ id: z.string(), extraction: z.object({ signals: z.object({
  vision: z.object({ features: pillPhotoFeaturesSchema }), ocr: z.object({ features: pillPhotoOcrFeaturesSchema }),
}) }) });
const check = (ok: boolean, reason: string) => { if (!ok) throw new Error(`ocr_ab_${reason}`); };
const hashObject = (value: unknown) => trialSha256(JSON.stringify(value));

/** Full existing diagnostics verify raw signals/fusion first; no selective repetition or label injection. */
export function freezeOcrAbVision(runs: { id: string; saved: Parameters<typeof diagnosePillPhotoValidation>[0] }[],
  fixture: PillPhotoDiagnosticFixture, catalog: PillCatalog, bindings: OcrAbBinding[]): FrozenVisionRow[] {
  check(runs.length === 3 && new Set(runs.map(run => run.id)).size === 3, "three_distinct_runs_required");
  check(isDeepStrictEqual(bindings.map(row => row.caseId), IDS), "binding_coverage_invalid");
  for (const [index, binding] of bindings.entries()) {
    const sourceHashes = fixture.cases[index]?.photos.map(path => fixture.images.find(image => image.path === path)?.sha256);
    check(isDeepStrictEqual(binding.sourceSha256, sourceHashes)
      && [binding.legacyBodySha256.front, binding.legacyBodySha256.back].every(value => /^[a-f0-9]{64}$/.test(value)), "binding_source_invalid");
  }
  let previousTime = -Infinity;
  return runs.flatMap((run, index) => {
    const diagnosis = diagnosePillPhotoValidation(run.saved, fixture, catalog);
    check(diagnosis.rows.every(row => row.signalStatus === "verified"), "verified_signals_required");
    const input = parsePillPhotoScoreInput(run.saved.features, { ...fixture, minimumCasesForPass: { validation: 6, holdout: 6 } }, "validation");
    check(isDeepStrictEqual(input.pipeline, { mode: "vision_ocr", preprocessingVersion: BASE.preprocessing,
      visionVersion: BASE.visionPrompt, model: BASE.model, ocrModel: BASE.ocrModel,
      ocrVersion: BASE.ocrPrompt, fusionVersion: BASE.fusion }), "source_pipeline_changed");
    check(Date.parse(input.createdAt) > previousTime, "source_order_invalid"); previousTime = Date.parse(input.createdAt);
    return run.saved.cases.map((value, caseIndex) => {
      const row = signalCase.parse(value);
      check(row.id === IDS[caseIndex], "source_case_order_invalid");
      const { vision, ocr } = row.extraction.signals;
      return { repetition: index + 1, caseId: row.id, sourceRun: run.id,
        vision: vision.features, visionSha256: hashObject(vision.features), historicalOcr: ocr.features,
        sourceSha256: [...bindings[caseIndex]!.sourceSha256], legacyBodySha256: { ...bindings[caseIndex]!.legacyBodySha256 } };
    });
  });
}

/** Rebuild a canonical body from its eight image bytes; reject extra text, labels, settings or fields. */
function assertLegacyRequest(request: OcrRequest) {
  const slots = request.input[0]?.content.filter(part => "image_url" in part) ?? [];
  check(slots.length === 8, "eight_views_required");
  const buffers = slots.map(part => {
    const prefix = "data:image/png;base64,";
    check("image_url" in part && part.image_url.startsWith(prefix), "invalid_image_encoding");
    const encoded = (part as { image_url: string }).image_url.slice(prefix.length);
    const bytes = Buffer.from(encoded, "base64");
    check(bytes.length > 0 && bytes.toString("base64") === encoded, "invalid_image_encoding"); return bytes;
  });
  const canonical = pillPhotoOcrRequest([buffers[0]!, buffers[1]!, buffers[2]!, buffers[3]!],
    [buffers[4]!, buffers[5]!, buffers[6]!, buffers[7]!], BASE.ocrModel);
  check(isDeepStrictEqual(request, canonical), "noncanonical_legacy_request");
}
export function buildOcrAbRequestPair(prepared: PreparedPillPhotoRequests) {
  const legacy = { front: structuredClone(prepared.requests.ocrFront), back: structuredClone(prepared.requests.ocrBack) };
  assertLegacyRequest(legacy.front); assertLegacyRequest(legacy.back);
  const stroke_check = { front: { ...structuredClone(legacy.front), instructions: pillPhotoOcrInstructions(PILL_PHOTO_STROKE_OCR_PROMPT_VERSION) },
    back: { ...structuredClone(legacy.back), instructions: pillPhotoOcrInstructions(PILL_PHOTO_STROKE_OCR_PROMPT_VERSION) } };
  for (const side of ["front", "back"] as const) check(isDeepStrictEqual(
    { ...stroke_check[side], instructions: legacy[side].instructions }, legacy[side]), "non_instruction_change");
  return { legacy, stroke_check };
}
export type OcrAbRequestPair = ReturnType<typeof buildOcrAbRequestPair>;
export interface OcrAbCaseRequests { caseId: string; sourceSha256: string[]; requests: OcrAbRequestPair }
export function ocrAbSchedule() {
  return [1, 2, 3].flatMap(repetition => IDS.flatMap((caseId, index) => {
    const order: OcrAbCondition[] = (repetition + index) % 2 ? ["legacy", "stroke_check"] : ["stroke_check", "legacy"];
    return order.map(condition => ({ repetition, caseId, condition }));
  }));
}
const failure = z.enum(PILL_PHOTO_FAILURE_REASONS);
type TransportResult = { ok: true; value: unknown } | { ok: false; reason: z.infer<typeof failure> };
type OcrResult = { ok: true; features: PillPhotoOcrFeatures; usage: { inputTokens: number; outputTokens: number } | null }
  | { ok: false; reason: z.infer<typeof failure> };
export interface OcrAbRow {
  repetition: number; caseId: string; condition: OcrAbCondition; sourceRun: string; visionSha256: string;
  ocr: OcrResult; fused: PillPhotoFeatures | null; fusion: ReturnType<typeof fusePillPhotoSignals>["evidence"] | null;
  attempts: { side: "front" | "back"; bodySha256: string; elapsedMs: number; outcome: string;
    usage: { inputTokens: number; outputTokens: number } | null }[];
}

/** An executor is mandatory: the prepare CLI never calls this. Tests inject synthetic provider envelopes only.
 * Its sole input is the canonical OCR body, not Vision, case identity, human readings, catalog or expected labels.
 * Failures remain as planned cases and are not retried or replaced by historical OCR.
 */
export async function executeOcrAbComparison(frozen: FrozenVisionRow[], requests: OcrAbCaseRequests[],
  executor: (request: OcrRequest) => Promise<TransportResult>): Promise<OcrAbRow[]> {
  check(isDeepStrictEqual(frozen.map(row => `${row.repetition}/${row.caseId}`), [1, 2, 3].flatMap(r => IDS.map(id => `${r}/${id}`))), "frozen_coverage_invalid");
  check(isDeepStrictEqual(requests.map(row => row.caseId), IDS), "request_coverage_invalid");
  for (const row of frozen) {
    check(hashObject(row.vision) === row.visionSha256 && pillPhotoFeaturesSchema.safeParse(row.vision).success, "frozen_vision_changed");
    const prepared = requests.find(request => request.caseId === row.caseId)!;
    check(isDeepStrictEqual(row.sourceSha256, prepared.sourceSha256)
      && hashObject(prepared.requests.legacy.front) === row.legacyBodySha256.front
      && hashObject(prepared.requests.legacy.back) === row.legacyBodySha256.back, "vision_request_binding_changed");
  }
  const runIds = [1, 2, 3].map(repetition => {
    const ids = new Set(frozen.filter(row => row.repetition === repetition).map(row => row.sourceRun));
    check(ids.size === 1, "mixed_source_runs"); return [...ids][0];
  });
  check(new Set(runIds).size === 3, "three_distinct_runs_required");
  for (const row of requests) for (const side of ["front", "back"] as const) {
    assertLegacyRequest(row.requests.legacy[side]);
    check(isDeepStrictEqual(row.requests.stroke_check[side], { ...row.requests.legacy[side],
      instructions: pillPhotoOcrInstructions(PILL_PHOTO_STROKE_OCR_PROMPT_VERSION) }), "request_pair_changed");
  }
  // Capture once before handing mutable copies to the injected executor.
  const sourceRows = structuredClone(frozen), requestRows = structuredClone(requests);
  const rows: OcrAbRow[] = [];
  for (const job of ocrAbSchedule()) {
    const source = sourceRows.find(row => row.repetition === job.repetition && row.caseId === job.caseId)!;
    const pair = requestRows.find(row => row.caseId === job.caseId)!.requests[job.condition];
    const attempts: OcrAbRow["attempts"] = [];
    const sides: PillPhotoOcrFeatures["front"][] = [];
    const usages: ({ inputTokens: number; outputTokens: number } | null)[] = [];
    let ocr: OcrResult | null = null;
    for (const side of ["front", "back"] as const) {
      const request = structuredClone(pair[side]), bodySha256 = hashObject(request), start = performance.now();
      let response: TransportResult;
      try { response = await executor(request); } catch { response = { ok: false, reason: "provider_unavailable" }; }
      const parsed = response.ok ? parsePillPhotoOcrResponse(response.value) : { ok: false as const, reason: failure.parse(response.reason) };
      attempts.push({ side, bodySha256, elapsedMs: performance.now() - start,
        outcome: parsed.ok ? "ok" : parsed.reason, usage: parsed.ok ? parsed.usage : null });
      if (!parsed.ok) { ocr = parsed; break; }
      sides.push(parsed.features.side); usages.push(parsed.usage);
    }
    if (!ocr) ocr = { ok: true, features: pillPhotoOcrFeaturesSchema.parse({ schemaVersion: PILL_PHOTO_OCR_SCHEMA_VERSION,
      front: sides[0], back: sides[1] }), usage: usages.every(usage => usage !== null)
      ? { inputTokens: usages.reduce((sum, usage) => sum + usage!.inputTokens, 0), outputTokens: usages.reduce((sum, usage) => sum + usage!.outputTokens, 0) } : null };
    const fused = ocr.ok ? fusePillPhotoSignals(source.vision, ocr.features) : null;
    rows.push({ ...job, sourceRun: source.sourceRun, visionSha256: source.visionSha256,
      ocr, fused: fused?.features ?? null, fusion: fused?.evidence ?? null, attempts });
  }
  return rows;
}

/** Scorer labels arrive only after OCR/fusion. Never claim blind/production success from this development comparison. */
export function scoreOcrAbRows(rows: OcrAbRow[], fixture: PillPhotoDiagnosticFixture, catalog: PillCatalog) {
  check(fixture.scope.split === "validation" && fixture.fixtureVersion === BASE.fixtureVersion
    && fixture.products.length === 6 && fixture.images.length === 12
    && new Set(fixture.products.map(row => row.expectedItemSeq)).size === 6
    && new Set(fixture.images.map(row => row.sha256)).size === 12
    && new Set(fixture.cases.flatMap(row => row.photos)).size === 12
    && fixture.cases.every(row => row.split === "validation" && row.expectedItemSeq === fixture.products.find(product => product.id === row.id)?.expectedItemSeq)
    && isDeepStrictEqual(fixture.cases.map(row => row.id), IDS), "validation_fixture_required");
  check(isDeepStrictEqual(rows.map(({ repetition, caseId, condition }) => ({ repetition, caseId, condition })), ocrAbSchedule()), "result_coverage_invalid");
  return (["legacy", "stroke_check"] as const).map(condition => {
    const repetitions = [1, 2, 3].map(repetition => {
      const selected = rows.filter(row => row.condition === condition && row.repetition === repetition);
      const input: PillPhotoScoreInput = { schemaVersion: PILL_PHOTO_SCORE_SCHEMA_VERSION, fixtureVersion: fixture.fixtureVersion,
        // In-memory scoring timestamp only; never emitted as a historical API receipt.
        split: "validation", createdAt: new Date().toISOString(), requests: 0,
        pipeline: { mode: "vision_ocr", preprocessingVersion: BASE.preprocessing, model: BASE.model,
          visionVersion: BASE.visionPrompt, ocrModel: BASE.ocrModel, fusionVersion: BASE.fusion,
          ocrVersion: condition === "legacy" ? PILL_PHOTO_OCR_PROMPT_VERSION : PILL_PHOTO_STROKE_OCR_PROMPT_VERSION },
        cases: selected.map(row => ({ id: row.caseId, extraction: row.ocr.ok && row.fused
          ? { status: "ok", features: row.fused, usage: row.ocr.usage }
          : { status: "failed", reason: row.ocr.ok ? "fusion_failed" : row.ocr.reason } })) };
      const score = scorePillPhotoEvaluation(input, { ...fixture, minimumCasesForPass: { validation: 6, holdout: 6 } }, catalog, "validation");
      return { repetition, rows: score.rows, metrics: score.metrics, gates: score.gates };
    });
    return { condition, officialPassDecision: false, productionReadinessClaim: false,
      groups: summarizeOracleGroups(repetitions.flatMap(repeat => repeat.rows.map(row => ({ caseId: row.id,
        repetition: repeat.repetition, condition, executed: row.extractionStatus === "ok", rank: row.expectedRank }))), 3), repetitions };
  });
}
