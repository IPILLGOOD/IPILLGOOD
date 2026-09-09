// Fixed, offline validation audit. No API, new inference, model hints, or production search changes.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { comparePillPhotoFeatures, pillPhotoFeaturesSchema, type PillPhotoFeatures } from "../src/pill-photo-features.ts";
import { summarizePillFormPolicy } from "../src/pill-form-policy.ts";
import { loadFrozenPillPhotoFixture, readBoundedFixtureFile } from "../test-support/pill-photo-fixture.ts";
import { loadPillPhotoPhoneValidationFixture } from "../test-support/pill-photo-phone-validation.ts";
import { parseHumanPhotoReadings } from "../test-support/pill-photo-human-oracle.ts";
import { diagnosePillPhotoValidation } from "../test-support/pill-photo-diagnostics.ts";
import { diagnosePillSearch } from "../test-support/pill-photo-search-diagnostics.ts";
import { buildPillImprintLexicon, filterFeaturesByLexicon, inspectLexiconReadings, normalizeLexiconText } from "../test-support/pill-photo-lexicon.ts";
import { readPillPhotoDiagnosticRuns } from "./pill-photo-diagnose.ts";
import { fingerprintAuditInputs } from "./pill-photo-audit-baseline.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUTPUT = join(ROOT, "verification-artifacts/pill-photo-lexicon");
const HUMAN = "verification-artifacts/pill-photo-audit/human-input-20260907/readings.json";
const BASELINE = "verification-artifacts/pill-photo-audit/baseline-zIf2Sd/baseline.json";
const EXPECTED_BASELINE_SHA = "76602845d23400335199aafec211db8b877a8fc61450336a801e674d46dc3ffd";
const TRIAL = "verification-artifacts/pill-photo-trials/run-9EINEQ";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const check = (ok: boolean, reason: string) => { if (!ok) throw new Error(`lexicon_audit_${reason}`); };
async function json(path: string, limit = 1024 * 1024) {
  const bytes = await readBoundedFixtureFile(join(ROOT, path), limit);
  return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown, sha256: sha(bytes) };
}
const CODE = ["backend/src/pill-identification.ts", "backend/src/pill-photo-features.ts", "backend/src/pill-photo-ocr.ts",
  "backend/src/pill-photo-preprocessing.ts", "backend/src/pill-photo-prompt-profiles.ts", "backend/src/pill-photo-experiment.ts", "backend/src/pill-photo-pipeline.ts",
  "backend/src/official-pill-catalog.ts", "backend/src/pill-form-policy.ts", "backend/test-support/pill-photo-score.ts",
  "backend/test-support/pill-photo-lexicon.ts", "backend/scripts/pill-photo-lexicon.ts"];
async function fingerprints() {
  return Promise.all(CODE.map(async path => ({ path, sha256: sha(await readBoundedFixtureFile(join(ROOT, path), 256 * 1024)) })));
}

interface AuditRow {
  caseId: string; repetition: number; sourceRun: string; historicalAppearance: boolean;
  expectedItemSeq: string; extractionFailure: string | null; original: PillPhotoFeatures | null;
  intervention: ReturnType<typeof filterFeaturesByLexicon> | null;
  sideInventory: unknown[]; humanSides: unknown[];
  baseline: ReturnType<typeof diagnosePillSearch> | null; filtered: ReturnType<typeof diagnosePillSearch> | null;
  unchangedPublicResult: boolean; originalStrongCandidateCount: number; filteredStrongCandidateCount: number;
  removedHumanReadings: Array<{ side: "front" | "back"; raw: string }>;
}

export async function runPillLexiconAudit() {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", windowsHide: true }).trim();
  const protectedInputs = await fingerprintAuditInputs(), code = await fingerprints();
  const baselineFile = await json(BASELINE, 32 * 1024 * 1024);
  check(baselineFile.sha256 === EXPECTED_BASELINE_SHA, "baseline_modified");
  const baseline = z.object({ rows: z.array(z.object({ id: z.string(), features: pillPhotoFeaturesSchema, result: z.unknown() })).length(84) }).parse(baselineFile.value);
  const frozen = await loadFrozenPillPhotoFixture();
  // Includes 72 stored cross combinations; historical holdout only checked for unchanged baseline output.
  for (const row of baseline.rows) check(isDeepStrictEqual(comparePillPhotoFeatures(row.features, frozen.catalog), row.result), "baseline_behavior_changed");
  const { manifest } = await loadPillPhotoPhoneValidationFixture();
  const humanFile = await json(HUMAN, 128 * 1024);
  const human = parseHumanPhotoReadings(humanFile.value, manifest);
  const lexicon = buildPillImprintLexicon(frozen.catalog);
  const rows: AuditRow[] = [], sources = [];
  for (const repetition of [1, 2, 3]) {
    const run = `${TRIAL}/repeat-${repetition}`;
    const [loaded] = await readPillPhotoDiagnosticRuns([join(ROOT, run)]);
    const replay = diagnosePillPhotoValidation(loaded!.saved, manifest, frozen.catalog);
    sources.push({ run, hashes: loaded!.inputHashes, createdAt: replay.createdAt, pipeline: replay.pipeline });
    for (const row of replay.rows) {
      const original = row.observedPhotoFeatures?.fused ?? null;
      // No expected identity or human reading enters filtering/neighborhood generation.
      const intervention = original ? filterFeaturesByLexicon(original, lexicon) : null;
      const sideInventory = row.sides.map(side => ({ side: side.inputSide, image: side.image,
        signals: (["vision", "ocr", "fused"] as const).map(signal => ({ signal,
          state: side[signal]?.reading ?? null,
          readings: inspectLexiconReadings(side[signal]?.reading?.imprintCandidates ?? [], lexicon) })) }));
      // Labels start here, after the candidate-independent intervention.
      const product = manifest.products.find(product => product.id === row.id)!;
      const changed = intervention?.features ? diagnosePillSearch(intervention.features, frozen.catalog, product.expectedItemSeq) : null;
      const humanSides = human.cases.find(review => review.caseId === row.id)!.sides.map(side => ({ side: side.inputSide,
        reviewState: side.reviewState, nonTextMark: side.nonTextMark, notes: side.notes,
        readings: side.imprintCandidates.map(raw => ({ raw, normalized: normalizeLexiconText(raw),
          dictionaryMember: lexicon.entries.has(normalizeLexiconText(raw)),
          productCount: lexicon.entries.get(normalizeLexiconText(raw))?.itemSeqs.length ?? 0 })) }));
      const originalComparison = original ? comparePillPhotoFeatures(original, frozen.catalog) : null;
      const changedComparison = intervention?.features ? comparePillPhotoFeatures(intervention.features, frozen.catalog) : null;
      rows.push({ caseId: row.id, repetition, sourceRun: run, historicalAppearance: row.historicalAppearance,
        expectedItemSeq: product.expectedItemSeq, extractionFailure: row.extractionFailure,
        original, intervention, sideInventory, humanSides,
        baseline: row.fused, filtered: changed, unchangedPublicResult: isDeepStrictEqual(originalComparison, changedComparison),
        originalStrongCandidateCount: row.fused?.safety.strongCandidateItemSeqs.length ?? 0,
        filteredStrongCandidateCount: changed?.safety.strongCandidateItemSeqs.length ?? 0,
        removedHumanReadings: (intervention?.changes ?? []).flatMap(change => {
          const review = humanSides.find(side => side.side === change.side)!;
          return change.before.filter(raw => !change.after.includes(raw)
            && review.readings.some(h => h.normalized === normalizeLexiconText(raw))).map(raw => ({ side: change.side, raw }));
        }),
      });
    }
  }
  check(rows.length === 18, "incomplete_paired_runs");
  const groups = (["all_six", "without_historical_v05", "historical_v05_only"] as const).flatMap(group => {
    const subset = rows.filter(row => group === "all_six" || (row.caseId === "v4-v05") === (group === "historical_v05_only"));
    return (["baseline", "filtered"] as const).map(condition => ({ group, condition,
      independentProducts: new Set(subset.map(row => row.caseId)).size, plannedObservations: subset.length,
      evaluatedComparisons: subset.filter(row => row[condition] !== null).length,
      // Failed/blocked rows remain misses in the original planned denominator. Not an official score/pass.
      recall: [1, 5, 20].map(k => ({ k, hits: subset.filter(row => row[condition]?.expectedRank != null && row[condition]!.expectedRank! <= k).length, total: subset.length })),
      strongWrongCandidates: subset.reduce((sum, row) => sum + (row[condition]?.safety.strongWrongCandidates ?? 0), 0),
      retakeCandidateExposureCases: subset.filter(row => row[condition]?.safety.retakeCandidateExposure).length,
      safetyCoverageComplete: subset.every(row => row[condition] !== null), officialPassDecision: null,
    }));
  });
  // Protect the original computation/results, not just this counterfactual's helper inputs.
  for (const row of baseline.rows) check(isDeepStrictEqual(comparePillPhotoFeatures(row.features, frozen.catalog), row.result), "post_audit_behavior_changed");
  check(isDeepStrictEqual(protectedInputs, await fingerprintAuditInputs()), "protected_inputs_changed");
  check(isDeepStrictEqual(code, await fingerprints()), "code_changed_during_run");
  check((await json(HUMAN, 128 * 1024)).sha256 === humanFile.sha256, "human_inputs_changed");
  check((await json(BASELINE, 32 * 1024 * 1024)).sha256 === baselineFile.sha256, "baseline_modified");
  const report = { schemaVersion: "pill-photo-lexicon-audit.v1", createdAt: new Date().toISOString(), currentHead: head,
    code, runtime: process.version, externalRequests: 0, newInference: false, officialPassDecision: null,
    condition: "post_fusion_exact_dictionary_filter_counterfactual_only", catalogVersion: frozen.catalog.version,
    catalogSha256: frozen.manifest.catalog.sha256, fixtureVersion: manifest.fixtureVersion, inventory: lexicon.inventory,
    formPolicy: summarizePillFormPolicy(frozen.catalog.items), sources, humanSource: { path: HUMAN, sha256: humanFile.sha256 },
    preservation: { baseline: { path: BASELINE, sha256: baselineFile.sha256 }, unchangedBeforeAndAfter: 84,
      storedCrossCombinations: 72, protectedFilesUnchanged: protectedInputs.length, sourceFilesUnchanged: code.length },
    summary: { pairedObservations: 18, filtered: rows.filter(row => row.intervention?.status === "filtered").length,
      blocked: rows.filter(row => row.intervention?.status === "blocked").length,
      unchangedPublicResults: rows.filter(row => row.unchangedPublicResult).length,
      removedHumanReadingOccurrences: rows.reduce((sum, row) => sum + row.removedHumanReadings.length, 0) },
    groups, rows,
    limitations: ["This tests exact dictionary post-filtering, NOT constrained model decoding or catalog-conditioned image reinspection.",
      "One-substitution neighbors are string-space diagnostics only, not added to observations or passed into the search.",
      "Empty/missing official text, mark descriptors and human no-text labels never fabricate a clear/unreadable/blank observation.",
      "No original value, quality, grade policy, ranking weight, catalog record or variant pairing was overwritten.",
      "A dictionary hit does not prove the reading is right. A dictionary miss does not prove the medicine is absent.",
      "This dictionary includes all catalog forms. Product/variant eligibility remains the existing search's decision.",
      "There is no holdout intervention. Original holdout results remain historical; final improvement requires unused photos.",
      "Six products repeated three times are not eighteen independent products; 5/1 groups cannot replace the official six-product gate.",
      "All new pre-limit ranks and explanations are current-code reconstructions, not historical internal logs."],
  };
  await mkdir(OUTPUT, { recursive: true });
  const directory = await mkdtemp(join(OUTPUT, "audit-"));
  await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
  const cell = (value: unknown) => String(value ?? "—").replaceAll("|", "\\|").replace(/[\r\n]/g, " ");
  const lines = ["# 카탈로그 각인 사전 오프라인 진단", "", "새 인식/공식 합격 아님. 원래 결합 특징에서 사전에 없는 문자열만 제거하는 반사실 비교. 모든 실패/차단은 분모 유지.", "",
    "## 집계", "", "| 범위 | 조건 | 제품 | 진단/계획 | @1 | @5 | @20 | 강한 오답 |", "|---|---|---|---|---|---|---|---|"];
  for (const g of groups) lines.push(`| ${g.group} | ${g.condition} | ${g.independentProducts} | ${g.evaluatedComparisons}/${g.plannedObservations} | ${g.recall.map(m => `${m.hits}/${m.total}`).join(" | ")} | ${g.strongWrongCandidates} |`);
  lines.push("", "## 사례별 비교", "", "| 사례/회차 | 삭제/차단 | 원래 전체→반환 순위 | 사전 필터 전체→반환 | 후보·보류 | 근거 |", "|---|---|---|---|---|---|");
  for (const row of rows) lines.push(`| ${row.caseId}/${row.repetition} | ${cell(row.intervention?.status ?? row.extractionFailure)} ${cell(JSON.stringify(row.intervention?.changes ?? []))} | ${cell(row.baseline?.candidateRankBeforeLimit)}→${cell(row.baseline?.expectedRank)} | ${cell(row.filtered?.candidateRankBeforeLimit)}→${cell(row.filtered?.expectedRank)} | ${cell(row.baseline?.expectedMembership)}→${cell(row.filtered?.expectedMembership ?? "blocked")} | ${cell(row.filtered?.expectedDisposition ?? row.intervention?.reason ?? row.extractionFailure)} |`);
  lines.push("", "## 해석 제한", "", ...report.limitations.map(line => `- ${line}`), "", "문자별 사전 이웃, 각 신호 원문, 사람 판독과의 차이, 원래/변경 후 경쟁 품목 근거는 report.json에 보관.", "");
  await writeFile(join(directory, "report.md"), lines.join("\n"), { flag: "wx", mode: 0o600 });
  return { directory: relative(ROOT, directory), inventory: report.inventory, summary: report.summary, groups, preservation: report.preservation, externalRequests: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length === 3 && process.argv[2] === "--help") console.log("Fixed offline v4 validation lexicon audit. No arguments, env, API, live/holdout options. Requires private frozen inputs; writes new ignored artifacts. Exit 0 is not recognition success.");
  else if (process.argv.length !== 2) { console.error("lexicon_audit_invalid_arguments"); process.exitCode = 1; }
  else {
    globalThis.fetch = async () => { throw new Error("lexicon_audit_network_forbidden"); };
    runPillLexiconAudit().then(({ inventory, ...result }) => console.log(JSON.stringify({ ...result,
      inventory: { catalogRecords: inventory.catalogRecordCount, uniqueProducts: inventory.uniqueProductCount,
        uniqueImprints: inventory.lexiconEntryCount, sharedImprints: inventory.sharedImprints.entryCount } }))).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      console.error(/^lexicon_audit_[a-z_]+$/.test(message) ? message : "lexicon_audit_local_input_missing_or_invalid");
      process.exitCode = 1;
    });
  }
}
