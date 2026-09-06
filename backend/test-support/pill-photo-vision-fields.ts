// Label-assisted software diagnostics, never model input or new accuracy measurements.
import { isDeepStrictEqual } from "node:util";
import { comparePillPhotoFeatures, pillPhotoFeaturesSchema, type PillPhotoFeatures } from "../src/pill-photo-features.ts";
import { fusePillPhotoSignals, pillPhotoOcrFeaturesSchema } from "../src/pill-photo-ocr.ts";
import type { PillCatalog } from "../src/pill-identification.ts";

function differences(a: unknown, b: unknown, path: string[] = []): { path: string[]; before: unknown; after: unknown }[] {
  if (isDeepStrictEqual(a, b)) return [];
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
      .flatMap(key => differences(left[key], right[key], [...path, key]));
  }
  return [{ path, before: a, after: b }];
}
function replace(value: PillPhotoFeatures, path: string[], replacement: unknown) {
  const result = structuredClone(value);
  let target = result as unknown as Record<string, unknown>;
  for (const key of path.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[path.at(-1)!] = structuredClone(replacement);
  return result;
}
export function inspectPillFeatures(features: PillPhotoFeatures, expectedItemSeq: string, catalog: PillCatalog) {
  const comparison = comparePillPhotoFeatures(features, catalog), search = comparison.search;
  const candidates = search?.candidates ?? [], held = search?.heldCandidates ?? [];
  const expectedRank = candidates.findIndex(candidate => candidate.itemSeq === expectedItemSeq);
  const expected = [...candidates, ...held].find(candidate => candidate.itemSeq === expectedItemSeq);
  return { comparisonStatus: comparison.status, comparisonReason: comparison.reason,
    searchReason: search?.reason ?? null, expectedRank: expectedRank < 0 ? null : expectedRank + 1,
    expectedHeld: held.some(candidate => candidate.itemSeq === expectedItemSeq),
    candidates: candidates.map(candidate => ({ itemSeq: candidate.itemSeq, grade: candidate.grade })),
    heldItemSeqs: held.map(candidate => candidate.itemSeq),
    expectedVariants: expected?.variants ?? [],
    strongWrongCandidates: candidates.filter(candidate => candidate.grade === "strong" && candidate.itemSeq !== expectedItemSeq).length,
    retakeCandidateExposure: comparison.status === "needs_retake" && candidates.length > 0,
  };
}
/** One already-bound validation pair. Swaps observed values, never values copied from the answer label. */
export function traceVisionFields(beforeValue: unknown, afterValue: unknown, ocrValue: unknown,
  expectedItemSeq: string, catalog: PillCatalog) {
  const before = pillPhotoFeaturesSchema.parse(beforeValue), after = pillPhotoFeaturesSchema.parse(afterValue);
  const ocr = pillPhotoOcrFeaturesSchema.parse(ocrValue);
  const inspect = (vision: PillPhotoFeatures) => {
    const fused = fusePillPhotoSignals(vision, ocr);
    return { features: fused.features, fusion: fused.evidence, search: inspectPillFeatures(fused.features, expectedItemSeq, catalog) };
  };
  const leaves = differences(before, after);
  const groups = (["front", "back"] as const).filter(side => !isDeepStrictEqual(before.observation[side], after.observation[side]))
    .map(side => ({ path: ["observation", side], before: before.observation[side], after: after.observation[side] }));
  return { before: inspect(before), after: inspect(after), changedFields: leaves.map(change => change.path.join(".")),
    interventions: [...leaves.map(change => ({ ...change, kind: "single_field" })),
      ...groups.map(change => ({ ...change, kind: "whole_observed_side" }))].map(change => ({
      kind: change.kind, path: change.path.join("."), beforeValue: change.before, afterValue: change.after,
      directions: (["forward", "reverse"] as const).map(direction => {
        const mixed = replace(direction === "forward" ? before : after, change.path, direction === "forward" ? change.after : change.before);
        const parsed = pillPhotoFeaturesSchema.safeParse(mixed);
        return { direction, valid: parsed.success,
          // Inconsistent field-only combinations are not silently repaired to make an apparent gain.
          result: parsed.success ? inspect(parsed.data) : null,
          reason: parsed.success ? null : "invalid_counterfactual_contract" };
      }),
    })),
    labelAssisted: true, usedForAccuracyMetrics: false, newInference: false,
    limits: "Conditional on saved OCR and fixed search. Do not select the best field combination or sum interacting effects." };
}
