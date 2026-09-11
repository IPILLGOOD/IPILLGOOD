import assert from "node:assert/strict";
import test from "node:test";
import { readReviewedPhoto } from "../scripts/pill-photo.ts";
import { extractReviewedPillPhotos, pillPhotoRequest, prepareReviewedPillPhotoRequests } from "../src/pill-photo-experiment.ts";
import { PILL_PHOTO_INSTRUCTIONS, PILL_PHOTO_PROMPT_VERSION } from "../src/pill-photo-features.ts";
import { PILL_PHOTO_OCR_SIDE_SCHEMA_VERSION } from "../src/pill-photo-ocr.ts";
import { pillPhotoVisionInstructions, PILL_PHOTO_STRUCTURED_INSTRUCTIONS, PILL_PHOTO_STRUCTURED_PROMPT_VERSION,
  type PillPhotoVisionPromptVersion } from "../src/pill-photo-prompt-profiles.ts";
import { describePillPhotoTrialPreparation, PILL_PHOTO_TRIAL_PROTOCOL, PILL_PHOTO_STRUCTURED_TRIAL_PROTOCOL,
  pillPhotoTrialProtocol, assertCurrentPillPhotoTrialProtocol, trialSha256 } from "./pill-photo-trial.ts";
import { parsePillPhotoTrialArgs } from "../scripts/pill-photo-trial.ts";
import { pillObservation } from "./pill-fixtures.ts";

test("Vision opt-in은 instructions만 바꾸며 기본 요청·스키마·OCR 계약을 유지한다", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("network_forbidden"); });
  const photos = [await readReviewedPhoto(0), await readReviewedPhoto(1)] as const;
  const settings = { model: PILL_PHOTO_TRIAL_PROTOCOL.model, ocrModel: PILL_PHOTO_TRIAL_PROTOCOL.ocrModel };
  const before = await prepareReviewedPillPhotoRequests(photos, settings);
  const after = await prepareReviewedPillPhotoRequests(photos, { ...settings, visionPromptVersion: PILL_PHOTO_STRUCTURED_PROMPT_VERSION });
  assert.ok(before.ok && after.ok);
  assert.equal(before.requests.vision.instructions, PILL_PHOTO_INSTRUCTIONS);
  assert.equal(after.requests.vision.instructions, PILL_PHOTO_STRUCTURED_INSTRUCTIONS);
  assert.notEqual(before.requests.vision.instructions, after.requests.vision.instructions);
  assert.deepEqual({ ...after, requests: { ...after.requests, vision: { ...after.requests.vision, instructions: before.requests.vision.instructions } } }, before);
  const baselineDescription = await describePillPhotoTrialPreparation(before);
  const candidateDescription = await describePillPhotoTrialPreparation(after, PILL_PHOTO_STRUCTURED_TRIAL_PROTOCOL);
  assert.deepEqual([...candidateDescription.images.keys()], [...baselineDescription.images.keys()]);
  assert.equal(candidateDescription.manifest.requests[1]!.bodySha256, baselineDescription.manifest.requests[1]!.bodySha256);
  await assert.rejects(describePillPhotoTrialPreparation(after), /trial_request_settings_mismatch/);
  await assert.rejects(describePillPhotoTrialPreparation(before, PILL_PHOTO_STRUCTURED_TRIAL_PROTOCOL), /trial_request_settings_mismatch/);
});

test("미등록 프롬프트·holdout의 새 프롬프트 적용은 자료 로딩이나 전송 전에 거부한다", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("network_forbidden"); });
  const photos = [new Uint8Array([1]), new Uint8Array([2])] as const;
  const options = { model: "gpt-5.6-sol", ocrModel: "gpt-5.6-sol" };
  assert.throws(() => pillPhotoVisionInstructions("unregistered" as PillPhotoVisionPromptVersion), /trial_unknown_vision_prompt/);
  const unknown = await prepareReviewedPillPhotoRequests(photos, { ...options, visionPromptVersion: "unregistered" as PillPhotoVisionPromptVersion });
  assert.deepEqual(unknown, { ok: false, reason: "invalid_request" });
  for (const photoSet of ["phone_holdout", "evaluation", "unseen_evaluation"] as const) {
    const rejected = await prepareReviewedPillPhotoRequests(photos, { ...options, photoSet, visionPromptVersion: PILL_PHOTO_STRUCTURED_PROMPT_VERSION });
    assert.deepEqual(rejected, { ok: false, reason: "invalid_request" });
  }
  const fakeView = { context: Buffer.from("context"), alignedColor: Buffer.from("detail") };
  assert.equal(pillPhotoRequest(fakeView, fakeView, options.model).instructions, PILL_PHOTO_INSTRUCTIONS);
});

test("고정한 두 프로토콜만 선택할 수 있고 baseline 정의를 유지한다", () => {
  assert.equal(pillPhotoTrialProtocol(), PILL_PHOTO_TRIAL_PROTOCOL);
  assert.equal(pillPhotoTrialProtocol(PILL_PHOTO_STRUCTURED_TRIAL_PROTOCOL.id), PILL_PHOTO_STRUCTURED_TRIAL_PROTOCOL);
  assert.throws(() => pillPhotoTrialProtocol("validation-arbitrary"), /trial_unknown_protocol/);
  assertCurrentPillPhotoTrialProtocol(); assertCurrentPillPhotoTrialProtocol(PILL_PHOTO_STRUCTURED_TRIAL_PROTOCOL);
  assert.equal(PILL_PHOTO_TRIAL_PROTOCOL.visionPrompt, PILL_PHOTO_PROMPT_VERSION);
  assert.deepEqual({ ...PILL_PHOTO_STRUCTURED_TRIAL_PROTOCOL, id: PILL_PHOTO_TRIAL_PROTOCOL.id, visionPrompt: PILL_PHOTO_TRIAL_PROTOCOL.visionPrompt }, PILL_PHOTO_TRIAL_PROTOCOL);
  assert.deepEqual(parsePillPhotoTrialArgs(["prepare", "--protocol", PILL_PHOTO_STRUCTURED_TRIAL_PROTOCOL.id]),
    { mode: "prepare", protocolId: PILL_PHOTO_STRUCTURED_TRIAL_PROTOCOL.id });
  assert.throws(() => parsePillPhotoTrialArgs(["prepare", "--protocol", "v5"]), /trial_unknown_protocol/);
});

test("실제 전송 경로는 candidate Vision과 기존 면별 OCR을 쓰고 세 본문 해시를 유지한다", async () => {
  const photos = [await readReviewedPhoto(0), await readReviewedPhoto(1)] as const;
  const options = { model: PILL_PHOTO_TRIAL_PROTOCOL.model, ocrModel: PILL_PHOTO_TRIAL_PROTOCOL.ocrModel,
    visionPromptVersion: PILL_PHOTO_STRUCTURED_PROMPT_VERSION } as const;
  const prepared = await prepareReviewedPillPhotoRequests(photos, options); assert.ok(prepared.ok);
  const expected = [prepared.requests.vision, prepared.requests.ocrFront, prepared.requests.ocrBack];
  const { source, ...observation } = pillObservation(); assert.equal(source, "manual");
  let calls = 0;
  const result = await extractReviewedPillPhotos(photos, { ...options, allowExternalTransfer: true, apiKey: "synthetic-only",
    fetchImpl: async (_url, init) => {
      assert.equal(trialSha256(String(init?.body)), trialSha256(JSON.stringify(expected[calls])));
      const value = calls++ === 0 ? { observation, pairConsistency: "consistent", bothSidesVisible: true, imageArtifact: "none" }
        : { schemaVersion: PILL_PHOTO_OCR_SIDE_SCHEMA_VERSION, side: { imprintCandidates: [calls === 2 ? "TEST" : "10"], noImprintObserved: false, imprintVisibility: "clear" } };
      return new Response(JSON.stringify({ status: "completed", output: [{ type: "message", role: "assistant", status: "completed",
        content: [{ type: "output_text", text: JSON.stringify(value) }] }], usage: { input_tokens: 10, output_tokens: 5 } }),
      { headers: { "content-type": "application/json" } });
    } });
  assert.equal(calls, 3); assert.ok(result.ok);
});
