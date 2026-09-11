// Private offline counterfactuals only. Human evidence is never an automatic product label or a model input.
import { z } from "zod";
import type { PillCatalog } from "../src/pill-identification.ts";
import type { PillPhotoPhoneValidationManifest } from "./pill-photo-phone-validation.ts";
import { parsePillPhotoScoreInput } from "./pill-photo-score.ts";
import { diagnosePillSearch } from "./pill-photo-search-diagnostics.ts";
import { injectOracleImprintStrings, officialOracleReadings, summarizeOracleGroups } from "./pill-photo-oracle.ts";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const humanSide = z.object({
  inputSide: z.enum(["front", "back"]), photoPath: z.string().regex(/^v4-v0[1-6]-side-[ab]\.jpg$/), photoSha256: digest,
  reviewState: z.enum(["not_reviewed", "reviewed_unreadable", "reviewed_partial", "reviewed_readable", "reviewed_no_text"]),
  imprintCandidates: z.array(z.string().min(1).max(40).refine(text => text.trim().length > 0)).max(5),
  nonTextMark: z.enum(["not_reviewed", "present", "absent", "uncertain"]),
  recordedStatus: z.string().max(80), recordedText: z.string().max(240), notes: z.string().max(1000),
}).strict().superRefine((side, ctx) => {
  const hasText = side.reviewState === "reviewed_partial" || side.reviewState === "reviewed_readable";
  if (hasText !== (side.imprintCandidates.length > 0) || new Set(side.imprintCandidates).size !== side.imprintCandidates.length
    || side.imprintCandidates.some(text => text === "비어 있음")) ctx.addIssue({ code: "custom", message: "human_text_state_conflict" });
});
const evidenceSchema = z.object({
  schemaVersion: z.literal("pill-human-photo-readings.v2"), fixtureVersion: z.string(),
  source: z.object({ kind: z.literal("user_photo_only_review"), photoOnlyConfirmed: z.literal(true),
    reviewer: z.string().trim().min(1).max(80), reviewedOn: z.iso.date(), reviewedTime: z.null(),
    reviewFileSha256: digest, transcriptionNotes: z.string().max(1500),
  }).strict(),
  cases: z.array(z.object({ caseId: z.string().regex(/^v4-v0[1-6]$/), sides: z.array(humanSide).length(2) }).strict()).length(6),
}).strict();
export type HumanPhotoReadings = z.infer<typeof evidenceSchema>;

export function parseHumanPhotoReadings(value: unknown, manifest: PillPhotoPhoneValidationManifest): HumanPhotoReadings {
  if (manifest.scope.split !== "validation") throw new Error("human_oracle_validation_only");
  const result = evidenceSchema.safeParse(value);
  if (!result.success) throw new Error("human_oracle_invalid_evidence");
  const data = result.data;
  if (data.fixtureVersion !== manifest.fixtureVersion || manifest.cases.length !== 6 || manifest.images.length !== 12
    || new Set(data.cases.map(row => row.caseId)).size !== 6) throw new Error("human_oracle_fixture_mismatch");
  const hashes = new Set<string>();
  for (const row of data.cases) {
    const sourceCase = manifest.cases.find(item => item.id === row.caseId);
    if (!sourceCase || sourceCase.split !== "validation" || new Set(row.sides.map(side => side.inputSide)).size !== 2) {
      throw new Error("human_oracle_case_mismatch");
    }
    for (const side of row.sides) {
      const path = sourceCase.photos[side.inputSide === "front" ? 0 : 1];
      const image = manifest.images.find(image => image.path === path);
      if (!image || side.photoPath !== path || side.photoSha256 !== image.sha256 || hashes.has(side.photoSha256)) {
        throw new Error("human_oracle_photo_identity_mismatch");
      }
      hashes.add(side.photoSha256);
    }
  }
  return data;
}

export function humanOracleReadings(evidence: HumanPhotoReadings, caseId: string) {
  const row = evidence.cases.find(row => row.caseId === caseId);
  if (!row) throw new Error("human_oracle_case_missing");
  const readings = { front: null as string[] | null, back: null as string[] | null };
  for (const side of row.sides) if (side.reviewState === "reviewed_readable" || side.reviewState === "reviewed_partial") {
    readings[side.inputSide] = [...side.imprintCandidates];
  }
  return { readings, sides: structuredClone(row.sides), source: structuredClone(evidence.source),
    constraints: "A human no-text observation stays metadata (null for strings-only injection); it is not missing evidence or an instruction to change blank/visibility. Notes never create alternative strings." };
}

export function compareHumanOracleRuns(runs: { id: string; value: unknown }[], rawEvidence: unknown,
  manifest: PillPhotoPhoneValidationManifest, catalog: PillCatalog) {
  const evidence = parseHumanPhotoReadings(rawEvidence, manifest);
  if (runs.length !== 3 || new Set(runs.map(run => run.id)).size !== 3) throw new Error("human_oracle_three_paired_runs_required");
  const scoringManifest = { ...manifest, minimumCasesForPass: { validation: 6, holdout: 6 } };
  const rows = runs.flatMap((run, index) => {
    const input = parsePillPhotoScoreInput(run.value, scoringManifest, "validation");
    return input.cases.flatMap(row => {
      const reference = officialOracleReadings(manifest, row.id, catalog);
      const human = humanOracleReadings(evidence, row.id);
      const expected = manifest.cases.find(item => item.id === row.id)!.expectedItemSeq;
      const original = row.extraction.status === "ok" ? row.extraction.features : null;
      return (["original", "official_strings_only", "human_strings_only"] as const).map(condition => {
        const intervention = original && condition !== "original" ? injectOracleImprintStrings(original,
          condition === "official_strings_only" ? reference.readings : human.readings,
          condition === "official_strings_only" ? "official_catalog" : "human_photo_reading") : null;
        const observation = condition === "original" ? original : intervention?.features ?? null;
        return { caseId: row.id, repetition: index + 1, condition, sourceRun: run.id, sourceCreatedAt: input.createdAt,
          pipeline: input.pipeline, pairedBaselineId: `${index + 1}/original/${row.id}`,
          injectionPoint: "after_fusion_final_features", executed: observation !== null,
          reason: row.extraction.status === "failed" ? row.extraction.reason : condition === "original"
            ? "saved_final_features_fixed" : intervention!.status,
          originalObservation: original, observation, changedFields: intervention?.changedFields ?? [],
          attemptedChanges: intervention?.attemptedChanges ?? [], stateChanges: intervention?.stateChanges ?? [],
          contractConflicts: intervention?.contractConflicts ?? [], unavailableStringSides: intervention?.unavailableSides ?? [],
          historicalAppearance: reference.historicalAppearance,
          reference: condition === "official_strings_only" ? reference : null,
          humanEvidence: condition === "human_strings_only" ? human : null,
          diagnosis: observation ? diagnosePillSearch(observation, catalog, expected) : null,
          provenance: condition === "original" ? "saved_observation_current_search_reconstruction" : "counterfactual_not_photo_accuracy",
        };
      });
    });
  });
  const sides = evidence.cases.flatMap(row => row.sides);
  const humanRows = rows.filter(row => row.condition === "human_strings_only");
  return {
    rows,
    groups: ["original", "official_strings_only", "human_strings_only"].map(condition => {
      const selected = rows.filter(row => row.condition === condition);
      return { condition, groups: summarizeOracleGroups(selected.map(row => ({ caseId: row.caseId,
        repetition: row.repetition, condition, executed: row.executed, rank: row.diagnosis?.expectedRank ?? null })), 3),
      safety: { plannedObservations: 18, executedObservations: selected.filter(row => row.executed).length,
        strongWrongCandidates: selected.reduce((sum, row) => sum + (row.diagnosis?.safety.strongWrongCandidates ?? 0), 0),
        retakeCandidateExposureCases: selected.filter(row => row.diagnosis?.safety.needsRetake
          && row.diagnosis.safety.candidateItemSeqs.length + row.diagnosis.safety.heldCandidateItemSeqs.length > 0).length,
        completeCoverage: selected.every(row => row.executed), officialPassDecision: false },
      };
    }),
    humanCoverage: { independentProducts: 6, suppliedSides: sides.length,
      reviewedSides: sides.filter(side => side.reviewState !== "not_reviewed").length,
      textBearingSides: sides.filter(side => side.imprintCandidates.length > 0).length,
      noTextSides: sides.filter(side => side.reviewState === "reviewed_no_text").length,
      unreadableSides: sides.filter(side => side.reviewState === "reviewed_unreadable").length,
      markStates: Object.fromEntries(["present", "absent", "uncertain", "not_reviewed"].map(state => [state, sides.filter(side => side.nonTextMark === state).length])),
      plannedRepeatedObservations: 18, executedRepeatedObservations: humanRows.filter(row => row.executed).length,
      appliedChangedFields: humanRows.reduce((sum, row) => sum + row.changedFields.length, 0),
      interpretation: "Supplied/reviewed sides, text-bearing sides, changed fields and executed repeated cases are different counts. No-text/marks/status are metadata only in this strings-only experiment." },
  };
}
