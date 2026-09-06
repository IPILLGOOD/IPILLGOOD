import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { z } from "zod";
import { parsePillPhotoTrialCompareArgs, renderPillPhotoTrialComparison, runPillPhotoTrialComparison } from "../scripts/pill-photo-trial-compare.ts";
import { PILL_PHOTO_INSTRUCTIONS, pillPhotoFeaturesSchema } from "../src/pill-photo-features.ts";
import { PILL_PHOTO_OCR_INSTRUCTIONS, pillPhotoOcrSideResponseSchema } from "../src/pill-photo-ocr.ts";
import { PILL_PHOTO_STRUCTURED_INSTRUCTIONS } from "../src/pill-photo-prompt-profiles.ts";
import { type PillPhotoCaseScore } from "./pill-photo-score.ts";
import { PILL_PHOTO_TRIAL_PROTOCOL, PILL_PHOTO_TRIAL_CASE_IDS, summarizePillPhotoTrialRepeats } from "./pill-photo-trial.ts";
import { assertPillPhotoTrialComparisonConditions, comparePillPhotoTrialRuns } from "./pill-photo-trial-comparison.ts";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const stages = ["vision", "ocrFront", "ocrBack"] as const;
const codePaths = [
  "backend/src/pill-photo-experiment.ts", "backend/src/pill-photo-features.ts", "backend/src/pill-photo-ocr.ts",
  "backend/src/pill-photo-preprocessing.ts", "backend/src/pill-identification.ts", "backend/src/pill-form-policy.ts",
  "backend/src/official-pill-catalog.ts", "backend/src/pill-catalog-snapshot.ts", "backend/test-support/pill-photo-score.ts",
  "backend/test-support/pill-photo-phone-validation.ts", "backend/test-support/pill-photo-fixture.ts",
  "backend/test-support/pill-photo-evaluation-registry.ts", "backend/test-support/pill-photo-trial.ts",
  "backend/scripts/pill-photo-trial.ts", "package-lock.json",
];

// Entirely synthetic saved records. Hashes describe fixture strings, never actual private images or API calls.
function makeRun(candidate: boolean, firstCaseRanks: readonly (number | null)[]) {
  const protocol = candidate ? { ...PILL_PHOTO_TRIAL_PROTOCOL,
    id: "validation-structured-observation-v1", visionPrompt: "pill-photo-observation-v4-structured-surfaces",
  } : PILL_PHOTO_TRIAL_PROTOCOL;
  const condition = {
    schemaVersion: "pill-photo-trial-condition.v1", protocol,
    runtime: { node: "v24.20.0", platform: "win32", arch: "x64", sharp: { sharp: "0.35.3", vips: "8.18.1" } },
    code: [...codePaths, ...(candidate ? ["backend/src/pill-photo-prompt-profiles.ts"] : [])].map((path) => ({ path, sha256: sha256(path) })),
    fixtureVersion: PILL_PHOTO_TRIAL_PROTOCOL.fixtureVersion, fixtureContentSha256: sha256("synthetic-fixture"),
    catalogVersion: "synthetic-catalog", catalogSha256: sha256("synthetic-catalog"),
    cases: PILL_PHOTO_TRIAL_CASE_IDS.map((id) => ({ id,
      sourceSha256: [sha256(`${id}-front`), sha256(`${id}-back`)],
      preprocessing: ["front", "back"].map((side) => {
        const variant = { width: 1000, height: 1000, channels: 3, sha256: sha256(`${id}-${side}-variant`) };
        return { version: PILL_PHOTO_TRIAL_PROTOCOL.preprocessing, source: { width: 1000, height: 1000, format: "jpeg" },
          crop: { method: "centered_square_ratio", ratio: 0.4, bounds: { left: 300, top: 300, width: 400, height: 400 } },
          orientation: { method: "cardinal_ocr_views_only", textOrientationDegreesToEvaluate: [0, 90, 180, 270] },
          variants: { context: variant, alignedColor: variant, alignedContrast: variant },
        };
      }),
      requests: stages.map((stage) => {
        const vision = stage === "vision";
        const images = Array.from({ length: vision ? 4 : 8 }, (_, index) => {
          const digest = sha256(`${id}-${stage}-${index}`);
          return { index, sha256: digest, path: `images/${digest}.png`, bytes: 100, width: 1000, height: 1000, detail: "high" };
        });
        const imageParts = images.map((image) => ({ type: "input_image", ...image }));
        const requestDescription = {
          model: protocol.model, store: false, max_output_tokens: vision ? 2400 : 1400, reasoning: { effort: "low" },
          instructions: vision ? candidate ? PILL_PHOTO_STRUCTURED_INSTRUCTIONS : PILL_PHOTO_INSTRUCTIONS : PILL_PHOTO_OCR_INSTRUCTIONS,
          input: [{ role: "user", content: [{ type: "input_text", text: "First group" }, ...imageParts.slice(0, imageParts.length / 2),
            { type: "input_text", text: "Second group" }, ...imageParts.slice(imageParts.length / 2)] }],
          text: { format: { type: "json_schema", name: vision ? "pill_visible_features" : "pill_imprint_ocr_side", strict: true,
            schema: z.toJSONSchema(vision ? pillPhotoFeaturesSchema : pillPhotoOcrSideResponseSchema) } },
        };
        return { stage, bodySha256: sha256(`synthetic body:${JSON.stringify(requestDescription)}`),
          instructionsSha256: sha256(requestDescription.instructions), schemaSha256: sha256(JSON.stringify(requestDescription.text.format)),
          images, requestDescription };
      }),
    })),
  };
  const comparison = summarizePillPhotoTrialRepeats([1, 2, 3].map((repetition) => {
    const rows = PILL_PHOTO_TRIAL_CASE_IDS.map((id, index): PillPhotoCaseScore => {
      const expectedItemSeq = String(209900001 + index), expectedRank = index ? 1 : firstCaseRanks[repetition - 1]!;
      const candidateItemSeqs = expectedRank === null ? []
        : [...Array.from({ length: expectedRank - 1 }, (_, position) => String(209910001 + position)), expectedItemSeq];
      return { id, expectedItemSeq, extractionStatus: "ok", failureReason: null, comparisonStatus: "searched",
        comparisonReason: "features_compared", searchStatus: candidateItemSeqs.length ? "candidates_found" : "unidentified",
        expectedRank, expectedHeld: false, candidateItemSeqs, heldCandidateItemSeqs: [], strongCandidateItemSeqs: [],
        strongWrongCandidateItemSeqs: [], needsRetake: false };
    });
    return { repetition, rows, passed: rows.every((row) => row.expectedRank !== null && row.expectedRank <= 5) };
  }));
  return { condition, summary: { status: "complete", conditionSha256: sha256(JSON.stringify(condition)), requestIntents: 54,
    responseModels: Array.from({ length: 54 }, (_, index) => ({ stage: stages[index % 3]!, value: protocol.model })),
    completedRepetitions: 3, productionReadinessClaim: false, comparison } };
}
const scenario = () => ({ before: makeRun(false, [6, 6, 6]), after: makeRun(true, [1, 1, 1]) });
const rehash = (run: ReturnType<typeof makeRun>) => { run.summary.conditionSha256 = sha256(JSON.stringify(run.condition)); };
function rescore(run: ReturnType<typeof makeRun>) {
  run.summary.comparison = summarizePillPhotoTrialRepeats([1, 2, 3].map((repetition) => {
    const rows = run.summary.comparison.rows.map((row) => row.results[repetition - 1]!);
    return { repetition, rows, passed: rows.every((row) => row.expectedRank !== null && row.expectedRank <= 5
      && !row.strongWrongCandidateItemSeqs.length && !(row.needsRetake && row.candidateItemSeqs.length + row.heldCandidateItemSeqs.length)) };
  }));
}

test("실행 전에는 summary나 API 없이 두 condition만으로 프롬프트 단일 변경을 검사한다", () => {
  const { before, after } = scenario();
  const result = assertPillPhotoTrialComparisonConditions(before.condition, after.condition);
  assert.equal(result.onlyVisionInstructionsChanged, true);
  assert.equal(result.requestStagesCompared, 18);
  assert.equal(result.beforeConditionSha256, before.summary.conditionSha256);
  assert.equal(result.afterConditionSha256, after.summary.conditionSha256);
  after.condition.cases[0]!.requests[2]!.bodySha256 = sha256("changed-ocr");
  assert.throws(() => assertPillPhotoTrialComparisonConditions(before.condition, after.condition), /request_contract_changed/);
});

test("두 고정 조건의 3회 결과를 재계산해 사전 기준에 따른 validation 유망 변화만 표시한다", (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("network_forbidden"); });
  const { before, after } = scenario(), original = JSON.stringify({ before, after });
  const report = comparePillPhotoTrialRuns(before, after);
  assert.equal(report.decision, "promising_validation_only");
  assert.deepEqual(report.recall[1]!.before.hitsByRepetition, [5, 5, 5]);
  assert.deepEqual(report.recall[1]!.after.hitsByRepetition, [6, 6, 6]);
  assert.equal(report.recall[1]!.totalHitDelta, 3);
  assert.equal(report.independentProducts, 6);
  assert.equal(report.productionReadinessClaim, false);
  assert.equal(report.generalizationClaim, false);
  assert.equal(report.externalRequests, 0);
  assert.equal(report.metadata.codeChanges[0]!.path, "backend/src/pill-photo-prompt-profiles.ts");
  assert.equal(JSON.stringify({ before, after }), original);
});

test("동률, recall5 최저 회차 악화와 recall1 합계 악화를 유망 개선으로 선택하지 않는다", () => {
  assert.equal(comparePillPhotoTrialRuns(makeRun(false, [6, 6, 6]), makeRun(true, [6, 6, 6])).decision, "no_clear_gain");
  const minimum = comparePillPhotoTrialRuns(makeRun(false, [5, 5, 5]), makeRun(true, [1, 1, 6]));
  assert.equal(minimum.decision, "no_clear_gain");
  assert.equal(minimum.checks.recallAt5MinimumNotLower, false);
  const topOne = comparePillPhotoTrialRuns(makeRun(false, [1, 1, 6]), makeRun(true, [2, 2, 2]));
  assert.equal(topOne.checks.recallAt5TotalNotLower, true);
  assert.equal(topOne.checks.recallAt1TotalNotLower, false);
  assert.equal(topOne.decision, "no_clear_gain");
});

test("강한 오답 안전 악화는 개선 판정을 막고 과거 changed=false에도 전체행 변동을 보존한다", () => {
  const { before, after } = scenario();
  const row = after.summary.comparison.rows[0]!.results[1]!;
  row.candidateItemSeqs.push("209999999");
  row.strongCandidateItemSeqs.push("209999999");
  row.strongWrongCandidateItemSeqs.push("209999999");
  rescore(after);
  after.summary.comparison.rows[0]!.changed = false;
  const report = comparePillPhotoTrialRuns(before, after);
  assert.equal(report.decision, "candidate_safety_failure");
  assert.equal(report.safety.after[1]!.strongWrongCandidates, 1);
  assert.equal(report.rows[0]!.afterVaried, true);
  assert.equal(report.rows[0]!.repetitions[1]!.strongWrongCandidateDelta, 1);
});

test("baseline의 기존 안전 실패는 노출하고 candidate가 안전해졌다면 유망 판정을 허용한다", () => {
  const { before, after } = scenario();
  const row = before.summary.comparison.rows[0]!.results[0]!;
  row.strongCandidateItemSeqs = [row.candidateItemSeqs[0]!];
  row.strongWrongCandidateItemSeqs = [...row.strongCandidateItemSeqs];
  rescore(before);
  const report = comparePillPhotoTrialRuns(before, after);
  assert.equal(report.safety.beforePassed, false);
  assert.equal(report.safety.afterPassed, true);
  assert.equal(report.decision, "promising_validation_only");
});

test("지시문 외 Vision/OCR 본문·이미지배치·OCR 해시 변경을 거부한다", () => {
  for (const stage of [0, 1, 2]) {
    const { before, after } = scenario();
    const textPart = after.condition.cases[0]!.requests[stage]!.requestDescription.input[0]!.content[0]!;
    assert.ok("text" in textPart);
    textPart.text = "Changed grouping";
    rehash(after);
    assert.throws(() => comparePillPhotoTrialRuns(before, after), /request_contract_changed/);
  }
  const { before, after } = scenario();
  after.condition.cases[0]!.requests[1]!.bodySha256 = sha256("tampered-ocr-body");
  rehash(after);
  assert.throws(() => comparePillPhotoTrialRuns(before, after), /request_contract_changed/);
  const images = scenario();
  images.after.condition.cases[0]!.requests[0]!.images.reverse();
  rehash(images.after);
  assert.throws(() => comparePillPhotoTrialRuns(images.before, images.after), /request_fingerprint_mismatch/);
});

test("불완전 실행·잘못된 분모·누락 및 순서 변경 사례를 거부한다", () => {
  for (const field of ["requestIntents", "completedRepetitions"] as const) {
    const { before, after } = scenario();
    after.summary[field]--;
    assert.throws(() => comparePillPhotoTrialRuns(before, after), /incomplete_or_invalid_summary/);
  }
  const denominator = scenario();
  denominator.after.summary.comparison.recall[0]!.denominatorPerRepetition = 5;
  assert.throws(() => comparePillPhotoTrialRuns(denominator.before, denominator.after), /incomplete_or_invalid_summary/);
  const missing = scenario();
  missing.after.summary.comparison.rows.pop();
  assert.throws(() => comparePillPhotoTrialRuns(missing.before, missing.after), /incomplete_or_invalid_summary/);
  const order = scenario();
  order.after.summary.comparison.rows.reverse();
  assert.throws(() => comparePillPhotoTrialRuns(order.before, order.after), /case_or_request_order_mismatch/);
});

test("가짜 요약·순위·조건 지문과 instructions/schema 해시를 검증한다", () => {
  const metrics = scenario();
  metrics.after.summary.comparison.recall[1]!.hitsByRepetition[0] = 5;
  assert.throws(() => comparePillPhotoTrialRuns(metrics.before, metrics.after), /summary_metrics_mismatch/);
  const ranks = scenario();
  ranks.after.summary.comparison.rows[0]!.results[0]!.expectedRank = 2;
  assert.throws(() => comparePillPhotoTrialRuns(ranks.before, ranks.after), /row_score_mismatch/);
  const condition = scenario();
  condition.after.summary.conditionSha256 = sha256("wrong-condition");
  assert.throws(() => comparePillPhotoTrialRuns(condition.before, condition.after), /condition_hash_mismatch/);
  for (const field of ["instructionsSha256", "schemaSha256"] as const) {
    const data = scenario();
    data.after.condition.cases[0]!.requests[0]![field] = sha256("wrong-fingerprint");
    rehash(data.after);
    assert.throws(() => comparePillPhotoTrialRuns(data.before, data.after), /request_fingerprint_mismatch/);
  }
});

test("보호 코드·카탈로그·런타임 지문 변경과 알 수 없는 필드를 거부한다", () => {
  for (const path of ["backend/src/pill-photo-features.ts", "backend/src/pill-photo-ocr.ts", "backend/src/pill-photo-preprocessing.ts",
    "backend/src/pill-identification.ts", "backend/test-support/pill-photo-score.ts", "package-lock.json"]) {
    const { before, after } = scenario();
    after.condition.code.find((entry) => entry.path === path)!.sha256 = sha256("changed-protected-source");
    rehash(after);
    assert.throws(() => comparePillPhotoTrialRuns(before, after), /protected_code_changed/);
  }
  const catalog = scenario();
  catalog.after.condition.catalogSha256 = sha256("different-catalog");
  rehash(catalog.after);
  assert.throws(() => comparePillPhotoTrialRuns(catalog.before, catalog.after), /non_prompt_condition_changed/);
  const runtime = scenario();
  runtime.after.condition.runtime.node = "v24.21.0";
  rehash(runtime.after);
  assert.throws(() => comparePillPhotoTrialRuns(runtime.before, runtime.after), /non_prompt_condition_changed/);
  const extra = scenario();
  assert.throws(() => comparePillPhotoTrialRuns(extra.before, { ...extra.after,
    summary: { ...extra.after.summary, hiddenRepeat: 4 } }), /incomplete_or_invalid_summary/);
});

test("비교 CLI는 두 경로를 요구하고 중복·알 수 없는 옵션·같은 디렉토리를 거부한다", () => {
  assert.deepEqual(parsePillPhotoTrialCompareArgs(["--candidate", "synthetic-candidate", "--baseline", "synthetic-baseline"]), {
    baseline: resolve("synthetic-baseline"), candidate: resolve("synthetic-candidate"),
  });
  for (const args of [[], ["--baseline", "a"], ["--candidate"],
    ["--baseline", "a", "--candidate", "b", "--baseline", "c"],
    ["--baseline", "a", "--candidate", "b", "--live"],
    ["--baseline", "a", "--holdout", "b"],
    ["--baseline", "--candidate", "b"], ["--baseline", "a", "--candidate", ""]]) {
    assert.throws(() => parsePillPhotoTrialCompareArgs(args), /trial_comparison_invalid_arguments/);
  }
  assert.throws(() => parsePillPhotoTrialCompareArgs(["--baseline", ".", "--candidate", "./"]), /trial_comparison_same_directory/);
});

async function saveSyntheticRuns(data: ReturnType<typeof scenario>) {
  const root = await mkdtemp(join(tmpdir(), "pill-trial-compare-test-"));
  const baseline = join(root, "baseline"), candidate = join(root, "candidate");
  await Promise.all([mkdir(baseline), mkdir(candidate)]);
  const files: { path: string; bytes: string }[] = [];
  for (const [directory, run] of [[baseline, data.before], [candidate, data.after]] as const) {
    for (const name of ["condition", "summary"] as const) {
      const path = join(directory, `${name}.json`), bytes = JSON.stringify(run[name], null, 2);
      await writeFile(path, bytes, { flag: "wx" });
      files.push({ path, bytes });
    }
  }
  return { root, baseline, candidate, files, cleanup: async () => {
    // Remove only the four known synthetic files; never recursively remove caller-provided paths.
    await Promise.all(files.map(({ path }) => unlink(path)));
    await Promise.all([rmdir(baseline), rmdir(candidate)]);
    await rmdir(root);
  } };
}

test("비교 CLI는 합성 run을 읽어 새 JSON/HTML을 저장하고 원본은 바꾸거나 외부 요청하지 않는다", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", () => { requests++; throw new Error("network_forbidden"); });
  const saved = await saveSyntheticRuns(scenario());
  t.after(saved.cleanup);
  const outputRoot = fileURLToPath(new URL("../../verification-artifacts/pill-photo-trials/", import.meta.url));
  const args = ["--baseline", saved.baseline, "--candidate", saved.candidate];
  const results = [];
  for (let index = 0; index < 2; index++) {
    const result = await runPillPhotoTrialComparison(args);
    assert.equal(dirname(result.directory), resolve(outputRoot));
    t.after(async () => {
      await unlink(join(result.directory, "comparison.json"));
      await unlink(join(result.directory, "comparison.html"));
      await rmdir(result.directory);
    });
    results.push(result);
    const json = JSON.parse(await readFile(join(result.directory, "comparison.json"), "utf8"));
    assert.deepEqual(json, result.report);
    assert.equal(json.schemaVersion, "pill-photo-trial-comparison.v1");
    assert.equal(json.decision, "promising_validation_only");
    assert.equal(json.externalRequests, 0);
    const html = await readFile(join(result.directory, "comparison.html"), "utf8");
    assert.match(html, /recall@5/);
    assert.match(html, /promising_validation_only/);
    assert.match(html, /default-src 'none'/);
    assert.doesNotMatch(html, /<script\b|<iframe\b|<img\b/i);
  }
  assert.notEqual(results[0]!.directory, results[1]!.directory);
  for (const file of saved.files) assert.equal(await readFile(file.path, "utf8"), file.bytes);
  assert.equal(requests, 0);
});

test("비교 HTML은 사례·판정·메타데이터·한계 문자열의 마크업을 이스케이프한다", () => {
  const { before, after } = scenario();
  const report = comparePillPhotoTrialRuns(before, after);
  const markup = '</pre><script>alert("x")</script>&\'"';
  report.rows[0]!.id = markup;
  report.decision = markup;
  report.metadata.beforeProtocol = markup;
  report.limits.push(markup);
  const html = renderPillPhotoTrialComparison(report);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&lt;/pre&gt;"));
  assert.ok(html.includes("&amp;"));
  assert.ok(html.includes("&#39;"));
  assert.ok(html.includes("&quot;"));
  assert.doesNotMatch(html, /<script\b/i);
  assert.ok(!html.includes(markup));
});

test("비교 CLI는 불완전 및 읽기 상한을 넘는 합성 입력을 거부하고 원본 조건을 보존한다", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", () => { requests++; throw new Error("network_forbidden"); });
  const data = scenario();
  data.after.summary.requestIntents = 53;
  const saved = await saveSyntheticRuns(data);
  t.after(saved.cleanup);
  const args = ["--baseline", saved.baseline, "--candidate", saved.candidate];
  await assert.rejects(runPillPhotoTrialComparison(args), /trial_comparison_incomplete_or_invalid_summary/);
  for (const file of saved.files) assert.equal(await readFile(file.path, "utf8"), file.bytes);
  const summaryPath = join(saved.candidate, "summary.json"), oversized = " ".repeat(512 * 1024 + 1);
  await writeFile(summaryPath, oversized);
  await assert.rejects(runPillPhotoTrialComparison(args), /fixture_size_exceeded/);
  assert.equal(await readFile(summaryPath, "utf8"), oversized);
  for (const file of saved.files.filter(({ path }) => path !== summaryPath)) assert.equal(await readFile(file.path, "utf8"), file.bytes);
  assert.equal(requests, 0);
});
