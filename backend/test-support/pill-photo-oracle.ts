// Counterfactual diagnostics, not a photo-accuracy score or a source of human labels.
import { isDeepStrictEqual } from "node:util";
import { pillPhotoFeaturesSchema, type PillPhotoFeatures } from "../src/pill-photo-features.ts";
import type { PillPhotoPhoneValidationManifest } from "./pill-photo-phone-validation.ts";
import type { PillCatalog } from "../src/pill-identification.ts";
import { officialPillRecordDigest } from "./pill-photo-label-audit.ts";

/** Select exactly the pinned record, then map both surfaces together. Never assemble a cross-variant oracle. */
export function officialOracleReadings(manifest: PillPhotoPhoneValidationManifest, caseId: string, catalog: PillCatalog) {
  if (manifest.scope.split !== "validation") throw new Error("oracle_validation_only");
  const product = manifest.products.find(row => row.id === caseId), row = manifest.cases.find(row => row.id === caseId);
  if (!product || !row) throw new Error("oracle_case_missing");
  const variants = catalog.items.filter(item => item.itemSeq === product.expectedItemSeq
    && officialPillRecordDigest(item) === product.expectedOfficialRecordSha256);
  if (variants.length !== 1) throw new Error("oracle_pinned_variant_missing_or_duplicate");
  const surfaces = row.photos.map(path => manifest.images.find(image => image.path === path)?.officialSide);
  if (surfaces.length !== 2 || surfaces.some(side => !side) || new Set(surfaces).size !== 2) throw new Error("oracle_invalid_surface_mapping");
  const text = surfaces.map(side => variants[0]![side!].imprint);
  return { officialRecordSha256: product.expectedOfficialRecordSha256, inputToOfficialSides: surfaces,
    readings: { front: text[0] ? [text[0]] : null, back: text[1] ? [text[1]] : null },
    photographReadingClaim: false, historicalAppearance: !!product.appearanceHistory,
    limitation: product.appearanceHistory ? "Current official text is NOT a human reading of this historical-appearance photo." : "Official text is a counterfactual reference, not proof of photo legibility." };
}

export function injectOracleImprintStrings(original: PillPhotoFeatures,
  readings: Record<"front" | "back", string[] | null>, source: "official_catalog" | "human_photo_reading") {
  const features = structuredClone(original);
  const changedFields: { path: string; before: unknown; after: unknown }[] = [];
  const unavailableSides: string[] = [];
  for (const side of ["front", "back"] as const) {
    const candidates = readings[side];
    const observation = features.observation[side];
    if (!candidates?.length || !observation) { unavailableSides.push(side); continue; }
    if (!isDeepStrictEqual(observation.imprintCandidates, candidates)) {
      changedFields.push({ path: `observation.${side}.imprintCandidates`, before: observation.imprintCandidates, after: candidates });
      observation.imprintCandidates = [...candidates];
    }
  }
  const parsed = pillPhotoFeaturesSchema.safeParse(features);
  const hasInput = (["front", "back"] as const).some(side => readings[side]?.length && original.observation[side]);
  return {
    source, injectionPoint: "after_fusion_final_features" as const,
    status: !hasInput ? "not_executed_no_reading" as const : !parsed.success ? "not_executed_contract_conflict" as const : "executed" as const,
    features: hasInput && parsed.success ? parsed.data : null,
    attemptedChanges: changedFields, changedFields: hasInput && parsed.success ? changedFields : [],
    stateChanges: [], unavailableSides,
    contractConflicts: parsed.success ? [] : parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })),
    constraints: "Only imprintCandidates may change. No visibility/blank/quality/safety upgrades. Official null stays unavailable, not blank.",
  };
}

export interface OracleSummaryRow {
  caseId: string;
  repetition: number;
  condition: string;
  executed: boolean;
  rank: number | null;
}

/** Missing conditions remain in planned counts; incomplete subsets are never an official recall or pass. */
export function summarizeOracleGroups(rows: OracleSummaryRow[], repetitions: number) {
  if (!Number.isInteger(repetitions) || repetitions < 1 || new Set(rows.map(row => row.condition)).size !== 1
    || rows.some(row => !/^v4-v0[1-6]$/.test(row.caseId) || !Number.isInteger(row.repetition)
      || row.repetition < 1 || row.repetition > repetitions || row.rank !== null && (!row.executed || !Number.isInteger(row.rank) || row.rank < 1))) {
    throw new Error("oracle_invalid_group_input");
  }
  return ["all_6", "current_appearance_5", "historical_appearance_1"].map(group => {
    const selected = rows.filter(row => group === "all_6" || (group === "historical_appearance_1") === (row.caseId === "v4-v05"));
    const independentProducts = group === "all_6" ? 6 : group === "current_appearance_5" ? 5 : 1;
    const expectedCount = independentProducts * repetitions;
    const identities = selected.map(row => `${row.repetition}/${row.caseId}`);
    if (selected.length !== expectedCount || new Set(identities).size !== selected.length) throw new Error("oracle_group_incomplete_or_duplicate");
    const executed = selected.filter(row => row.executed);
    return { group, independentProducts, repeatedObservations: expectedCount, repetitions,
      executedObservations: executed.length, unexecutedObservations: selected.length - executed.length,
      recall: [1, 5, 20].map(k => {
        const hits = executed.filter(row => row.rank !== null && row.rank <= k).length;
        return { k, hitsAmongExecuted: hits, plannedDenominator: expectedCount,
          rate: executed.length === expectedCount ? hits / expectedCount : null };
      }), officialScoreOrGate: false, productionReadinessClaim: false };
  });
}

export function createHumanReadingTemplate(manifest: PillPhotoPhoneValidationManifest) {
  if (manifest.scope.split !== "validation") throw new Error("human_template_validation_only");
  return { schemaVersion: "pill-human-photo-readings.v1", fixtureVersion: manifest.fixtureVersion,
    instructions: ["Human must read the photo, not copy catalog/AI text. Keep this filled file private.",
      "status: not_reviewed / reviewed_unreadable / reviewed_partial / reviewed_readable / reviewed_no_imprint.",
      "Record candidates only for text actually read; identify reviewer and review time. Do not fill labels from products.txt.",
      "This blank template has NOT been reviewed or executed. A future importer must validate evidence and injection-state conflicts."],
    cases: manifest.cases.map(row => ({ caseId: row.id, sides: row.photos.map((path, index) => ({
      inputSide: index === 0 ? "front" : "back", photoPath: path,
      photoSha256: manifest.images.find(image => image.path === path)!.sha256,
      status: "not_reviewed", imprintCandidates: [], reviewer: null, reviewedAt: null, notes: "",
    })) })) };
}
