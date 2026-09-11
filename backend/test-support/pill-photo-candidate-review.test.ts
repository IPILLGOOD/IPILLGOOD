import assert from "node:assert/strict";
import test from "node:test";
import { parseOfficialPillPage } from "../src/official-pill-catalog.ts";
import { pillPhotoOcrRequest, pillPhotoRequest, type PreparedPillPhotoRequests } from "../src/pill-photo-experiment.ts";
import { comparePillPhotoFeatures, pillPhotoFeaturesSchema, type PillPhotoFeatures } from "../src/pill-photo-features.ts";
import { observedSide, pillEnvelope, pillObservation, pillRecord } from "./pill-fixtures.ts";
import { buildCandidateReviewPool } from "./pill-photo-candidate-pool.ts";
import { applyCandidateReview, buildCandidateReviewRequest, candidateReviewSchema,
  CANDIDATE_REVIEW_PROTOCOL, parseCandidateReviewResponse, type CandidateReview } from "./pill-photo-candidate-review.ts";
import { PILL_PHOTO_TRIAL_PROTOCOL as BASE, trialSha256 } from "./pill-photo-trial.ts";

// Synthetic header/marker bytes test transport identity, not image quality; never transmitted.
const png = (name: string) => Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from(name)]);
const rotations = (name: string): [Buffer, Buffer, Buffer, Buffer] => [png(`${name}-0`), png(`${name}-90`), png(`${name}-180`), png(`${name}-270`)];
function prepared(): PreparedPillPhotoRequests {
  const a = rotations("a-color"), b = rotations("b-color");
  return { ok: true, sourceSha256: [trialSha256("source-a"), trialSha256("source-b")], preprocessing: [], requests: {
    vision: pillPhotoRequest({ context: png("a-context"), alignedColor: a[0] }, { context: png("b-context"), alignedColor: b[0] }, BASE.model),
    ocrFront: pillPhotoOcrRequest(a, rotations("a-contrast"), BASE.ocrModel),
    ocrBack: pillPhotoOcrRequest(b, rotations("b-contrast"), BASE.ocrModel),
  } };
}
function features(): PillPhotoFeatures {
  const { source, ...observation } = pillObservation();
  assert.equal(source, "manual");
  return pillPhotoFeaturesSchema.parse({ observation, pairConsistency: "consistent", bothSidesVisible: true, imageArtifact: "none" });
}
function setup() {
  const catalog = { ...parseOfficialPillPage(pillEnvelope([
    pillRecord(), pillRecord({ ITEM_SEQ: "209900002", ITEM_NAME: "PRIVATE NAME NEVER SEND", ENTP_NAME: "PRIVATE MAKER NEVER SEND", COLOR_CLASS1: "노랑" }),
  ]), "json", "2026-01-01T00:00:00.000Z"), completeness: "complete" as const, version: "synthetic-candidate-review" };
  const original = features(), pool = buildCandidateReviewPool(original, catalog);
  assert.equal(pool.status, "ready"); assert.equal(pool.cards.length, 2);
  return { catalog, original, pool };
}
function reviewSide(text: string): CandidateReview["front"] {
  return { imprintCandidates: text ? [text] : [], noImprintObserved: !text, imprintVisibility: "clear", visibleEvidence: "synthetic visible strokes" };
}
function review(): CandidateReview {
  return { decision: "readings_observed", front: reviewSide("TEST"), back: reviewSide("10"), candidateChecks: [] };
}
function envelope(value: unknown) {
  return { status: "completed", output: [{ type: "message", role: "assistant", status: "completed",
    content: [{ type: "output_text", text: JSON.stringify(value) }] }] };
}

test("candidate rereading request reuses exactly 18 synthetic views with fixed model, no labels or ranks, and strict schema", t => {
  const network = t.mock.method(globalThis, "fetch", () => { throw Error("network_forbidden"); });
  const { original, pool } = setup(), source = prepared(), before = structuredClone({ original, pool, source });
  const request = buildCandidateReviewRequest(source, original, pool);
  const images = request.body.input[0]!.content.filter(part => "image_url" in part);
  const expected = [png("a-context"), ...rotations("a-color"), ...rotations("a-contrast"),
    png("b-context"), ...rotations("b-color"), ...rotations("b-contrast")];
  assert.equal(images.length, 18);
  images.forEach((part, index) => { assert.ok("image_url" in part); assert.equal(part.detail, "high");
    assert.equal(part.image_url, `data:image/png;base64,${expected[index]!.toString("base64")}`); });
  assert.deepEqual(request.imageSha256, expected.map(trialSha256));
  assert.equal(request.body.model, BASE.model); assert.deepEqual(request.body.reasoning, { effort: BASE.reasoningEffort });
  assert.equal(request.body.store, false); assert.equal(request.body.max_output_tokens, CANDIDATE_REVIEW_PROTOCOL.maxOutputTokens);
  assert.equal(request.body.text.format.type, "json_schema"); assert.equal(request.body.text.format.strict, true);
  assert.equal(request.body.text.format.schema.additionalProperties, false);
  assert.equal(request.provenance, "candidate_conditioned_not_independent_ocr");
  assert.equal(request.bodySha256, trialSha256(JSON.stringify(request.body)));
  const body = JSON.stringify(request.body);
  assert.equal(request.requestBytes, Buffer.byteLength(body));
  assert.ok(!/209900001|209900002|PRIVATE NAME|PRIVATE MAKER|expectedItemSeq|originalProductRank|recordSha256|bindings|itemSeq|itemName|manufacturer/.test(body));
  assert.deepEqual({ original, pool, source }, before); assert.equal(network.mock.callCount(), 0);
});

test("request preparation catches an oversized combined payload before a plan or network dispatch", t => {
  const network = t.mock.method(globalThis, "fetch", () => { throw Error("network_forbidden"); });
  const { original, pool } = setup(), source = prepared();
  const oversizedContext = Buffer.alloc(30 * 1024 * 1024);
  png("synthetic").copy(oversizedContext);
  source.requests.vision = pillPhotoRequest({ context: oversizedContext, alignedColor: rotations("a-color")[0] },
    { context: png("b-context"), alignedColor: rotations("b-color")[0] }, BASE.model);
  assert.throws(() => buildCandidateReviewRequest(source, original, pool), /request_too_large_before_transfer/);
  assert.equal(network.mock.callCount(), 0);
});

test("anonymous card projection excludes added private identity metadata and isolates returned request images", () => {
  const { original, pool } = setup(), source = prepared();
  Object.assign(pool.cards[0]!, { itemSeq: "DO-NOT-SEND-ID", expectedItemSeq: "DO-NOT-SEND-ANSWER", name: "DO-NOT-SEND-NAME", rank: 1 });
  Object.assign(pool.cards[0]!.front, { productName: "DO-NOT-SEND-SIDE-NAME" });
  const before = structuredClone(source), request = buildCandidateReviewRequest(source, original, pool);
  assert.ok(!JSON.stringify(request.body).includes("DO-NOT-SEND"));
  const image = request.body.input[0]!.content.find(part => "image_url" in part)!;
  assert.ok("image_url" in image); image.image_url = "mutated-after-build";
  assert.deepEqual(source, before);
});

test("request builder rejects changed canonical settings, extra text, remote/non-PNG images and incomplete image sets", () => {
  const { original, pool } = setup();
  const mutations: Array<(source: PreparedPillPhotoRequests) => void> = [
    value => { value.requests.vision.model = "wrong-model"; },
    value => { value.requests.ocrFront.instructions = "changed-prompt"; },
    value => { value.requests.ocrBack.max_output_tokens += 1; },
    value => { value.requests.ocrFront = pillPhotoOcrRequest(rotations("different-photo-color"), rotations("a-contrast"), BASE.ocrModel); },
    value => { value.requests.vision.input[0]!.content.push({ type: "input_text", text: "secret label" }); },
    value => { value.requests.ocrFront.input[0]!.content.pop(); },
    value => { const image = value.requests.vision.input[0]!.content.find(part => "image_url" in part)!;
      assert.ok("image_url" in image); image.image_url = "https://example.invalid/photo.png"; },
    value => { const image = value.requests.ocrBack.input[0]!.content.find(part => "image_url" in part)!;
      assert.ok("image_url" in image); image.image_url = "data:image/png;base64,bm90IGEgcG5n"; },
  ];
  for (const mutate of mutations) { const source = prepared(); mutate(source);
    assert.throws(() => buildCandidateReviewRequest(source, original, pool), /candidate_review_/); }
  const blocked = structuredClone(pool); blocked.status = "blocked";
  assert.throws(() => buildCandidateReviewRequest(prepared(), original, blocked), /pool_not_ready/);
  const empty = structuredClone(pool); empty.cards = [];
  assert.throws(() => buildCandidateReviewRequest(prepared(), original, empty), /pool_not_ready/);
});

test("response parser accepts one valid structured reading and known candidate comparisons without using their order", () => {
  const { pool } = setup(), response = review();
  response.candidateChecks = pool.cards.map(card => ({ ref: card.ref, orientation: "swapped", frontText: "supported", backText: "unknown",
    shape: "conflict", colors: "unknown", scoreLines: "unknown", visibleEvidence: "same complete record pair" }));
  assert.deepEqual(parseCandidateReviewResponse(envelope(response), pool), { ok: true, review: response });
  const withReasoning = envelope(response); withReasoning.output.unshift({ type: "reasoning", role: "assistant", status: "completed", content: [] });
  assert.deepEqual(parseCandidateReviewResponse(withReasoning, pool), { ok: true, review: response });
});

test("response parser rejects refusals, incomplete/missing/multiple outputs and malformed JSON", () => {
  const { pool } = setup();
  assert.deepEqual(parseCandidateReviewResponse({ status: "incomplete", output: [] }, pool), { ok: false, reason: "incomplete_response" });
  assert.deepEqual(parseCandidateReviewResponse({ status: "completed", output: [{ type: "message", role: "assistant", status: "completed",
    content: [{ type: "refusal", refusal: "cannot inspect" }] }] }, pool), { ok: false, reason: "refused" });
  const multiple = envelope(review()); multiple.output[0]!.content.push({ type: "output_text", text: JSON.stringify(review()) });
  const malformed = envelope(review()); malformed.output[0]!.content[0]!.text = "not JSON";
  const wrongRole = envelope(review()); wrongRole.output[0]!.role = "user";
  for (const value of [{}, { status: "completed", output: [] }, multiple, malformed, wrongRole]) {
    assert.deepEqual(parseCandidateReviewResponse(value, pool), { ok: false, reason: "invalid_response" });
  }
});

test("strict response excludes identity fields at every layer, unknown/duplicate references and unbounded candidates", () => {
  const { pool } = setup(), check: CandidateReview["candidateChecks"][number] = { ref: pool.cards[0]!.ref,
    orientation: "direct", frontText: "supported", backText: "supported", shape: "unknown", colors: "unknown", scoreLines: "unknown", visibleEvidence: "visible" };
  const values: unknown[] = [
    { ...review(), itemSeq: "209900001" }, { ...review(), medicineName: "guessed" },
    { ...review(), front: { ...reviewSide("TEST"), ingredient: "guessed" } },
    { ...review(), candidateChecks: [{ ...check, probability: 0.99 }] },
    { ...review(), candidateChecks: [{ ...check, ref: "unknown-ref" }] },
    { ...review(), candidateChecks: [check, check] },
    { ...review(), front: { ...reviewSide("TEST"), imprintCandidates: ["A", "B", "C", "D", "E", "F"] } },
    { ...review(), front: { ...reviewSide("TEST"), imprintCandidates: ["   "] } },
  ];
  for (const value of values) assert.deepEqual(parseCandidateReviewResponse(envelope(value), pool), { ok: false, reason: "invalid_response" });
  assert.equal(candidateReviewSchema.safeParse({ ...review(), expectedItemSeq: "209900001" }).success, false);
});

test("response parser separates directly observed blank, unreadable and empty partial without inventing clear text", () => {
  const { pool } = setup();
  const valid: CandidateReview["front"][] = [reviewSide(""), { ...reviewSide(""), noImprintObserved: false, imprintVisibility: "unreadable" },
    { ...reviewSide(""), noImprintObserved: false, imprintVisibility: "partial" }];
  for (const front of valid) assert.equal(parseCandidateReviewResponse(envelope({ ...review(), front }), pool).ok, true);
  const invalid: CandidateReview["front"][] = [
    { ...reviewSide("TEST"), noImprintObserved: true }, { ...reviewSide(""), imprintVisibility: "partial" },
    { ...reviewSide("TEST"), imprintVisibility: "unreadable" }, { ...reviewSide(""), imprintVisibility: "unreadable" },
    { ...reviewSide(""), noImprintObserved: false },
  ];
  for (const front of invalid) assert.deepEqual(parseCandidateReviewResponse(envelope({ ...review(), front }), pool), { ok: false, reason: "invalid_response" });
});

test("unchanged normalized readings preserve original raw spelling, visibility and complete feature state", () => {
  const { original, pool } = setup(); original.observation.front!.imprintCandidates = ["T E S T"];
  original.observation.front!.imprintVisibility = "partial";
  const before = structuredClone(original), result = applyCandidateReview(original, pool, review());
  assert.equal(result.status, "unchanged"); assert.deepEqual(result.features, before); assert.deepEqual(result.changes, []);
  assert.deepEqual(original, before); assert.notEqual(result.features, original);
});

test("changed text is capped at partial, retains visual/global safety and cannot become a strong search result", () => {
  const { original, pool, catalog } = setup(), response = review();
  original.observation.front!.imprintCandidates = ["TESX"];
  const before = structuredClone({ original, pool, response }), result = applyCandidateReview(original, pool, response);
  assert.equal(result.status, "applied"); assert.ok(result.features);
  assert.deepEqual(result.features, { ...original, observation: { ...original.observation,
    front: { ...original.observation.front, imprintCandidates: ["TEST"], imprintVisibility: "partial" } } });
  assert.deepEqual(result.changes, [{ side: "front", before: ["TESX"], after: ["TEST"], visibilityBefore: "clear", visibilityAfter: "partial" }]);
  const comparison = comparePillPhotoFeatures(result.features, catalog);
  assert.ok(comparison.search?.candidates.length); assert.ok(comparison.search.candidates.every(candidate => candidate.grade !== "strong"));
  assert.deepEqual({ original, pool, response }, before);
});

test("existing image, pair and observation safety facts cannot be upgraded by a successful rereading", () => {
  const { original, pool, catalog } = setup(), response = review(); response.front = reviewSide("TESX");
  original.imageArtifact = "present"; original.pairConsistency = "uncertain"; original.bothSidesVisible = false;
  original.observation.quality = "dark"; original.observation.integrity = "damaged"; original.observation.overlapping = true; original.observation.count = 2;
  original.observation.form = "unknown"; original.observation.shape = "타원형"; original.observation.colors = ["분홍"];
  const before = structuredClone(original), result = applyCandidateReview(original, pool, response);
  assert.equal(result.status, "applied"); assert.ok(result.features);
  const restoredText = structuredClone(result.features); restoredText.observation.front = before.observation.front;
  assert.deepEqual(restoredText, before);
  const comparison = comparePillPhotoFeatures(result.features, catalog);
  assert.equal(comparison.status, "needs_retake"); assert.equal(comparison.search, null);
  assert.deepEqual(original, before);
});

test("missing surfaces and direct-blank state cannot be invented or reversed using references", () => {
  const { original, pool } = setup();
  const missing = structuredClone(original); missing.observation.front = null;
  const blank = structuredClone(original); blank.observation.front = observedSide("", "single");
  const nextBlank = review(); nextBlank.front = reviewSide("");
  for (const [input, response] of [[missing, review()], [blank, review()], [original, nextBlank]] as const) {
    const before = structuredClone(input), result = applyCandidateReview(input, pool, response);
    assert.equal(result.status, "abstained"); assert.equal(result.reason, "surface_state_conflict"); assert.equal(result.features, null);
    assert.deepEqual(input, before);
  }
  const unchangedBlank = applyCandidateReview(blank, pool, nextBlank);
  assert.equal(unchangedBlank.status, "unchanged"); assert.deepEqual(unchangedBlank.features, blank);
});

test("unreadable and partial updates only downgrade confidence and never create direct no-imprint observations", () => {
  const { original, pool } = setup();
  const downgrade = review(); downgrade.front = { ...reviewSide(""), noImprintObserved: false, imprintVisibility: "unreadable" };
  const result = applyCandidateReview(original, pool, downgrade); assert.equal(result.status, "applied"); assert.ok(result.features);
  assert.deepEqual(result.features.observation.front, observedSide(null, "single"));
  const partial = review(); partial.front.imprintVisibility = "partial";
  const partialResult = applyCandidateReview(original, pool, partial); assert.equal(partialResult.status, "applied");
  assert.equal(partialResult.features?.observation.front?.imprintVisibility, "partial");
  const oldUnreadable = structuredClone(original); oldUnreadable.observation.front = observedSide(null, "single");
  const newReading = applyCandidateReview(oldUnreadable, pool, review()); assert.equal(newReading.status, "applied");
  assert.equal(newReading.features?.observation.front?.imprintVisibility, "partial");
  assert.equal(newReading.features?.observation.front?.noImprintObserved, false);
});

test("abstention and blocked pools return no features instead of silently falling back to stored candidates", () => {
  const { original, pool } = setup();
  for (const decision of ["needs_retake", "no_supported_candidate"] as const) {
    const result = applyCandidateReview(original, pool, { ...review(), decision });
    assert.equal(result.status, "abstained"); assert.equal(result.reason, decision); assert.equal(result.features, null); assert.deepEqual(result.changes, []);
  }
  const blocked = structuredClone(pool); blocked.status = "blocked"; blocked.reason = "unverified_photo_pair";
  const result = applyCandidateReview(original, blocked, review()); assert.equal(result.status, "blocked");
  assert.equal(result.reason, "unverified_photo_pair"); assert.equal(result.features, null);
});

test("model candidate checks cannot directly select, remove, orient or reorder the existing search candidates", () => {
  const { original, pool, catalog } = setup(), response = review(), before = comparePillPhotoFeatures(original, catalog);
  response.candidateChecks = [...pool.cards].reverse().map(card => ({ ref: card.ref, orientation: "swapped", frontText: "conflict", backText: "conflict",
    shape: "supported", colors: "supported", scoreLines: "supported", visibleEvidence: "synthetic contradictory commentary" }));
  const result = applyCandidateReview(original, pool, response); assert.equal(result.status, "unchanged");
  assert.deepEqual(comparePillPhotoFeatures(result.features, catalog), before);
  assert.deepEqual(result.features, original);
});
