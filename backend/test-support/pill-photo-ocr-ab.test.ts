import assert from "node:assert/strict";
import test from "node:test";
import { parseOfficialPillPage } from "../src/official-pill-catalog.ts";
import { pillPhotoOcrRequest, pillPhotoRequest, type PreparedPillPhotoRequests } from "../src/pill-photo-experiment.ts";
import { pillPhotoFeaturesSchema } from "../src/pill-photo-features.ts";
import { fusePillPhotoSignals, PILL_PHOTO_OCR_SCHEMA_VERSION, PILL_PHOTO_OCR_SIDE_SCHEMA_VERSION,
  PILL_PHOTO_OCR_PROMPT_VERSION, PILL_PHOTO_STROKE_OCR_PROMPT_VERSION, pillPhotoOcrInstructions,
  type PillPhotoOcrFeatures, type PillPhotoOcrPromptVersion } from "../src/pill-photo-ocr.ts";
import { observedSide, pillEnvelope, pillObservation, pillRecord } from "./pill-fixtures.ts";
import type { PillPhotoDiagnosticFixture } from "./pill-photo-diagnostics.ts";
import { buildOcrAbRequestPair, executeOcrAbComparison, freezeOcrAbVision, OCR_AB_PROTOCOL,
  ocrAbSchedule, scoreOcrAbRows, type OcrRequest } from "./pill-photo-ocr-ab.ts";
import { PILL_PHOTO_SCORE_SCHEMA_VERSION, type PillPhotoScoreInput } from "./pill-photo-score.ts";
import { PILL_PHOTO_TRIAL_CASE_IDS as IDS, PILL_PHOTO_TRIAL_PROTOCOL as BASE, trialSha256 } from "./pill-photo-trial.ts";

// Synthetic bytes only verify canonical request contracts. They are not photos and never leave this process.
const rotations = (name: string): [Buffer, Buffer, Buffer, Buffer] => [0, 90, 180, 270].map(angle =>
  Buffer.from(`synthetic-${name}-${angle}`)) as [Buffer, Buffer, Buffer, Buffer];
function prepared(caseId: string): PreparedPillPhotoRequests {
  const first = { context: Buffer.from("synthetic context a"), alignedColor: Buffer.from("synthetic detail a") };
  const second = { context: Buffer.from("synthetic context b"), alignedColor: Buffer.from("synthetic detail b") };
  return { ok: true, sourceSha256: [`${caseId}-side-a.jpg`, `${caseId}-side-b.jpg`].map(trialSha256), preprocessing: [], requests: {
    vision: pillPhotoRequest(first, second, BASE.model),
    ocrFront: pillPhotoOcrRequest(rotations(`${caseId}-front-color`), rotations(`${caseId}-front-contrast`), BASE.ocrModel),
    ocrBack: pillPhotoOcrRequest(rotations(`${caseId}-back-color`), rotations(`${caseId}-back-contrast`), BASE.ocrModel),
  } };
}
const ocrSide = (text: string): PillPhotoOcrFeatures["front"] => ({ imprintCandidates: [text],
  noImprintObserved: false, imprintVisibility: "clear" });
function envelope(side: PillPhotoOcrFeatures["front"]) {
  return { status: "completed", usage: { input_tokens: 10, output_tokens: 5 }, output: [{ type: "message",
    role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({
      schemaVersion: PILL_PHOTO_OCR_SIDE_SCHEMA_VERSION, side,
    }) }] }] };
}
function scenario() {
  const catalog = { ...parseOfficialPillPage(pillEnvelope(IDS.map((id, index) => pillRecord({
    ITEM_SEQ: String(209900001 + index), ITEM_NAME: `가상 테스트 ${id}`,
    PRINT_FRONT: `FRONT${String.fromCharCode(65 + index)}`, PRINT_BACK: `BACK${String.fromCharCode(65 + index)}`,
  }))), "json", "2026-01-01T00:00:00.000Z"), completeness: "complete" as const, version: "synthetic-ocr-ab-v1" };
  const fixture: PillPhotoDiagnosticFixture = { fixtureVersion: BASE.fixtureVersion,
    scope: { split: "validation", claim: "synthetic_test_only" }, products: [], images: [], cases: [] };
  const cases = catalog.items.map((item, index) => {
    const id = IDS[index]!, photos = [`${id}-side-a.jpg`, `${id}-side-b.jpg`];
    fixture.products.push({ id, expectedItemSeq: item.itemSeq, expectedObservation: {
      form: "tablet", formName: item.formName!, shape: item.shape!, colors: item.colors,
      front: { ...item.front }, back: { ...item.back },
    } });
    fixture.cases.push({ id, split: "validation", expectedItemSeq: item.itemSeq, photos });
    photos.forEach((path, side) => fixture.images.push({ path, sha256: trialSha256(path), officialSide: side ? "back" : "front" }));
    const { source, ...observation } = pillObservation({ front: observedSide(item.front.imprint, "single"), back: observedSide(item.back.imprint, "cross") });
    assert.equal(source, "manual");
    const vision = pillPhotoFeaturesSchema.parse({ observation, pairConsistency: "consistent", bothSidesVisible: true, imageArtifact: "none" });
    const ocr: PillPhotoOcrFeatures = { schemaVersion: PILL_PHOTO_OCR_SCHEMA_VERSION,
      front: ocrSide(item.front.imprint!), back: ocrSide(item.back.imprint!) };
    const fused = fusePillPhotoSignals(vision, ocr);
    return { id, extraction: { ok: true as const, features: fused.features, usage: null,
      signals: { vision: { features: vision, usage: null }, ocr: { features: ocr, usage: null }, fusion: fused.evidence } } };
  });
  const pipeline: PillPhotoScoreInput["pipeline"] = { mode: "vision_ocr", preprocessingVersion: BASE.preprocessing,
    visionVersion: BASE.visionPrompt, model: BASE.model, ocrModel: BASE.ocrModel, ocrVersion: BASE.ocrPrompt, fusionVersion: BASE.fusion };
  const runs = [1, 2, 3].map(repetition => ({ id: `synthetic/repeat-${repetition}`, saved: {
    preflight: { status: "ready", fixtureVersion: fixture.fixtureVersion, split: "validation", cases: IDS, maximumRequests: 18,
      pipeline: { review: "synthetic", preprocessing: BASE.preprocessing, phonePreprocessing: BASE.preprocessing,
        prompt: BASE.visionPrompt, ocrPrompt: BASE.ocrPrompt, fusion: BASE.fusion, maskPolicy: "synthetic" },
      model: BASE.model, ocrModel: BASE.ocrModel },
    features: { schemaVersion: PILL_PHOTO_SCORE_SCHEMA_VERSION, fixtureVersion: fixture.fixtureVersion,
      split: "validation", createdAt: `2026-09-0${repetition}T00:00:00.000Z`, requests: 18, pipeline,
      cases: cases.map(row => ({ id: row.id, extraction: { status: "ok", features: row.extraction.features, usage: null } })),
    } satisfies PillPhotoScoreInput, cases: structuredClone(cases),
  } }));
  const requests = IDS.map(caseId => ({ caseId, sourceSha256: prepared(caseId).sourceSha256,
    requests: buildOcrAbRequestPair(prepared(caseId)) }));
  // The provider mock reads only the synthetic bytes. No fixture, catalog or expected label is passed to execution.
  const mockProvider = async (request: OcrRequest) => {
    const image = request.input[0]!.content.find(part => "image_url" in part)!;
    assert.ok("image_url" in image);
    const marker = Buffer.from(image.image_url.split(",")[1]!, "base64").toString();
    const match = /^synthetic-v4-v0([1-6])-(front|back)-/.exec(marker)!;
    assert.ok(match);
    return { ok: true as const, value: envelope(ocrSide(`${match[2]!.toUpperCase()}${String.fromCharCode(64 + Number(match[1]))}`)) };
  };
  return { catalog, fixture, runs, requests, mockProvider };
}
function bindings(data: ReturnType<typeof scenario>) {
  return data.requests.map(row => ({ caseId: row.caseId, sourceSha256: row.sourceSha256,
    legacyBodySha256: { front: trialSha256(JSON.stringify(row.requests.legacy.front)),
      back: trialSha256(JSON.stringify(row.requests.legacy.back)) } }));
}
const freeze = (data: ReturnType<typeof scenario>) => freezeOcrAbVision(data.runs, data.fixture, data.catalog, bindings(data));

test("OCR A/B는 6사례·3회·두 조건 36개 작업을 짝지어 고정하고 성공 시 최대 72면 요청이다", () => {
  const schedule = ocrAbSchedule();
  assert.equal(schedule.length, 36); assert.equal(OCR_AB_PROTOCOL.maximumOcrRequests, 72);
  assert.equal(OCR_AB_PROTOCOL.visionRequests, 0); assert.equal(OCR_AB_PROTOCOL.retries, 0);
  assert.equal(new Set(schedule.map(row => `${row.repetition}/${row.caseId}/${row.condition}`)).size, 36);
  for (let index = 0; index < schedule.length; index += 2) {
    assert.equal(schedule[index]!.caseId, schedule[index + 1]!.caseId);
    assert.equal(schedule[index]!.repetition, schedule[index + 1]!.repetition);
    assert.notEqual(schedule[index]!.condition, schedule[index + 1]!.condition);
  }
  assert.deepEqual(schedule.slice(0, 4).map(row => row.condition), ["legacy", "stroke_check", "stroke_check", "legacy"]);
  assert.deepEqual(schedule.slice(12, 14).map(row => row.condition), ["stroke_check", "legacy"]);
});

test("canonical OCR 요청은 instructions만 다르고 모델·8개 이미지·생성 파라미터·스키마와 원본을 보존한다", () => {
  const original = prepared("v4-v01"), before = structuredClone(original);
  const pair = buildOcrAbRequestPair(original);
  for (const side of ["front", "back"] as const) {
    assert.deepEqual({ ...pair.stroke_check[side], instructions: pair.legacy[side].instructions }, pair.legacy[side]);
    assert.equal(pair.legacy[side].instructions, pillPhotoOcrInstructions(PILL_PHOTO_OCR_PROMPT_VERSION));
    assert.equal(pair.stroke_check[side].instructions, pillPhotoOcrInstructions(PILL_PHOTO_STROKE_OCR_PROMPT_VERSION));
    assert.equal(pair.legacy[side].input[0]!.content.filter(part => "image_url" in part).length, 8);
    assert.ok(!/expectedItemSeq|expectedObservation|historicalOcr|imprintCandidates"\s*:\s*\[/.test(JSON.stringify(pair.legacy[side])));
  }
  pair.stroke_check.front.input[0]!.content.pop();
  assert.equal(pair.legacy.front.input[0]!.content.length, 10);
  assert.deepEqual(original, before);
});

test("알 수 없는 OCR profile·추가 text/정답/설정·변경 이미지 계약은 전송 전에 거절한다", () => {
  assert.throws(() => pillPhotoOcrRequest(rotations("a"), rotations("b"), BASE.ocrModel,
    "invented-profile" as PillPhotoOcrPromptVersion), /unknown_ocr_prompt/);
  const edits: ((value: PreparedPillPhotoRequests) => void)[] = [
    value => { Object.assign(value.requests.ocrFront, { expectedItemSeq: "209900001" }); },
    value => { value.requests.ocrFront.model = "different-model"; },
    value => { value.requests.ocrFront.input[0]!.content.push({ type: "input_text", text: "hidden label" }); },
    value => { value.requests.ocrFront.input[0]!.content.pop(); },
    value => { value.requests.ocrFront.instructions = "unknown profile"; },
    value => { const image = value.requests.ocrFront.input[0]!.content.find(part => "image_url" in part)!;
      assert.ok("image_url" in image); image.image_url = "https://example.invalid/private-image.png"; },
  ];
  for (const edit of edits) { const value = prepared("v4-v01"); edit(value); assert.throws(() => buildOcrAbRequestPair(value), /ocr_ab_/); }
});

test("저장된 Vision은 같은 세 실행에서 고정하고 누락 회차·사례·holdout·신호 불일치를 거절한다", () => {
  const data = scenario(), before = structuredClone(data.runs);
  const frozen = freeze(data);
  assert.equal(frozen.length, 18);
  frozen.forEach(row => assert.equal(row.visionSha256, trialSha256(JSON.stringify(row.vision))));
  assert.deepEqual(data.runs, before);
  assert.throws(() => freezeOcrAbVision(data.runs.slice(0, 2), data.fixture, data.catalog, bindings(data)), /three_distinct_runs/);
  assert.throws(() => freezeOcrAbVision([data.runs[0]!, data.runs[0]!, data.runs[2]!], data.fixture, data.catalog, bindings(data)), /three_distinct_runs/);
  assert.throws(() => freezeOcrAbVision([...data.runs].reverse(), data.fixture, data.catalog, bindings(data)), /source_order_invalid/);
  const missing = scenario(); missing.runs[0]!.saved.cases.pop();
  assert.throws(() => freeze(missing), /case_mismatch/);
  const holdout = scenario(); holdout.fixture.scope.split = "holdout";
  assert.throws(() => freeze(holdout), /validation_fixture/);
  const changed = scenario(); changed.runs[0]!.saved.cases[0]!.extraction.signals.fusion.front.truncated = true;
  assert.throws(() => freeze(changed), /fusion_mismatch/);
  const wrongBindings = bindings(data); wrongBindings[0]!.sourceSha256.reverse();
  assert.throws(() => freezeOcrAbVision(data.runs, data.fixture, data.catalog, wrongBindings), /binding_source_invalid/);
  assert.throws(() => freezeOcrAbVision(data.runs, data.fixture, data.catalog, bindings(data).slice(1)), /binding_coverage_invalid/);
});

test("mock 실행은 body 하나만 받고 Vision·정답을 받지 않으며 72회 성공에서 기존 fusion을 그대로 재사용한다", async t => {
  const network = t.mock.method(globalThis, "fetch", () => { throw new Error("network_forbidden"); });
  const data = scenario(), frozen = freeze(data);
  const before = structuredClone({ frozen, requests: data.requests });
  let calls = 0;
  const rows = await executeOcrAbComparison(frozen, data.requests, async (...args) => {
    assert.equal(args.length, 1); const [body] = args;
    assert.deepEqual(Object.keys(body).sort(), ["input", "instructions", "max_output_tokens", "model", "reasoning", "store", "text"].sort());
    assert.ok(!("vision" in body) && !("expectedItemSeq" in body) && !("caseId" in body));
    const result = await data.mockProvider(body);
    body.instructions = "executor mutation must not affect later requests";
    calls++; return result;
  });
  assert.equal(calls, 72); assert.equal(network.mock.callCount(), 0); assert.equal(rows.length, 36);
  for (const row of rows) {
    const source = frozen.find(value => value.repetition === row.repetition && value.caseId === row.caseId)!;
    assert.equal(row.visionSha256, source.visionSha256); assert.equal(row.sourceRun, source.sourceRun);
    assert.equal(row.ocr.ok, true); if (!row.ocr.ok) throw new Error("synthetic_setup");
    const fused = fusePillPhotoSignals(source.vision, row.ocr.features);
    assert.deepEqual(row.fused, fused.features); assert.deepEqual(row.fusion, fused.evidence);
    assert.deepEqual(row.ocr.usage, { inputTokens: 20, outputTokens: 10 });
    assert.deepEqual(row.attempts.map(attempt => attempt.side), ["front", "back"]);
    assert.ok(row.attempts.every(attempt => attempt.elapsedMs >= 0 && attempt.outcome === "ok" && /^[a-f0-9]{64}$/.test(attempt.bodySha256)));
    const paired = rows.find(value => value.repetition === row.repetition && value.caseId === row.caseId && value.condition !== row.condition)!;
    assert.equal(row.visionSha256, paired.visionSha256);
  }
  assert.deepEqual({ frozen, requests: data.requests }, before);
});

test("세 회차의 6·5·1 집계는 18·15·3 관측과 고유 제품 수를 구분하며 운영 합격으로 승격하지 않는다", async () => {
  const data = scenario(), frozen = freeze(data);
  const rows = await executeOcrAbComparison(frozen, data.requests, data.mockProvider);
  const summary = scoreOcrAbRows(rows, data.fixture, data.catalog);
  for (const condition of summary) {
    assert.equal(condition.officialPassDecision, false); assert.equal(condition.productionReadinessClaim, false);
    assert.deepEqual(condition.groups.map(group => group.independentProducts), [6, 5, 1]);
    assert.deepEqual(condition.groups.map(group => group.repeatedObservations), [18, 15, 3]);
    assert.ok(condition.groups.every(group => !group.officialScoreOrGate && group.recall.every(metric => metric.rate === 1)));
    for (const repetition of condition.repetitions) {
      assert.equal(repetition.metrics.totalCases, 6); assert.equal(repetition.metrics.evaluatedCases, 6);
      assert.equal(repetition.metrics.strongWrongCandidateCount, 0); assert.equal(repetition.metrics.retakeCandidateExposureCaseCount, 0);
      assert.deepEqual(repetition.gates.minimumSampleSize, { passed: true, required: 6, observed: 6 });
    }
  }
  const holdout = structuredClone(data.fixture); holdout.scope.split = "holdout";
  assert.throws(() => scoreOcrAbRows(rows, holdout, data.catalog), /validation_fixture/);
  const shortened = structuredClone(data.fixture); shortened.cases.pop();
  assert.throws(() => scoreOcrAbRows(rows, shortened, data.catalog), /validation_fixture/);
  assert.throws(() => scoreOcrAbRows(rows.slice(1), data.fixture, data.catalog), /result_coverage/);
});

test("추출 실패를 18개 분모에서 빼거나 저장 OCR로 대체하지 않고 재시도 없이 사유를 보존한다", async () => {
  const data = scenario(), frozen = freeze(data);
  let calls = 0;
  const rows = await executeOcrAbComparison(frozen, data.requests, async () => { calls++; return { ok: false, reason: "invalid_request" }; });
  assert.equal(calls, 36); assert.equal(rows.length, 36);
  assert.ok(rows.every(row => !row.ocr.ok && row.ocr.reason === "invalid_request" && row.fused === null
    && row.fusion === null && row.attempts.length === 1));
  for (const condition of scoreOcrAbRows(rows, data.fixture, data.catalog)) {
    assert.equal(condition.groups[0]!.repeatedObservations, 18);
    assert.equal(condition.groups[0]!.executedObservations, 0);
    assert.ok(condition.groups[0]!.recall.every(metric => metric.plannedDenominator === 18 && metric.rate === null));
    condition.repetitions.forEach(repetition => {
      assert.equal(repetition.metrics.totalCases, 6); assert.equal(repetition.metrics.evaluatedCases, 0);
      assert.equal(repetition.gates.allCasesEvaluated.passed, false); assert.equal(repetition.gates.recallAt5.passed, false);
      assert.equal(repetition.metrics.recallAt["5"]!.total, 6); assert.equal(repetition.metrics.recallAt["5"]!.rate, 0);
    });
  }
});

test("provider 예외·형식 오류·뒷면 실패는 정상 사례로 바뀌지 않고 후속 예정 사례를 남긴다", async () => {
  const data = scenario(), frozen = freeze(data);
  let calls = 0;
  const rows = await executeOcrAbComparison(frozen, data.requests, async body => {
    calls++;
    if (calls === 1) throw new Error("synthetic transport exception");
    if (calls === 2) return { ok: true, value: { status: "completed", output: [] } };
    if (calls === 4) return { ok: false, reason: "rate_limited" };
    return data.mockProvider(body);
  });
  assert.equal(rows.length, 36); assert.equal(calls, 70);
  assert.deepEqual(rows.slice(0, 3).map(row => row.ocr.ok ? "unexpected_success" : row.ocr.reason),
    ["provider_unavailable", "ocr_failed", "rate_limited"]);
  assert.deepEqual(rows.slice(0, 3).map(row => row.attempts.length), [1, 1, 2]);
  assert.ok(rows.slice(0, 3).every(row => row.fused === null));
  assert.ok(rows.slice(3).every(row => row.ocr.ok));
  const summary = scoreOcrAbRows(rows, data.fixture, data.catalog);
  assert.equal(summary.reduce((sum, condition) => sum + condition.repetitions.reduce((subtotal, repetition) => subtotal + repetition.metrics.evaluatedCases, 0), 0), 33);
});

test("실행 전 누락·중복·변경 Vision hash·A/B 외 설정 변경을 거절하며 provider는 부르지 않는다", async () => {
  const data = scenario(), frozen = freeze(data);
  let calls = 0; const executor = async (body: OcrRequest) => { calls++; return data.mockProvider(body); };
  await assert.rejects(executeOcrAbComparison(frozen.slice(1), data.requests, executor), /frozen_coverage/);
  await assert.rejects(executeOcrAbComparison(frozen, data.requests.slice(1), executor), /request_coverage/);
  const repeated = structuredClone(frozen); repeated[1] = repeated[0]!;
  await assert.rejects(executeOcrAbComparison(repeated, data.requests, executor), /frozen_coverage/);
  const altered = structuredClone(frozen); altered[0]!.vision.observation.colors = ["분홍"];
  await assert.rejects(executeOcrAbComparison(altered, data.requests, executor), /frozen_vision_changed/);
  const requests = structuredClone(data.requests); requests[0]!.requests.stroke_check.front.max_output_tokens = 2000;
  await assert.rejects(executeOcrAbComparison(frozen, requests, executor), /request_pair_changed/);
  const swappedRequests = structuredClone(data.requests);
  [swappedRequests[0]!.requests, swappedRequests[1]!.requests] = [swappedRequests[1]!.requests, swappedRequests[0]!.requests];
  await assert.rejects(executeOcrAbComparison(frozen, swappedRequests, executor), /vision_request_binding_changed/);
  const swappedSources = structuredClone(data.requests);
  [swappedSources[0]!.sourceSha256, swappedSources[1]!.sourceSha256] = [swappedSources[1]!.sourceSha256, swappedSources[0]!.sourceSha256];
  await assert.rejects(executeOcrAbComparison(frozen, swappedSources, executor), /vision_request_binding_changed/);
  assert.equal(calls, 0);
});

test("고정 Vision 품질 게이트는 clear OCR로 완화하지 않고 재촬영 후보 노출 0을 유지한다", async () => {
  const data = scenario(), frozen = freeze(data);
  for (const row of frozen) {
    row.vision.observation.quality = "dark";
    row.visionSha256 = trialSha256(JSON.stringify(row.vision));
  }
  const rows = await executeOcrAbComparison(frozen, data.requests, data.mockProvider);
  assert.ok(rows.every(row => row.fused?.observation.quality === "dark"));
  for (const condition of scoreOcrAbRows(rows, data.fixture, data.catalog)) for (const repeat of condition.repetitions) {
    assert.equal(repeat.metrics.totalCases, 6); assert.equal(repeat.metrics.retakeCandidateExposureCaseCount, 0);
    assert.equal(repeat.metrics.strongWrongCandidateCount, 0); assert.equal(repeat.metrics.recallAt["5"]!.hits, 0);
    assert.ok(repeat.rows.every(row => row.needsRetake && row.candidateItemSeqs.length === 0 && row.heldCandidateItemSeqs.length === 0));
  }
});

test("정답은 검색 후 scorer에만 사용하며 강한 오답을 숨기거나 합격 처리하지 않는다", async () => {
  const data = scenario(), frozen = freeze(data);
  const rows = await executeOcrAbComparison(frozen, data.requests, data.mockProvider), before = structuredClone(rows);
  const correct = scoreOcrAbRows(rows, data.fixture, data.catalog);
  const relabeled = structuredClone(data.fixture);
  relabeled.cases.forEach((row, index) => { row.expectedItemSeq = data.fixture.cases[(index + 1) % 6]!.expectedItemSeq; });
  relabeled.products.forEach((row, index) => {
    row.expectedItemSeq = relabeled.cases[index]!.expectedItemSeq;
    row.expectedObservation = structuredClone(data.fixture.products[(index + 1) % 6]!.expectedObservation);
  });
  const wrong = scoreOcrAbRows(rows, relabeled, data.catalog);
  for (const [conditionIndex, condition] of wrong.entries()) for (const [repeatIndex, repeat] of condition.repetitions.entries()) {
    assert.equal(repeat.metrics.strongWrongCandidateCount, 6);
    assert.equal(repeat.gates.noStrongWrongCandidates.passed, false);
    assert.equal(repeat.metrics.recallAt["5"]!.hits, 0);
    const current = correct[conditionIndex]!.repetitions[repeatIndex]!;
    repeat.rows.forEach((row, index) => {
      assert.deepEqual(row.candidateItemSeqs, current.rows[index]!.candidateItemSeqs);
      assert.deepEqual(row.heldCandidateItemSeqs, current.rows[index]!.heldCandidateItemSeqs);
      assert.deepEqual(row.strongCandidateItemSeqs, current.rows[index]!.strongCandidateItemSeqs);
    });
  }
  assert.deepEqual(rows, before);
});
