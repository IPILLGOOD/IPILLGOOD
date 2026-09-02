import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parsePillPhotoEvaluationArgs, runPillPhotoEvaluation } from "../scripts/pill-photo-evaluate.ts";
import { PILL_OBSERVATION_SCHEMA_VERSION } from "../src/pill-identification.ts";
import { pillPhotoFeaturesSchema } from "../src/pill-photo-features.ts";
import { loadPillPhotoEvaluationFixture } from "./pill-photo-evaluation.ts";
import { parsePillPhotoScoreInput } from "./pill-photo-score.ts";

const features = pillPhotoFeaturesSchema.parse({
  observation: {
    schemaVersion: PILL_OBSERVATION_SCHEMA_VERSION,
    form: "tablet",
    integrity: "intact",
    count: 1,
    overlapping: false,
    quality: "clear",
    shape: "타원형",
    colors: ["노랑"],
    front: { imprintCandidates: ["HM"], noImprintObserved: false, imprintVisibility: "clear", scoreLine: "unknown" },
    back: { imprintCandidates: ["10"], noImprintObserved: false, imprintVisibility: "clear", scoreLine: "unknown" },
  },
  pairConsistency: "consistent",
  bothSidesVisible: true,
  imageArtifact: "none",
});

test("validation과 holdout 외부 전송 확인을 분리하고 보류 세트의 조기 실행을 막는다", () => {
  assert.deepEqual(parsePillPhotoEvaluationArgs(["validation", "--live", "--confirm-public-transfer"]), { split: "validation", fixture: "v2" });
  assert.deepEqual(parsePillPhotoEvaluationArgs(["validation", "--fixture", "v3", "--live", "--confirm-public-transfer"]), { split: "validation", fixture: "v3" });
  assert.deepEqual(parsePillPhotoEvaluationArgs(["holdout", "--live", "--confirm-public-transfer", "--confirm-holdout-final"]), { split: "holdout", fixture: "v2" });
  assert.throws(() => parsePillPhotoEvaluationArgs(["validation"]), /explicit_public_transfer_required/);
  assert.throws(() => parsePillPhotoEvaluationArgs(["validation", "--fixture", "v4", "--live", "--confirm-public-transfer"]), /invalid_fixture/);
  assert.throws(() => parsePillPhotoEvaluationArgs(["holdout", "--live", "--confirm-public-transfer"]), /holdout_confirmation_required/);
  assert.throws(() => parsePillPhotoEvaluationArgs(["validation", "--live", "--confirm-public-transfer", "--confirm-holdout-final"]), /holdout_confirmation_not_allowed/);
});

test("v3 validation은 봉인 holdout을 제외한 새 품목 4건만 실행한다", async (context) => {
  const outputRoot = join(tmpdir(), `pill-photo-evaluate-v3-${process.pid}-${Date.now()}`);
  context.after(() => rm(outputRoot, { recursive: true, force: true }));
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-not-a-real-key";
  context.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  });
  const photoSets: string[] = [];
  const extractor = (async (_photos: readonly [Uint8Array, Uint8Array], options: { photoSet?: string; fetchImpl?: typeof fetch }) => {
    photoSets.push(options.photoSet ?? "");
    await options.fetchImpl!("https://api.openai.com/v1/responses", { method: "POST" });
    await options.fetchImpl!("https://api.openai.com/v1/responses", { method: "POST" });
    await options.fetchImpl!("https://api.openai.com/v1/responses", { method: "POST" });
    return { ok: true as const, features, usage: null };
  }) as typeof import("../src/pill-photo-experiment.ts").extractReviewedPillPhotos;
  const result = await runPillPhotoEvaluation(
    ["validation", "--fixture", "v3", "--live", "--confirm-public-transfer"],
    {
      outputDirectory: outputRoot,
      extractor,
      fetcher: async () => new Response("{}", { headers: { "content-type": "application/json" } }),
      now: () => new Date("2026-09-02T01:00:00.000Z"),
    },
  );
  assert.equal(result.output.cases.length, 4);
  assert.equal(result.output.requests, 12);
  assert.deepEqual(photoSets, ["unseen_evaluation", "unseen_evaluation", "unseen_evaluation", "unseen_evaluation"]);
  assert.deepEqual(result.output.cases.map((entry) => entry.id), ["unseen-v-01", "unseen-v-02", "unseen-v-03", "unseen-v-04"]);
});

test("고정 validation 4건만 세 요청씩 실행하고 정답 없는 채점 입력을 저장한다", async (context) => {
  const outputRoot = join(tmpdir(), `pill-photo-evaluate-${process.pid}-${Date.now()}`);
  context.after(() => rm(outputRoot, { recursive: true, force: true }));
  const previousKey = process.env.OPENAI_API_KEY;
  const previousModel = process.env.OPENAI_MODEL;
  const previousOcrModel = process.env.OPENAI_OCR_MODEL;
  process.env.OPENAI_API_KEY = "test-only-not-a-real-key";
  process.env.OPENAI_MODEL = "test-model";
  process.env.OPENAI_OCR_MODEL = "test-ocr-model";
  context.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = previousModel;
    if (previousOcrModel === undefined) delete process.env.OPENAI_OCR_MODEL;
    else process.env.OPENAI_OCR_MODEL = previousOcrModel;
  });
  let extracted = 0;
  const extractor = (async (_photos: readonly [Uint8Array, Uint8Array], options: { fetchImpl?: typeof fetch }) => {
    extracted++;
    await options.fetchImpl!("https://api.openai.com/v1/responses", { method: "POST" });
    await options.fetchImpl!("https://api.openai.com/v1/responses", { method: "POST" });
    await options.fetchImpl!("https://api.openai.com/v1/responses", { method: "POST" });
    return { ok: true as const, features, usage: { inputTokens: 100, outputTokens: 10 } };
  }) as typeof import("../src/pill-photo-experiment.ts").extractReviewedPillPhotos;
  const result = await runPillPhotoEvaluation(["validation", "--live", "--confirm-public-transfer"], {
    outputDirectory: outputRoot,
    extractor,
    fetcher: async () => new Response("{}", { headers: { "content-type": "application/json" } }),
    now: () => new Date("2026-09-02T00:00:00.000Z"),
  });
  assert.equal(extracted, 4);
  assert.equal(result.output.requests, 12);
  assert.equal(result.output.pipeline.ocrModel, "test-ocr-model");
  assert.equal(result.output.split, "validation");
  assert.equal(result.output.cases.length, 4);
  const { manifest } = await loadPillPhotoEvaluationFixture();
  assert.deepEqual(parsePillPhotoScoreInput(JSON.parse(await readFile(result.featureFile, "utf8")), manifest, "validation"), result.output);
  const serialized = await readFile(result.featureFile, "utf8");
  assert.doesNotMatch(serialized, /expectedItemSeq|receipt|mappingEvidenceUrl|officialSide/);
  assert.doesNotMatch(serialized, /201505259|201800300|201906970|200801352|29002|40792|41107|41344/);
});
