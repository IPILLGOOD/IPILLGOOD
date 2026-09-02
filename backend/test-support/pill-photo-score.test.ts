import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PILL_OBSERVATION_SCHEMA_VERSION } from "../src/pill-identification.ts";
import { pillPhotoFeaturesSchema } from "../src/pill-photo-features.ts";
import { parsePillPhotoScoreArgs, runPillPhotoScore } from "../scripts/pill-photo-score.ts";
import { loadRegisteredPillPhotoEvaluationFixture } from "./pill-photo-evaluation-registry.ts";
import { loadPillPhotoEvaluationFixture } from "./pill-photo-evaluation.ts";
import { loadFrozenPillPhotoFixture } from "./pill-photo-fixture.ts";
import {
  PILL_PHOTO_SCORE_SCHEMA_VERSION,
  scorePillPhotoEvaluation,
  summarizePillPhotoCaseScores,
  type PillPhotoCaseScore,
  type PillPhotoScoreInput,
} from "./pill-photo-score.ts";

const evaluationPromise = loadPillPhotoEvaluationFixture();
const frozenPromise = loadFrozenPillPhotoFixture();

function observedSide(imprint: string | null) {
  return imprint === null
    ? { imprintCandidates: [], noImprintObserved: true, imprintVisibility: "clear" as const, scoreLine: "unknown" as const }
    : { imprintCandidates: [imprint], noImprintObserved: false, imprintVisibility: "clear" as const, scoreLine: "unknown" as const };
}

async function perfectInput(split: "validation" | "holdout" = "validation"): Promise<PillPhotoScoreInput> {
  const { manifest } = await evaluationPromise;
  const products = new Map(manifest.products.map((product) => [product.receipt, product]));
  const images = new Map(manifest.images.map((image) => [image.path, image]));
  const cases = manifest.cases.filter((fixtureCase) => fixtureCase.split === split).map((fixtureCase) => {
    const product = products.get(fixtureCase.receipt)!;
    const sides = fixtureCase.photos.map((path) => images.get(path)!.officialSide);
    const imprint = (side: "front" | "back") => side === "front"
      ? product.expectedObservation.frontImprint
      : product.expectedObservation.backImprint;
    const features = pillPhotoFeaturesSchema.parse({
      observation: {
        schemaVersion: PILL_OBSERVATION_SCHEMA_VERSION,
        form: product.expectedObservation.form,
        integrity: "intact",
        count: 1,
        overlapping: false,
        quality: "clear",
        shape: product.expectedObservation.shape,
        colors: product.expectedObservation.colors,
        front: observedSide(imprint(sides[0]!)),
        back: observedSide(imprint(sides[1]!)),
      },
      pairConsistency: "consistent",
      bothSidesVisible: true,
      imageArtifact: "none",
    });
    return { id: fixtureCase.id, extraction: { status: "ok" as const, features, usage: null } };
  });
  return {
    schemaVersion: PILL_PHOTO_SCORE_SCHEMA_VERSION,
    fixtureVersion: manifest.fixtureVersion,
    split,
    createdAt: "2026-09-01T00:00:00.000Z",
    requests: 0,
    pipeline: {
      mode: "vision",
      preprocessingVersion: "test-preprocessing-v1",
      visionVersion: "test-vision-v1",
      model: null,
      ocrVersion: null,
      fusionVersion: null,
    },
    cases,
  };
}

async function perfectUnseenValidationInput(): Promise<{
  manifest: Awaited<ReturnType<typeof loadRegisteredPillPhotoEvaluationFixture>>["manifest"];
  input: PillPhotoScoreInput;
}> {
  const { manifest } = await loadRegisteredPillPhotoEvaluationFixture("v3");
  const products = new Map(manifest.products.map((product) => [product.expectedItemSeq, product]));
  const images = new Map(manifest.images.map((image) => [image.path, image]));
  const cases = manifest.cases.filter((fixtureCase) => fixtureCase.split === "validation").map((fixtureCase) => {
    const product = products.get(fixtureCase.expectedItemSeq)!;
    const sides = fixtureCase.photos.map((path) => images.get(path)!.officialSide);
    const imprint = (side: "front" | "back") => side === "front"
      ? product.expectedObservation.frontImprint
      : product.expectedObservation.backImprint;
    const features = pillPhotoFeaturesSchema.parse({
      observation: {
        schemaVersion: PILL_OBSERVATION_SCHEMA_VERSION,
        form: product.expectedObservation.form,
        integrity: "intact",
        count: 1,
        overlapping: false,
        quality: "clear",
        shape: product.expectedObservation.shape,
        colors: product.expectedObservation.colors,
        front: observedSide(imprint(sides[0]!)),
        back: observedSide(imprint(sides[1]!)),
      },
      pairConsistency: "consistent",
      bothSidesVisible: true,
      imageArtifact: "none",
    });
    return { id: fixtureCase.id, extraction: { status: "ok" as const, features, usage: null } };
  });
  return {
    manifest,
    input: {
      schemaVersion: PILL_PHOTO_SCORE_SCHEMA_VERSION,
      fixtureVersion: manifest.fixtureVersion,
      split: "validation",
      createdAt: "2026-09-02T01:00:00.000Z",
      requests: 0,
      pipeline: {
        mode: "vision_ocr",
        preprocessingVersion: "test-preprocessing-v1",
        visionVersion: "test-vision-v1",
        model: null,
        ocrModel: null,
        ocrVersion: "test-ocr-v1",
        fusionVersion: "test-fusion-v1",
      },
      cases,
    },
  };
}

test("공식 특징을 정확히 추출한 파일은 4/4 recall@5와 안전 기준을 통과한다", async () => {
  const [{ manifest }, frozen, input] = await Promise.all([evaluationPromise, frozenPromise, perfectInput()]);
  const report = scorePillPhotoEvaluation(input, manifest, frozen.catalog, "validation");
  assert.equal(report.passed, true);
  assert.deepEqual(report.metrics.recallAt["5"], { k: 5, hits: 4, total: 4, rate: 1 });
  assert.equal(report.metrics.strongWrongCandidateCount, 0);
  assert.equal(report.metrics.retakeCandidateExposureCaseCount, 0);
  assert.equal(report.rows.every((row) => row.expectedRank !== null && row.expectedRank <= 5), true);
  assert.equal(report.productionReadinessClaim, false);
});

test("v3의 서로 다른 validation 품목 4건도 같은 오프라인 채점 계약으로 평가한다", async () => {
  const [{ manifest, input }, frozen] = await Promise.all([perfectUnseenValidationInput(), frozenPromise]);
  const report = scorePillPhotoEvaluation(input, manifest, frozen.catalog, "validation");
  assert.equal(report.passed, true);
  assert.equal(report.scope, "unseen_product_generalization_pilot");
  assert.deepEqual(report.metrics.recallAt["5"], { k: 5, hits: 4, total: 4, rate: 1 });
});

test("다른 품목의 특징을 연결하면 후보가 있어도 recall 실패를 숨기지 않는다", async () => {
  const [{ manifest }, frozen, input] = await Promise.all([evaluationPromise, frozenPromise, perfectInput()]);
  const rotated = { ...input, cases: input.cases.map((entry, index, entries) => ({
    ...entry,
    extraction: entries[(index + 1) % entries.length]!.extraction,
  })) };
  const report = scorePillPhotoEvaluation(rotated, manifest, frozen.catalog);
  assert.equal(report.passed, false);
  assert.equal(report.metrics.recallAt["5"]!.hits, 0);
  assert.equal(report.rows.some((row) => row.candidateItemSeqs.length > 0), true);
  // These four official records have unknown score-line evidence, so current search grades remain possible.
  assert.equal(report.metrics.strongCandidateCount, 0);
});

test("강한 오답과 재촬영 상태의 후보 노출을 별도 안전 실패로 집계한다", () => {
  const row: PillPhotoCaseScore = {
    id: "capture-v-01",
    expectedItemSeq: "201505259",
    extractionStatus: "ok",
    failureReason: null,
    comparisonStatus: "needs_retake",
    comparisonReason: "unverified_photo_pair",
    searchStatus: "needs_retake",
    expectedRank: null,
    expectedHeld: false,
    candidateItemSeqs: ["200801352"],
    heldCandidateItemSeqs: [],
    strongCandidateItemSeqs: ["200801352"],
    strongWrongCandidateItemSeqs: ["200801352"],
    needsRetake: true,
  };
  const metrics = summarizePillPhotoCaseScores([row]);
  assert.equal(metrics.strongCandidateCount, 1);
  assert.equal(metrics.strongWrongCandidateCount, 1);
  assert.deepEqual(metrics.strongWrongCaseIds, ["capture-v-01"]);
  assert.equal(metrics.retakeCandidateExposureCaseCount, 1);
  assert.deepEqual(metrics.retakeCandidateExposureCaseIds, ["capture-v-01"]);
});

test("정답 필드·누락 사례·다른 split은 특징 결과 파일로 받을 수 없다", async () => {
  const [{ manifest }, input] = await Promise.all([evaluationPromise, perfectInput()]);
  const withLabel = structuredClone(input) as unknown as { cases: Array<Record<string, unknown>> };
  withLabel.cases[0]!.expectedItemSeq = "201505259";
  assert.throws(() => scorePillPhotoEvaluation(withLabel, manifest, { items: [], totalCount: 0, completeness: "complete", version: "test" }), /invalid_evaluation_input/);
  assert.throws(() => scorePillPhotoEvaluation({ ...input, cases: input.cases.slice(1) }, manifest, { items: [], totalCount: 0, completeness: "complete", version: "test" }), /invalid_evaluation_input/);
  assert.throws(() => scorePillPhotoEvaluation(input, manifest, { items: [], totalCount: 0, completeness: "complete", version: "test" }, "holdout"), /invalid_evaluation_input/);
  assert.throws(() => scorePillPhotoEvaluation({ ...input, pipeline: { ...input.pipeline, model: "sk-test" } }, manifest,
    { items: [], totalCount: 0, completeness: "complete", version: "test" }), /invalid_evaluation_input/);
});

test("holdout은 명시적 최종 확인 없이는 실행하지 않고 validation 플래그와 섞지 않는다", () => {
  assert.throws(() => parsePillPhotoScoreArgs(["--input", "run.json", "--split", "holdout"]), /holdout_confirmation_required/);
  assert.throws(() => parsePillPhotoScoreArgs(["--input", "run.json", "--split", "validation", "--confirm-holdout-final"]), /holdout_confirmation_not_allowed/);
  assert.equal(parsePillPhotoScoreArgs(["--input", "run.json", "--split", "holdout", "--confirm-holdout-final"]).split, "holdout");
  assert.deepEqual(
    parsePillPhotoScoreArgs(["--input", "run.json", "--split", "holdout", "--fixture", "v5", "--confirm-holdout-final"]).fixture,
    "v5",
  );
  assert.throws(
    () => parsePillPhotoScoreArgs(["--input", "run.json", "--split", "validation", "--fixture", "v5"]),
    /phone_holdout_split_required/,
  );
  assert.equal(parsePillPhotoScoreArgs(["--input", "run.json", "--split", "validation", "--fixture", "v3"]).fixture, "v3");
});

test("파일 기반 명령은 외부 요청 없이 고정 카탈로그로 채점하고 새 보고서를 저장한다", async () => {
  const input = await perfectInput();
  const directory = await mkdtemp(join(tmpdir(), "pill-photo-score-test-"));
  const inputPath = join(directory, "input.json");
  const outputPath = join(directory, "outputs");
  await writeFile(inputPath, JSON.stringify(input), { flag: "wx" });
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("offline_score_must_not_fetch"); };
  try {
    const { report, directory: reportDirectory } = await runPillPhotoScore(
      ["--input", inputPath, "--split", "validation"],
      { outputDirectory: outputPath },
    );
    assert.equal(requests, 0);
    assert.equal(report.passed, true);
    const saved = JSON.parse(await readFile(join(reportDirectory, "report.json"), "utf8"));
    assert.equal(saved.policyVersion, report.policyVersion);
    assert.equal(saved.metrics.recallAt["5"].hits, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
