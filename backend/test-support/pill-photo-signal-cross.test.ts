import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOfficialPillPage } from "../src/official-pill-catalog.ts";
import { pillPhotoFeaturesSchema, type PillPhotoFeatures } from "../src/pill-photo-features.ts";
import { fusePillPhotoSignals, PILL_PHOTO_OCR_SCHEMA_VERSION, PILL_PHOTO_FUSION_VERSION, type PillPhotoOcrFeatures } from "../src/pill-photo-ocr.ts";
import { PILL_PHOTO_PHONE_VALIDATION_VERSION } from "./pill-photo-phone-validation.ts";
import { type PillPhotoDiagnosticFixture } from "./pill-photo-diagnostics.ts";
import { PILL_PHOTO_SCORE_SCHEMA_VERSION, type PillPhotoScoreInput } from "./pill-photo-score.ts";
import { observedSide, pillEnvelope, pillObservation, pillRecord } from "./pill-fixtures.ts";
import { crossReplayPillPhotoSignals, PILL_SIGNAL_CELLS } from "./pill-photo-signal-cross.ts";
import { assertPillSignalCrossBinding, renderPillSignalCross, runPillPhotoSignalCross } from "../scripts/pill-photo-signal-cross.ts";

function scenario() {
  const page = parseOfficialPillPage(pillEnvelope(Array.from({ length: 6 }, (_, i) => pillRecord({
    ITEM_SEQ: String(209900001 + i), PRINT_FRONT: `TEST${i}`, PRINT_BACK: `CODE${i}`,
  }))), "json", "2026-09-01T00:00:00.000Z");
  const catalog = { ...page, completeness: "complete" as const, version: "synthetic-cross-v1" };
  const fixture: PillPhotoDiagnosticFixture = { fixtureVersion: PILL_PHOTO_PHONE_VALIDATION_VERSION,
    scope: { split: "validation", claim: "synthetic" }, products: [], images: [], cases: [] };
  const raw = catalog.items.map((item, i) => {
    const id = `v4-v0${i + 1}`, photos = [`${id}-a.jpg`, `${id}-b.jpg`];
    fixture.cases.push({ id, expectedItemSeq: item.itemSeq, split: "validation", photos });
    fixture.products.push({ id, expectedItemSeq: item.itemSeq, expectedObservation: {
      form: "tablet", formName: item.formName!, shape: item.shape!, colors: item.colors,
      front: item.front, back: item.back,
    } });
    photos.forEach((path, side) => fixture.images.push({ path, officialSide: side ? "back" : "front", sha256: String(i * 2 + side + 1).padStart(64, "0") }));
    const { source, ...observation } = pillObservation({ front: observedSide(item.front.imprint, "single"), back: observedSide(item.back.imprint, "cross") });
    assert.equal(source, "manual");
    const vision = pillPhotoFeaturesSchema.parse({ observation, pairConsistency: "consistent", bothSidesVisible: true, imageArtifact: "none" });
    const side = (value: string) => ({ imprintCandidates: [value], noImprintObserved: false, imprintVisibility: "clear" as const });
    const ocr: PillPhotoOcrFeatures = { schemaVersion: PILL_PHOTO_OCR_SCHEMA_VERSION, front: side(item.front.imprint!), back: side(item.back.imprint!) };
    const fused = fusePillPhotoSignals(vision, ocr);
    return { id, extraction: { ok: true as const, features: fused.features, usage: null,
      signals: { vision: { features: vision, usage: null }, ocr: { features: ocr, usage: null }, fusion: fused.evidence } } };
  });
  const make = (repeat: number, candidate: boolean) => {
    const prompt = candidate ? "synthetic-vision-v1" : "synthetic-vision-v0";
    const cases = structuredClone(raw);
    const features: PillPhotoScoreInput = { schemaVersion: PILL_PHOTO_SCORE_SCHEMA_VERSION,
      fixtureVersion: fixture.fixtureVersion, split: "validation", requests: 18, createdAt: `2026-09-02T0${repeat}:00:00.000Z`,
      pipeline: { mode: "vision_ocr", preprocessingVersion: "centered-v1", visionVersion: prompt, model: "synthetic", ocrModel: "synthetic",
        ocrVersion: "synthetic-ocr", fusionVersion: PILL_PHOTO_FUSION_VERSION },
      cases: cases.map(row => ({ id: row.id, extraction: { status: "ok", features: row.extraction.features, usage: null } })),
    };
    return { preflight: { status: "ready", fixtureVersion: fixture.fixtureVersion, split: "validation", cases: cases.map(row => row.id), maximumRequests: 18,
      pipeline: { review: "synthetic", preprocessing: "centered-v1", phonePreprocessing: "centered-v1", prompt,
        ocrPrompt: "synthetic-ocr", fusion: PILL_PHOTO_FUSION_VERSION, maskPolicy: "synthetic" }, model: "synthetic", ocrModel: "synthetic" }, features, cases };
  };
  return { fixture, catalog, pairs: [1, 2, 3].map(repeat => ({ baseline: make(repeat, false), candidate: make(repeat, true) })) };
}
function change(data: ReturnType<typeof scenario>, source: "baseline" | "candidate", index: number,
  modify: (vision: PillPhotoFeatures, ocr: PillPhotoOcrFeatures) => void) {
  for (const pair of data.pairs) {
    const run = pair[source], row = run.cases[index]!;
    modify(row.extraction.signals.vision.features, row.extraction.signals.ocr.features);
    const fused = fusePillPhotoSignals(row.extraction.signals.vision.features, row.extraction.signals.ocr.features);
    row.extraction.features = fused.features; row.extraction.signals.fusion = fused.evidence;
    run.features.cases[index] = { id: row.id, extraction: { status: "ok", features: fused.features, usage: null } };
  }
}
const replay = (data: ReturnType<typeof scenario>) => crossReplayPillPhotoSignals(data.pairs, data.fixture, data.catalog);

test("동일 신호의 4조합·3회·6사례를 모두 재생하고 대각선과 무변경·외부요청0을 검증한다", t => {
  t.mock.method(globalThis, "fetch", () => { throw Error("network_forbidden"); });
  const data = scenario(), before = JSON.stringify(data), result = replay(data);
  assert.equal(result.externalRequests, 0); assert.equal(result.newInference, false);
  assert.equal(result.independentProducts, 6); assert.equal(result.syntheticCrossCells, 36);
  assert.equal(result.replayedOriginalCells, 36); assert.equal(result.diagonalsVerified, true);
  assert.deepEqual(result.aggregate.map(cell => cell.id), PILL_SIGNAL_CELLS);
  for (const effect of result.effects) assert.ok(effect.recallHitDelta.every(delta => delta.total === 0));
  assert.deepEqual(result, replay(data)); assert.equal(JSON.stringify(data), before);
});

test("Vision 교체는 품질·짝 불일치 게이트 전체를 보존하고 다른 OCR이 차단을 해제하지 못한다", () => {
  const data = scenario();
  change(data, "candidate", 0, (vision, ocr) => { vision.pairConsistency = "inconsistent"; ocr.front.imprintCandidates = ["DIFFERENT"]; });
  const report = replay(data);
  for (const repeat of report.repetitions) for (const cell of repeat.cells) {
    const usesCandidateVision = cell.id === "V1O0" || cell.id === "V1O1";
    const row = cell.rows[0]!, signal = cell.observations[0]!;
    assert.equal(signal.features.pairConsistency, usesCandidateVision ? "inconsistent" : "consistent");
    if (usesCandidateVision) {
      assert.equal(row.comparisonStatus, "needs_retake"); assert.deepEqual(row.candidateItemSeqs, []); assert.deepEqual(row.heldCandidateItemSeqs, []);
    }
    assert.equal(signal.visionSource, usesCandidateVision ? 1 : 0);
    assert.equal(signal.ocrSource, cell.id.endsWith("O1") ? 1 : 0);
  }
  assert.ok(report.effects.find(e => e.id === "vision_with_O0")!.recallHitDelta.every(d => d.total === -3));
});

test("OCR 교체는 올바른 원신호 해시에 연결되고 고정 Vision에서만 조건부 변화를 계산한다", () => {
  const data = scenario();
  change(data, "baseline", 0, vision => { vision.observation.front = observedSide("", "single"); vision.observation.back = observedSide("", "cross"); });
  change(data, "candidate", 0, (vision, ocr) => {
    vision.observation.front = observedSide("", "single"); vision.observation.back = observedSide("", "cross");
    ocr.front.imprintCandidates = ["ZZQWXX"]; ocr.back.imprintCandidates = ["QQTTZZ"];
  });
  const result = replay(data);
  for (const repeat of result.repetitions) {
    const [a,b,c,d] = repeat.cells;
    assert.equal(a!.observations[0]!.visionSha256, c!.observations[0]!.visionSha256);
    assert.equal(b!.observations[0]!.ocrSha256, a!.observations[0]!.ocrSha256);
    assert.notEqual(a!.observations[0]!.ocrSha256, c!.observations[0]!.ocrSha256);
    assert.equal(c!.observations[0]!.ocrSha256, d!.observations[0]!.ocrSha256);
  }
  assert.ok(result.effects.filter(e => e.id.startsWith("vision_")).every(e => e.recallHitDelta.every(d => d.total === 0)));
  assert.ok(result.effects.find(e => e.id === "ocr_with_V0")!.recallHitDelta.some(d => d.total < 0));
});

test("1회만·holdout·다른 사례·원신호 누락이나 위조·파이프라인 변경을 거부한다", () => {
  const one = scenario(); one.pairs.pop(); assert.throws(() => replay(one), /three_repetitions_required/);
  const holdout = scenario(); holdout.pairs[0]!.candidate.preflight.split = "holdout"; assert.throws(() => replay(holdout), /validation_preflight/);
  const changed = scenario(); changed.pairs[0]!.candidate.cases[0]!.id = "v4-v02"; assert.throws(() => replay(changed), /case_mismatch/);
  const missing = scenario(); Reflect.deleteProperty(missing.pairs[0]!.candidate.cases[0]!.extraction, "signals"); assert.throws(() => replay(missing), /complete_raw_signals_required/);
  const corrupt = scenario(); corrupt.pairs[0]!.candidate.cases[0]!.extraction.signals.ocr.features.front.imprintCandidates = ["CORRUPT"];
  assert.throws(() => replay(corrupt), /fusion_mismatch/);
  const pipeline = scenario(); pipeline.pairs[0]!.candidate.features.pipeline.ocrVersion = "other";
  pipeline.pairs[0]!.candidate.preflight.pipeline.ocrPrompt = "other"; assert.throws(() => replay(pipeline), /non_vision_pipeline_changed/);
  const changedRepeat = scenario(); changedRepeat.pairs[2]!.candidate.features.pipeline.visionVersion = "other";
  changedRepeat.pairs[2]!.candidate.preflight.pipeline.prompt = "other"; assert.throws(() => replay(changedRepeat), /repeat_pipeline_changed/);
  const noRequests = scenario(); noRequests.pairs[0]!.baseline.features.requests = 0;
  assert.throws(() => replay(noRequests), /complete_recorded_requests_required/);
  const duplicate = scenario(); duplicate.pairs[1]!.candidate = structuredClone(duplicate.pairs[0]!.candidate);
  assert.throws(() => replay(duplicate), /repeat_order_or_duplicate_source/);
});

test("실험과 현재 코드·카탈로그·사진 순서·자료 지문 바인딩이 달라지면 거부한다", () => {
  const binding = { code: [{ path: "fixed.ts", sha256: "fixed" }], fixtureVersion: "v4", fixtureContentSha256: "fixture",
    catalogVersion: "fixed", catalogSha256: "catalog", cases: [{ id: "v4-v01", sourceSha256: ["front", "back"] }] };
  assert.doesNotThrow(() => assertPillSignalCrossBinding(binding, structuredClone(binding)));
  for (const field of ["fixtureContentSha256", "catalogVersion", "catalogSha256"] as const) {
    assert.throws(() => assertPillSignalCrossBinding(binding, { ...binding, [field]: "other" }), /source_or_code_changed/);
  }
  const swapped = structuredClone(binding); swapped.cases[0]!.sourceSha256.reverse();
  assert.throws(() => assertPillSignalCrossBinding(binding, swapped), /source_or_code_changed/);
  const code = structuredClone(binding); code.code[0]!.sha256 = "other";
  assert.throws(() => assertPillSignalCrossBinding(binding, code), /source_or_code_changed/);
});

test("교차 보고서 HTML은 원문 마크업을 실행하지 않고 합성 재생 한계를 표시한다", () => {
  const report = replay(scenario()); report.repetitions[0]!.cells[0]!.rows[0]!.id = '</pre><script>alert("x")</script>';
  const html = renderPillSignalCross(report);
  assert.match(html, /V0O0/); assert.match(html, /새 사진 추론 아님/); assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script\b|<img\b|<iframe\b/i);
});

test("CLI는 허용되지 않은 옵션·불완전 입력을 비공개 자료 로딩 전에 거부하며 원본을 보존한다", async t => {
  t.mock.method(globalThis, "fetch", () => { throw Error("network_forbidden"); });
  await assert.rejects(runPillPhotoSignalCross(["--live"]), /invalid_arguments/);
  const root = await mkdtemp(join(tmpdir(), "pill-cross-reject-"));
  const paths = [join(root, "baseline"), join(root, "candidate")];
  const files: string[] = [];
  t.after(async () => { for (const file of files) await unlink(file); for (const path of paths) await rmdir(path); await rmdir(root); });
  for (const path of paths) { await mkdir(path); for (const name of ["condition.json", "summary.json"]) {
    const file = join(path, name); await writeFile(file, "{}", { flag: "wx" }); files.push(file);
  } }
  await assert.rejects(runPillPhotoSignalCross(["--baseline", paths[0]!, "--candidate", paths[1]!]), /trial_comparison_invalid_condition/);
  for (const file of files) assert.equal(await readFile(file, "utf8"), "{}");
});
