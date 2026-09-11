import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { runPillPhotoSignalCross } from "./pill-photo-signal-cross.ts";
import { readPillPhotoDiagnosticRuns } from "./pill-photo-diagnose.ts";
import { parsePillPhotoTrialCompareArgs } from "./pill-photo-trial-compare.ts";
import { loadFrozenPillPhotoFixture } from "../test-support/pill-photo-fixture.ts";
import { traceVisionFields } from "../test-support/pill-photo-vision-fields.ts";
import { serializePillProfile } from "./profile-pill-catalog.ts";
import { isDeepStrictEqual } from "node:util";
import { pillPhotoFeaturesSchema } from "../src/pill-photo-features.ts";
import { pillPhotoOcrFeaturesSchema } from "../src/pill-photo-ocr.ts";
import { z } from "zod";

const rawCase = z.object({ id: z.string(), extraction: z.object({ signals: z.object({
  vision: z.object({ features: pillPhotoFeaturesSchema }), ocr: z.object({ features: pillPhotoOcrFeaturesSchema }),
}) }) });
async function main(args: string[]) {
  const paths = parsePillPhotoTrialCompareArgs(args);
  // Complete original cross replay performs the strict condition, source/code and diagonal checks first.
  const { directory, bundle } = await runPillPhotoSignalCross(args);
  const { catalog } = await loadFrozenPillPhotoFixture();
  const rows = [];
  for (const repeat of bundle.report.repetitions) {
    const inputs = await readPillPhotoDiagnosticRuns([join(paths.baseline, `repeat-${repeat.repetition}`), join(paths.candidate, `repeat-${repeat.repetition}`)]);
    const hashes = bundle.sourceHashes[repeat.repetition - 1]!;
    if (!isDeepStrictEqual(inputs[0]!.inputHashes, hashes.baseline) || !isDeepStrictEqual(inputs[1]!.inputHashes, hashes.candidate)) throw Error("field_sources_changed");
    const sources = inputs.map(input => input.saved.cases.map(row => rawCase.parse(row)));
    for (const [index, row] of repeat.cells[0]!.rows.entries()) {
      for (const ocrSource of [0, 1]) {
        const a = sources[0]![index]!, b = sources[1]![index]!;
        if (a.id !== row.id || b.id !== row.id) throw Error("field_case_changed");
        const result = traceVisionFields(a.extraction.signals.vision.features, b.extraction.signals.vision.features,
          sources[ocrSource]![index]!.extraction.signals.ocr.features, row.expectedItemSeq, catalog);
        const before = repeat.cells.find(cell => cell.id === `V0O${ocrSource}`)!.rows[index]!;
        const after = repeat.cells.find(cell => cell.id === `V1O${ocrSource}`)!.rows[index]!;
        if (before.expectedRank !== result.before.search.expectedRank || after.expectedRank !== result.after.search.expectedRank) throw Error("field_diagonal_changed");
        rows.push({ repetition: repeat.repetition, id: row.id, ocrSource, result });
      }
    }
  }
  const analysisCode = await Promise.all(["../scripts/pill-photo-vision-fields.ts", "../test-support/pill-photo-vision-fields.ts"].map(async path => ({ path,
    sha256: createHash("sha256").update(await readFile(new URL(path, import.meta.url))).digest("hex") })));
  const report = { schemaVersion: "pill-photo-vision-fields.v1", externalRequests: 0, newInference: false,
    independentProducts: 6, repetitions: 3, fixedOcrSources: 2, usedForAccuracyMetrics: false,
    sourceBundleFile: "report.json", sourceBundleSha256: createHash("sha256").update(await readFile(join(directory, "report.json"))).digest("hex"),
    analysisCode, rows };
  await writeFile(join(directory, "vision-fields.json"), serializePillProfile(report), { flag: "wx", mode: 0o600 });
  console.log(serializePillProfile({ directory, externalRequests: 0, changed: rows.filter(row => row.result.changedFields.length).map(row => ({
    id: row.id, repetition: row.repetition, ocrSource: row.ocrSource,
    before: row.result.before.search.expectedRank, after: row.result.after.search.expectedRank,
    fields: row.result.changedFields,
    interventions: row.result.interventions.map(change => ({ path: change.path, kind: change.kind,
      ranks: change.directions.map(direction => direction.valid ? direction.result!.search.expectedRank : "invalid_contract") })),
  })) }));
}
main(process.argv.slice(2)).catch(() => { console.error("vision_field_diagnostic_failed"); process.exitCode = 1; });
