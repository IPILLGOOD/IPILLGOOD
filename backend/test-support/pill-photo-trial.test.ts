import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readReviewedPhoto } from "../scripts/pill-photo.ts";
import { assertPillPhotoTrialPlan, executePillPhotoTrialRepeats, executePillPhotoTrialRun, parsePillPhotoTrialArgs,
  runPillPhotoTrial, type PillPhotoTrialExecutionContext } from "../scripts/pill-photo-trial.ts";
import { extractReviewedPillPhotos, prepareReviewedPillPhotoRequests, type PillPhotoRequestTrace } from "../src/pill-photo-experiment.ts";
import { PILL_PHOTO_OCR_SIDE_SCHEMA_VERSION } from "../src/pill-photo-ocr.ts";
import { pillObservation, pillEnvelope, pillRecord } from "./pill-fixtures.ts";
import { parseOfficialPillPage } from "../src/official-pill-catalog.ts";
import { pillPhotoFeaturesSchema } from "../src/pill-photo-features.ts";
import { type PillPhotoCaseScore } from "./pill-photo-score.ts";
import { assertCurrentPillPhotoTrialProtocol, assertPillPhotoTrialPreparation, createPillPhotoTrialRequestGuard,
  describePillPhotoTrialPreparation, PILL_PHOTO_REQUEST_STAGES, PILL_PHOTO_TRIAL_CASE_IDS, PILL_PHOTO_TRIAL_PROTOCOL,
  summarizePillPhotoTrialRepeats, trialSha256, renderPillPhotoTrialPlan } from "./pill-photo-trial.ts";

const protocol = PILL_PHOTO_TRIAL_PROTOCOL;
const prepareOptions = { model: protocol.model, ocrModel: protocol.ocrModel };
async function inputs() { return [await readReviewedPhoto(0), await readReviewedPhoto(1)] as const; }
const { source, ...observation } = pillObservation();
assert.equal(source, "manual");
const features = { observation, pairConsistency: "consistent", bothSidesVisible: true, imageArtifact: "none" };
function providerResponse(stage: number) {
  const value = stage === 1 ? features : { schemaVersion: PILL_PHOTO_OCR_SIDE_SCHEMA_VERSION,
    side: { imprintCandidates: [stage === 2 ? "TEST" : "10"], noImprintObserved: false, imprintVisibility: "clear" } };
  return new Response(JSON.stringify({ id: `resp_test_${stage}`, model: "synthetic-returned-model", status: "completed",
    output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(value) }] }],
    usage: { input_tokens: 10, output_tokens: 5 },
  }), { headers: { "content-type": "application/json", "x-request-id": `req_test_${stage}` } });
}

test("고정 프로토콜과 keyless 준비는 전송 없이 정확한 요청 이미지·좌표·원문/스키마 해시를 기록한다", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("network_forbidden"); });
  assertCurrentPillPhotoTrialProtocol();
  assert.equal(protocol.repetitions, 3);
  assert.equal(protocol.maximumRequests, 54);
  const prepared = await prepareReviewedPillPhotoRequests(await inputs(), prepareOptions);
  assert.ok(prepared.ok);
  const described = await describePillPhotoTrialPreparation(prepared);
  assert.equal(described.manifest.requests.length, 3);
  assert.deepEqual(described.manifest.requests.map((request) => request.images.length), [4, 8, 8]);
  assert.ok(described.images.size > 0);
  for (const request of described.manifest.requests) {
    assert.equal(request.bodySha256, trialSha256(JSON.stringify(prepared.requests[request.stage])));
    for (const image of request.images) {
      const bytes = described.images.get(image.sha256)!;
      assert.equal(trialSha256(bytes), image.sha256);
      assert.equal(bytes.length, image.bytes);
      assert.ok(image.width > 0 && image.height > 0);
    }
  }
  const serialized = JSON.stringify(described.manifest);
  assert.doesNotMatch(serialized, /data:image\/png;base64|Authorization|apiKey|expectedItemSeq|mappingEvidenceUrl/);
  const preview = renderPillPhotoTrialPlan([{ id: "<script>alert(1)</script>", ...described.manifest }]);
  assert.ok(!preview.includes("<script>")); assert.ok(preview.includes("&lt;script&gt;"));
  assert.equal((preview.match(/<img /g) ?? []).length, 20);
  assertPillPhotoTrialPreparation(described.manifest, prepared);
  const changed = structuredClone(prepared);
  changed.requests.vision.instructions += " changed";
  assert.throws(() => assertPillPhotoTrialPreparation(described.manifest, changed), /trial_prepared_request_changed/);
  const wrongModel = structuredClone(prepared); wrongModel.requests.vision.model = "other-model";
  await assert.rejects(describePillPhotoTrialPreparation(wrongModel), /trial_request_settings_mismatch/);
});

test("실제 추출 경로의 세 요청은 준비 해시와 같고 callback 변경은 전송 내용에 영향을 주지 않는다", async () => {
  const photos = await inputs();
  const prepared = await prepareReviewedPillPhotoRequests(photos, prepareOptions);
  assert.ok(prepared.ok);
  const { manifest } = await describePillPhotoTrialPreparation(prepared);
  const events: PillPhotoRequestTrace[] = [];
  const count = { attempted: 0 };
  const guard = createPillPhotoTrialRequestGuard(manifest, count);
  let calls = 0;
  const result = await extractReviewedPillPhotos(photos, { ...prepareOptions,
    allowExternalTransfer: true, apiKey: "test-only-not-a-real-key",
    onPrepared: async (value) => {
      assertPillPhotoTrialPreparation(manifest, value);
      value.requests.vision.model = "callback-must-not-change-request";
    },
    onRequestTrace: async (event) => {
      events.push(event);
      if (event.phase === "started") guard.start(event.stage, event.requestSha256);
      else guard.finish(event.stage);
    },
    fetchImpl: async (_url, init) => {
      assert.equal(trialSha256(String(init?.body)), manifest.requests[calls]!.bodySha256);
      assert.equal(events.at(-1)!.phase, "started");
      assert.equal(JSON.parse(String(init?.body)).model, protocol.model);
      return providerResponse(++calls);
    },
  });
  assert.ok(result.ok);
  assert.equal(calls, 3); assert.equal(count.attempted, 3); assert.equal(guard.complete(), true);
  assert.deepEqual(events.map((event) => event.phase), ["started", "finished", "started", "finished", "started", "finished"]);
  const finished = events.filter((event) => event.phase === "finished");
  assert.equal(finished[0]!.requestId, "req_test_1");
  assert.equal(finished[0]!.responseId, "resp_test_1");
  assert.equal(finished[0]!.responseModel, "synthetic-returned-model");
  assert.deepEqual(finished[0]!.usage, { inputTokens: 10, outputTokens: 5 });
  assert.ok(finished.every((event) => event.elapsedMs >= 0 && event.httpStatus === 200));
  assert.doesNotMatch(JSON.stringify(events), /test-only-not-a-real-key|Authorization|image_url/);
});

test("준비/요청 기록이 실패하면 네트워크 전송 전에 중단하고 완료 기록 실패 후에는 후속 요청하지 않는다", async () => {
  const photos = await inputs();
  for (const point of ["prepared", "started", "finished"] as const) {
    let calls = 0;
    await assert.rejects(extractReviewedPillPhotos(photos, { ...prepareOptions, allowExternalTransfer: true, apiKey: "synthetic-key",
      onPrepared: async () => { if (point === "prepared") throw new Error("disk_failure"); },
      onRequestTrace: async (event) => { if (point === event.phase) throw new Error("disk_failure"); },
      fetchImpl: async () => providerResponse(++calls),
    }), /disk_failure/);
    assert.equal(calls, point === "finished" ? 1 : 0);
  }
});

test("HTTP/통신 실패도 시도·완료로 기록하고 오류 본문·키를 보관하거나 자동 재시도하지 않는다", async () => {
  for (const networkError of [false, true]) {
    const events: PillPhotoRequestTrace[] = [];
    let calls = 0;
    const result = await extractReviewedPillPhotos(await inputs(), { ...prepareOptions, allowExternalTransfer: true, apiKey: "synthetic-key",
      onRequestTrace: async (event) => { events.push(event); },
      fetchImpl: async () => {
        calls++;
        if (networkError) throw new Error("sensitive-network-diagnostic");
        return new Response("sensitive-provider-body", { status: 503, headers: { "x-request-id": "req_failed" } });
      },
    });
    assert.deepEqual(result, { ok: false, reason: networkError ? "network_error" : "provider_unavailable" });
    assert.equal(calls, 1); assert.equal(events.length, 2);
    assert.doesNotMatch(JSON.stringify(events), /sensitive|synthetic-key/);
    const final = events[1]!; assert.equal(final.phase, "finished");
    if (final.phase === "finished") assert.equal(final.httpStatus, networkError ? null : 503);
  }
});

test("요청 순서·본문 해시·전체 54회 상한을 전송 시작 전에 강제한다", async () => {
  const prepared = await prepareReviewedPillPhotoRequests(await inputs(), prepareOptions); assert.ok(prepared.ok);
  const { manifest } = await describePillPhotoTrialPreparation(prepared);
  const count = { attempted: 0 };
  const guard = createPillPhotoTrialRequestGuard(manifest, count);
  assert.throws(() => guard.start("ocrFront", manifest.requests[1]!.bodySha256), /trial_request_guard_failed/);
  assert.throws(() => guard.start("vision", "wrong-hash"), /trial_request_guard_failed/);
  for (const [index, stage] of PILL_PHOTO_REQUEST_STAGES.entries()) {
    guard.start(stage, manifest.requests[index]!.bodySha256);
    assert.throws(() => guard.start(stage, manifest.requests[index]!.bodySha256), /trial_request_guard_failed/);
    guard.finish(stage);
  }
  assert.equal(guard.complete(), true);
  const overBudget = createPillPhotoTrialRequestGuard(manifest, { attempted: 54 });
  assert.throws(() => overBudget.start("vision", manifest.requests[0]!.bodySha256), /trial_request_guard_failed/);
});

test("고정 3회 × 6사례를 순서대로 실행하고 중간 실패는 작은 성공 평가나 재시도로 바꾸지 않는다", async () => {
  const calls: string[] = [], completed: number[] = [];
  const status = await executePillPhotoTrialRepeats(async (repetition, id) => { calls.push(`${repetition}/${id}`); return true; },
    async (repetition) => { completed.push(repetition); });
  assert.equal(status.status, "complete"); assert.equal(calls.length, 18); assert.deepEqual(completed, [1, 2, 3]);
  assert.deepEqual(calls, [1, 2, 3].flatMap((repeat) => PILL_PHOTO_TRIAL_CASE_IDS.map((id) => `${repeat}/${id}`)));
  let failedCalls = 0, incompleteScored = 0;
  const failed = await executePillPhotoTrialRepeats(async () => ++failedCalls < 2, async () => { incompleteScored++; });
  assert.deepEqual(failed, { status: "incomplete", repetition: 1, failedCaseId: "v4-v02" });
  assert.equal(failedCalls, 2); assert.equal(incompleteScored, 0);
});

test("반복 실행 편차는 모든 실행의 순위·후보·보류를 보존하고 최고 결과만 택하지 않는다", () => {
  const repeats = [1, 2, 3].map((repetition) => ({ repetition, passed: false,
    rows: PILL_PHOTO_TRIAL_CASE_IDS.map((id): PillPhotoCaseScore => ({ id, expectedItemSeq: "synthetic-item",
      extractionStatus: "ok", failureReason: null, comparisonStatus: "searched", comparisonReason: "features_compared",
      searchStatus: "needs_review", expectedRank: repetition === 2 ? 6 : 1, expectedHeld: false,
      candidateItemSeqs: ["synthetic-item"], heldCandidateItemSeqs: [], strongCandidateItemSeqs: [], strongWrongCandidateItemSeqs: [], needsRetake: false })) }));
  const summary = summarizePillPhotoTrialRepeats(repeats);
  assert.deepEqual(summary.recall[1]!.hitsByRepetition, [6, 0, 6]);
  assert.deepEqual(summary.rows[0]!.ranks, [1, 6, 1]);
  assert.equal(summary.rows[0]!.changed, true); assert.equal(summary.independentProducts, 6);
  assert.throws(() => summarizePillPhotoTrialRepeats(repeats.slice(0, 1)), /trial_incomplete_repetitions/);
});

test("plan 변조·다른 조건·holdout·환경변수 무단 모델변경 경로를 허용하지 않는다", async (t) => {
  assert.deepEqual(parsePillPhotoTrialArgs(["prepare"]), { mode: "prepare" });
  for (const args of [["prepare", "--live"], ["run", "--plan", "x"], ["run", "--plan", "x", "--live", "--confirm-reviewed-transfer", "--fixture", "v5"],
    ["run", "--plan", "x", "--live", "--confirm-reviewed-transfer", "--model", "other"]]) {
    assert.throws(() => parsePillPhotoTrialArgs(args), /trial_/);
  }
  const condition = { test: "synthetic-condition" };
  const plan = { schemaVersion: "pill-photo-trial-plan.v1", preparedAt: "2026-09-06T00:00:00.000Z", externalRequests: 0,
    conditionSha256: trialSha256(JSON.stringify(condition)), condition };
  assertPillPhotoTrialPlan(plan, condition);
  assert.throws(() => assertPillPhotoTrialPlan({ ...plan, conditionSha256: "0".repeat(64) }, condition), /trial_plan_changed_or_invalid/);
  assert.throws(() => assertPillPhotoTrialPlan(plan, { test: "changed-code-or-images" }), /trial_plan_changed_or_invalid/);
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  t.after(() => { if (previous !== undefined) process.env.OPENAI_API_KEY = previous; });
  await assert.rejects(runPillPhotoTrial(["run", "--plan", "not-a-real-plan", "--live", "--confirm-reviewed-transfer"]), /trial_api_key_required/);
});

test("합성 54요청 저장 통합: 모든 반복·요청 trace·score를 남기고 중간 실패는 features 합격 파일을 만들지 않는다", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("network_forbidden"); });
  const photos = await inputs();
  const prepared = await prepareReviewedPillPhotoRequests(photos, prepareOptions); assert.ok(prepared.ok);
  const { manifest } = await describePillPhotoTrialPreparation(prepared);
  const records = PILL_PHOTO_TRIAL_CASE_IDS.map((_, index) => pillRecord({ ITEM_SEQ: String(209900001 + index) }));
  const catalog = { ...parseOfficialPillPage(pillEnvelope(records), "json", "2026-09-01T00:00:00.000Z"),
    completeness: "complete" as const, version: "synthetic-integration-only" };
  const context: PillPhotoTrialExecutionContext = {
    // Synthetic IO fixture only. Production CLI obtains and verifies 12 DISTINCT phone images before reaching this executor.
    condition: { protocol, code: [], cases: PILL_PHOTO_TRIAL_CASE_IDS.map((id) => ({ id, ...manifest })) },
    conditionSha256: "0".repeat(64), pairs: PILL_PHOTO_TRIAL_CASE_IDS.map((id) => ({ id, photos })), catalog,
    fixture: { fixtureVersion: protocol.fixtureVersion, scope: { claim: "synthetic storage integration only" },
      minimumCasesForPass: { validation: 6, holdout: 6 }, cases: PILL_PHOTO_TRIAL_CASE_IDS.map((id, index) => ({
        id, split: "validation", expectedItemSeq: String(209900001 + index),
      })) },
  };
  let requests = 0;
  const extractor: typeof extractReviewedPillPhotos = async (_photos, options) => {
    await options?.onPrepared?.(structuredClone(prepared));
    for (const request of manifest.requests) {
      await options?.onRequestTrace?.({ phase: "started", stage: request.stage, requestSha256: request.bodySha256 });
      requests++;
      await options?.onRequestTrace?.({ phase: "finished", stage: request.stage, requestSha256: request.bodySha256, elapsedMs: 1,
        httpStatus: 200, requestId: `req_synthetic_${requests}`, responseId: `resp_synthetic_${requests}`,
        responseModel: "synthetic-only", responseStatus: "completed", usage: { inputTokens: 1, outputTokens: 1 }, outcome: "response_received" });
    }
    return { ok: true, features: pillPhotoFeaturesSchema.parse(features), usage: { inputTokens: 3, outputTokens: 3 } };
  };
  const directory = await mkdtemp(join(tmpdir(), "pill-trial-synthetic-"));
  const result = await executePillPhotoTrialRun(context, directory, "never-persist-this-key", extractor);
  assert.equal(result.status, "complete"); assert.equal(requests, 54); assert.equal(result.completedRepetitions, 3);
  const summary = JSON.parse(await readFile(join(directory, "summary.json"), "utf8"));
  assert.equal(summary.comparison.independentProducts, 6);
  assert.equal(summary.responseModels.length, 54);
  for (const repetition of [1, 2, 3]) {
    const repeat = join(directory, `repeat-${repetition}`);
    const names = await readdir(repeat);
    assert.equal(names.filter((name) => name.endsWith("-started.json")).length, 18);
    assert.equal(names.filter((name) => name.endsWith("-finished.json")).length, 18);
    const savedFeatures = JSON.parse(await readFile(join(repeat, "features.json"), "utf8"));
    assert.equal(savedFeatures.requests, 18); assert.equal(savedFeatures.cases.length, 6);
    for (const name of names) assert.doesNotMatch(await readFile(join(repeat, name), "utf8"), /never-persist-this-key|Authorization/);
  }
  let casesAttempted = 0;
  const failedDirectory = await mkdtemp(join(tmpdir(), "pill-trial-incomplete-synthetic-"));
  const failed = await executePillPhotoTrialRun(context, failedDirectory, "never-persist-this-key", async (pair, options) => {
    casesAttempted++;
    return casesAttempted === 1 ? extractor(pair, options) : { ok: false, reason: "ocr_failed" };
  });
  assert.equal(failed.status, "incomplete"); assert.equal(failed.comparison, null); assert.equal(casesAttempted, 2);
  await assert.rejects(readFile(join(failedDirectory, "repeat-1/features.json")), { code: "ENOENT" });
});
