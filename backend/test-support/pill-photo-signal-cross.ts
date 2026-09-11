// Offline counterfactual replay of saved signals; never a new inference/accuracy experiment.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { PillCatalog } from "../src/pill-identification.ts";
import { pillPhotoFeaturesSchema } from "../src/pill-photo-features.ts";
import { fusePillPhotoSignals, pillPhotoOcrFeaturesSchema } from "../src/pill-photo-ocr.ts";
import { diagnosePillPhotoValidation, type PillPhotoDiagnosticFixture } from "./pill-photo-diagnostics.ts";
import { parsePillPhotoScoreInput, scorePillPhotoEvaluation, type PillPhotoScoreInput } from "./pill-photo-score.ts";

export type SavedPillSignalRun = Parameters<typeof diagnosePillPhotoValidation>[0];
export const PILL_SIGNAL_CELLS = ["V0O0", "V1O0", "V0O1", "V1O1"] as const;
type CellId = typeof PILL_SIGNAL_CELLS[number];
const CELL_SOURCES = { V0O0: [0, 0], V1O0: [1, 0], V0O1: [0, 1], V1O1: [1, 1] } as const;
const EDGES = [
  { id: "vision_with_O0", from: "V0O0", to: "V1O0" },
  { id: "vision_with_O1", from: "V0O1", to: "V1O1" },
  { id: "ocr_with_V0", from: "V0O0", to: "V0O1" },
  { id: "ocr_with_V1", from: "V1O0", to: "V1O1" },
] as const;
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (reason: string): never => { throw new Error(`signal_cross_${reason}`); };
// Used only AFTER the full original-run diagnostics have validated extraction, usage and fusion.
const signalCase = z.object({ id: z.string(), extraction: z.object({ signals: z.object({
  vision: z.object({ features: pillPhotoFeaturesSchema }), ocr: z.object({ features: pillPhotoOcrFeaturesSchema }),
}) }) });

export function crossReplayPillPhotoSignals(
  pairs: { baseline: SavedPillSignalRun; candidate: SavedPillSignalRun }[],
  fixture: PillPhotoDiagnosticFixture,
  catalog: PillCatalog,
) {
  if (pairs.length !== 3) return fail("three_repetitions_required");
  const manifest = { ...fixture, minimumCasesForPass: { validation: 6, holdout: 6 } };
  const repetitions = pairs.map((pair, repeatIndex) => {
    const saved = [pair.baseline, pair.candidate];
    const originals = saved.map((run) => diagnosePillPhotoValidation(run, fixture, catalog));
    const inputs = saved.map((run) => parsePillPhotoScoreInput(run.features, manifest, "validation"));
    if (inputs.some(input => input.requests !== 18)) return fail("complete_recorded_requests_required");
    const withoutVision = (pipeline: typeof inputs[number]["pipeline"]) => {
      const { visionVersion, ...rest } = pipeline;
      return { visionVersion, rest };
    };
    if (!isDeepStrictEqual(withoutVision(inputs[0]!.pipeline).rest, withoutVision(inputs[1]!.pipeline).rest)) return fail("non_vision_pipeline_changed");
    if (originals.some((report) => report.rows.some((row) => row.signalStatus !== "verified"))) return fail("complete_raw_signals_required");
    const sources = saved.map((run) => run.cases.map((row) => signalCase.parse(row)));
    const cells = PILL_SIGNAL_CELLS.map((id) => {
      const [visionSource, ocrSource] = CELL_SOURCES[id];
      const observations = fixture.cases.map((entry, index) => {
        const vision = sources[visionSource]![index]!, ocr = sources[ocrSource]![index]!;
        if (vision.id !== entry.id || ocr.id !== entry.id) return fail("case_source_mismatch");
        const visionFeatures = vision.extraction.signals.vision.features;
        const ocrFeatures = ocr.extraction.signals.ocr.features;
        const fusion = fusePillPhotoSignals(visionFeatures, ocrFeatures);
        return { id: entry.id, visionSource, ocrSource,
          visionSha256: sha256(visionFeatures), ocrSha256: sha256(ocrFeatures),
          features: fusion.features, evidence: fusion.evidence };
      });
      // Only an in-memory scorer input: no fabricated API usage/response or hybrid features.json.
      const input: PillPhotoScoreInput = { ...inputs[visionSource]!, requests: 0,
        cases: observations.map(({ id, features }) => ({ id, extraction: { status: "ok", features, usage: null } })) };
      const score = scorePillPhotoEvaluation(input, manifest, catalog, "validation");
      const diagonal = visionSource === ocrSource;
      if (diagonal && !isDeepStrictEqual(score.rows, originals[visionSource]!.score.rows)) return fail("diagonal_replay_mismatch");
      return { id, origin: diagonal ? "recorded_combination_replayed" : "synthetic_cross_not_observed_at_api",
        diagonalVerified: diagonal, observations, rows: score.rows, metrics: score.metrics };
    });
    const get = (id: CellId) => cells.find((cell) => cell.id === id)!;
    const effects = EDGES.map((edge) => {
      const before = get(edge.from), after = get(edge.to);
      return { ...edge, recallHitDelta: [1, 5, 20].map((k) => ({ k,
        value: after.metrics.recallAt[String(k)]!.hits - before.metrics.recallAt[String(k)]!.hits })),
        rows: before.rows.map((row, index) => ({ id: row.id, beforeRank: row.expectedRank, afterRank: after.rows[index]!.expectedRank,
          rankChanged: row.expectedRank !== after.rows[index]!.expectedRank,
          resultChanged: !isDeepStrictEqual(row, after.rows[index]) })),
      };
    });
    return { repetition: repeatIndex + 1, originalScores: originals.map((report) => report.score.rows),
      sourcePipelines: inputs.map((input) => input.pipeline), sourceTimes: inputs.map((input) => input.createdAt), cells, effects };
  });
  // Same protocol throughout all three repetitions, with no selective per-case or per-side replacement.
  if (repetitions.some((repeat) => !isDeepStrictEqual(repeat.sourcePipelines, repetitions[0]!.sourcePipelines))) return fail("repeat_pipeline_changed");
  if (repetitions.some((repeat, index) => index > 0 && repeat.sourceTimes.some((time, source) =>
    Date.parse(time) <= Date.parse(repetitions[index - 1]!.sourceTimes[source]!)))) return fail("repeat_order_or_duplicate_source");
  const aggregate = PILL_SIGNAL_CELLS.map((id) => {
    const cells = repetitions.map((repeat) => repeat.cells.find((cell) => cell.id === id)!);
    return { id, recall: [1, 5, 20].map((k) => ({ k, denominatorPerRepetition: 6,
      hitsByRepetition: cells.map((cell) => cell.metrics.recallAt[String(k)]!.hits),
      totalHits: cells.reduce((sum, cell) => sum + cell.metrics.recallAt[String(k)]!.hits, 0), repeatedEvaluations: 18 })),
      safety: cells.map((cell, index) => ({ repetition: index + 1,
        strongWrongCandidates: cell.metrics.strongWrongCandidateCount,
        retakeCandidateExposureCases: cell.metrics.retakeCandidateExposureCaseCount })),
    };
  });
  const effects = EDGES.map((edge) => ({ ...edge,
    recallHitDelta: [1, 5, 20].map((k) => ({ k,
      valuesByRepetition: repetitions.map((repeat) => repeat.effects.find((effect) => effect.id === edge.id)!.recallHitDelta.find((delta) => delta.k === k)!.value),
      total: repetitions.reduce((sum, repeat) => sum + repeat.effects.find((effect) => effect.id === edge.id)!.recallHitDelta.find((delta) => delta.k === k)!.value, 0),
    })),
  }));
  return { schemaVersion: "pill-photo-signal-cross.v1", mode: "offline_saved_signal_counterfactual",
    externalRequests: 0, newInference: false, productionReadinessClaim: false, generalizationClaim: false,
    independentProducts: 6, imagesInOriginalFixture: 12, pairedRepetitions: 3, cellsPerCase: 4,
    syntheticCrossCells: 36, replayedOriginalCells: 36, diagonalsVerified: true,
    aggregationPolicy: "all_cases_same_repetition_no_best_cell_selection",
    fixtureVersion: fixture.fixtureVersion, catalogVersion: catalog.version, aggregate, effects, repetitions,
    limits: ["Counterfactual software replay, not new photo inference or an independent accuracy test.",
      "Source 0 is the baseline trial; source 1 is the candidate trial. OCR prompts are identical; OCR outputs can vary.",
      "Effects are conditional on these saved signals and fixed fusion/search; no population-level causal claim.",
      "Six products repeated three times are not 18 independent products. Cross combinations are not new samples.",
      "Null rank means not returned in top20; it is not assigned rank21 for averaging.",
      "No selecting the best cell using ground truth, changing safety gates, or promoting a new default."],
  };
}
