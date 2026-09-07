import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseOfficialPillPage } from "../src/official-pill-catalog.ts";
import { type PillCatalog } from "../src/pill-identification.ts";
import { type PillPhotoFeatures } from "../src/pill-photo-features.ts";
import { fusePillPhotoSignals, PILL_PHOTO_FUSION_VERSION, PILL_PHOTO_OCR_SCHEMA_VERSION,
  type PillPhotoOcrFeatures } from "../src/pill-photo-ocr.ts";
import { parsePillPhotoDiagnosticArgs, readPillPhotoDiagnosticRuns } from "../scripts/pill-photo-diagnose.ts";
import { comparePillPhotoDiagnostics, diagnosePillPhotoValidation, parsePillPhotoDiagnosticPreflight,
  renderPillPhotoDiagnostics, type PillPhotoDiagnosticFixture } from "./pill-photo-diagnostics.ts";
import { PILL_PHOTO_PHONE_VALIDATION_VERSION } from "./pill-photo-phone-validation.ts";
import { PILL_PHOTO_SCORE_SCHEMA_VERSION, type PillPhotoScoreInput } from "./pill-photo-score.ts";
import { observedSide, pillEnvelope, pillObservation, pillRecord } from "./pill-fixtures.ts";

const USAGE = { inputTokens: 10, outputTokens: 5 };
function savedCase(id: string, vision: PillPhotoFeatures, ocr: PillPhotoOcrFeatures) {
  const fused = fusePillPhotoSignals(vision, ocr);
  return { id, extraction: { ok: true as const, features: fused.features, usage: USAGE,
    signals: { vision: { features: vision, usage: USAGE }, ocr: { features: ocr, usage: USAGE }, fusion: fused.evidence } } };
}
function scenario() {
  const official = Array.from({ length: 6 }, (_, index) => pillRecord({
    ITEM_SEQ: String(209900001 + index), PRINT_FRONT: `TEST${index}`, PRINT_BACK: `CODE${index}`,
  }));
  const catalog: PillCatalog = { ...parseOfficialPillPage(pillEnvelope(official), "json", "2026-09-01T00:00:00.000Z"),
    completeness: "complete", version: "synthetic-diagnostics-v1" };
  const fixture: PillPhotoDiagnosticFixture = {
    fixtureVersion: PILL_PHOTO_PHONE_VALIDATION_VERSION, scope: { split: "validation", claim: "synthetic only" },
    products: [], images: [], cases: [],
  };
  const cases = catalog.items.map((item, index) => {
    const id = `v4-v0${index + 1}`;
    const photos = [`${id}-side-a.jpg`, `${id}-side-b.jpg`];
    fixture.products.push({ id, expectedItemSeq: item.itemSeq, expectedObservation: {
      form: "tablet", formName: item.formName!, shape: item.shape!, colors: item.colors,
      front: { rawImprint: item.front.rawImprint, imprint: item.front.imprint, scoreLine: item.front.scoreLine, mark: item.front.mark },
      back: { rawImprint: item.back.rawImprint, imprint: item.back.imprint, scoreLine: item.back.scoreLine, mark: item.back.mark },
    } });
    fixture.cases.push({ id, split: "validation", expectedItemSeq: item.itemSeq, photos });
    photos.forEach((path, sideIndex) => fixture.images.push({ path, officialSide: sideIndex ? "back" : "front",
      sha256: String(index * 2 + sideIndex + 1).padStart(64, "0") }));
    const { source, ...observation } = pillObservation({
      front: observedSide(item.front.imprint, "single"), back: observedSide(item.back.imprint, "cross"),
    });
    assert.equal(source, "manual"); // The model feature contract deliberately has no source field.
    const vision = { observation, pairConsistency: "consistent", bothSidesVisible: true, imageArtifact: "none" } as PillPhotoFeatures;
    const side = (imprint: string): PillPhotoOcrFeatures["front"] => ({ imprintCandidates: [imprint],
      noImprintObserved: false, imprintVisibility: "clear" });
    return savedCase(id, vision, { schemaVersion: PILL_PHOTO_OCR_SCHEMA_VERSION,
      front: side(item.front.imprint!), back: side(item.back.imprint!) });
  });
  const preflight = { status: "ready", fixtureVersion: fixture.fixtureVersion, split: "validation",
    cases: fixture.cases.map((row) => row.id), maximumRequests: 18,
    pipeline: { review: "synthetic", preprocessing: "centered-v1", phonePreprocessing: "centered-v1",
      prompt: "synthetic-vision-v1", ocrPrompt: "synthetic-ocr-v1", fusion: PILL_PHOTO_FUSION_VERSION, maskPolicy: "synthetic" },
    model: "synthetic-vision", ocrModel: "synthetic-ocr" };
  const features: PillPhotoScoreInput = { schemaVersion: PILL_PHOTO_SCORE_SCHEMA_VERSION,
    fixtureVersion: fixture.fixtureVersion, split: "validation", createdAt: "2026-09-02T00:00:00.000Z", requests: 18,
    pipeline: { mode: "vision_ocr", preprocessingVersion: "centered-v1", visionVersion: "synthetic-vision-v1",
      model: preflight.model, ocrModel: preflight.ocrModel, ocrVersion: "synthetic-ocr-v1", fusionVersion: PILL_PHOTO_FUSION_VERSION },
    cases: cases.map((row) => ({ id: row.id, extraction: { status: "ok", features: row.extraction.features, usage: USAGE } })),
  };
  return { fixture, catalog, saved: { preflight, features, cases } };
}
function replaceCase(data: ReturnType<typeof scenario>, index: number,
  change: (vision: PillPhotoFeatures, ocr: PillPhotoOcrFeatures) => void) {
  const raw = data.saved.cases[index]!;
  change(raw.extraction.signals.vision.features, raw.extraction.signals.ocr.features);
  const next = savedCase(raw.id, raw.extraction.signals.vision.features, raw.extraction.signals.ocr.features);
  data.saved.cases[index] = next;
  data.saved.features.cases[index] = { id: raw.id, extraction: { status: "ok", features: next.extraction.features, usage: USAGE } };
}
const diagnose = (data: ReturnType<typeof scenario>) => diagnosePillPhotoValidation(data.saved, data.fixture, data.catalog);

test("오프라인 진단은 원본을 변경하거나 외부 요청하지 않고 6사례의 신호·검색 기준선을 재현한다", (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("network_forbidden"); });
  const data = scenario();
  const before = JSON.stringify(data);
  const report = diagnose(data);
  assert.equal(report.externalRequests, 0);
  assert.equal(report.score.metrics.recallAt["1"]!.hits, 6);
  assert.equal(report.rows[0]!.sides[0]!.vision!.exactTextMatch, true);
  assert.equal(report.rows[0]!.signalStatus, "verified");
  assert.equal(report.rows[0]!.preprocessing.perRotationReadings, "not_recorded");
  assert.deepEqual(report, diagnose(data));
  assert.equal(JSON.stringify(data), before);
});

test("validation 6사례·6제품·12사진과 안전한 ID, pipeline/원신호 일관성을 강제한다", () => {
  const data = scenario();
  assert.throws(() => parsePillPhotoDiagnosticPreflight({ ...data.saved.preflight, split: "holdout" }), /validation_preflight/);
  assert.throws(() => parsePillPhotoDiagnosticPreflight({ ...data.saved.preflight, cases: ["../../holdout"] }), /validation_preflight/);
  const one = scenario(); one.fixture.cases.splice(1);
  assert.throws(() => diagnose(one), /validation_fixture/);
  const duplicate = scenario(); duplicate.fixture.products[1]!.expectedItemSeq = duplicate.fixture.products[0]!.expectedItemSeq;
  assert.throws(() => diagnose(duplicate), /validation_fixture/);
  const metadata = scenario(); metadata.saved.features.pipeline.model = "different-model";
  assert.throws(() => diagnose(metadata), /run_metadata_mismatch/);
  const missing = scenario(); missing.saved.cases.pop();
  assert.throws(() => diagnose(missing), /case_mismatch/);
  const mismatch = scenario(); mismatch.saved.cases[0]!.extraction.usage = { inputTokens: 99, outputTokens: 99 };
  assert.throws(() => diagnose(mismatch), /saved_features_mismatch/);
  const fusion = scenario(); fusion.saved.cases[0]!.extraction.signals.fusion.front.truncated = true;
  assert.throws(() => diagnose(fusion), /fusion_mismatch/);
  const wrongFusion = scenario(); wrongFusion.saved.cases[0]!.extraction.signals.ocr.features.front.imprintCandidates = ["FAKE"];
  assert.throws(() => diagnose(wrongFusion), /fusion_mismatch/);
});

test("공식 각인 null은 무각인 정답으로 단정하지 않고 사진 입력 순서의 공식 면 매핑을 따른다", () => {
  const data = scenario();
  data.fixture.products[0]!.expectedObservation.front.imprint = null;
  replaceCase(data, 0, (vision, ocr) => {
    vision.observation.front = observedSide("", "single");
    ocr.front = { imprintCandidates: [], noImprintObserved: true, imprintVisibility: "clear" };
  });
  assert.equal(diagnose(data).rows[0]!.sides[0]!.fused.exactTextMatch, null);
  const swapped = scenario();
  swapped.fixture.cases[0]!.photos.reverse();
  replaceCase(swapped, 0, (vision, ocr) => {
    [vision.observation.front, vision.observation.back] = [vision.observation.back, vision.observation.front];
    [ocr.front, ocr.back] = [ocr.back, ocr.front];
  });
  const side = diagnose(swapped).rows[0]!.sides[0]!;
  assert.equal(side.image.officialSide, "back");
  assert.equal(side.fused.exactTextMatch, true);
});

test("OCR의 정확 문자 후보가 결합 상한에서 탈락하면 삭제 출처와 truncated를 보여준다", () => {
  const data = scenario();
  replaceCase(data, 0, (vision, ocr) => {
    vision.observation.front = { ...observedSide("BAD", "single"), imprintVisibility: "partial",
      imprintCandidates: ["VONE", "VTWO", "VTHREE", "VFOUR", "VFIVE"] };
    ocr.front = { imprintVisibility: "partial", noImprintObserved: false,
      imprintCandidates: ["OONE", "OTWO", "OTHREE", "OFOUR", "TEST0"] };
  });
  const side = diagnose(data).rows[0]!.sides[0]!;
  assert.equal(side.ocr!.exactTextMatch, true);
  assert.equal(side.fused.exactTextMatch, false);
  assert.equal(side.exactTextLostInFusion, true);
  assert.equal(side.fusion!.truncated, true);
});

test("안전 게이트·정답의 실제 상위20 밖 순위/탈락을 구분하고 recall은 반환 범위로 유지한다", () => {
  const blocked = scenario();
  replaceCase(blocked, 0, (vision) => { vision.pairConsistency = "inconsistent"; });
  const blockedRow = diagnose(blocked).rows[0]!;
  assert.equal(blockedRow.fused!.gateReason, "unverified_photo_pair");
  assert.equal(blockedRow.score.candidateItemSeqs.length, 0);
  const crowded = scenario();
  const base = crowded.catalog.items[0]!;
  crowded.catalog.items.push(...Array.from({ length: 22 }, (_, index) => ({ ...structuredClone(base), itemSeq: String(108800000 + index) })));
  crowded.catalog.totalCount = crowded.catalog.items.length;
  const report = diagnose(crowded);
  assert.equal(report.rows[0]!.fused!.expectedRank, null);
  assert.equal(report.rows[0]!.fused!.candidateRankBeforeLimit! > 20, true);
  assert.equal(report.rows[0]!.fused!.expectedDisposition, "eligible_outside_top20");
  assert.equal(report.rows[0]!.fused!.provenance, "current_reconstruction");
  assert.equal(report.score.metrics.recallAt["20"]!.hits, 5);
  const excluded = scenario();
  replaceCase(excluded, 0, (vision, ocr) => {
    vision.observation.front = observedSide("ZZQWXX", "single");
    vision.observation.back = observedSide("QQTTZZ", "cross");
    ocr.front.imprintCandidates = ["ZZQWXX"];
    ocr.back.imprintCandidates = ["QQTTZZ"];
  });
  assert.equal(diagnose(excluded).rows[0]!.fused!.expectedDisposition, "not_eligible_under_current_rules");
});

test("원신호 미기록·추출 실패는 명시하고 실패를 분모에서 제외하지 않는다", () => {
  const data = scenario();
  const raw = data.saved.cases[0]!;
  const saved = { ...data.saved, cases: [{ id: raw.id, extraction: { ok: true, features: raw.extraction.features, usage: USAGE } }, ...data.saved.cases.slice(1)] };
  const noSignals = diagnosePillPhotoValidation(saved, data.fixture, data.catalog);
  assert.equal(noSignals.rows[0]!.signalStatus, "raw_signals_not_recorded");
  assert.equal(noSignals.rows[0]!.sides[0]!.exactTextLostInFusion, null);
  const failed = { ...data.saved, cases: [{ id: raw.id, extraction: { ok: false, reason: "ocr_failed" } }, ...data.saved.cases.slice(1)] };
  failed.features = structuredClone(data.saved.features);
  failed.features.cases[0] = { id: raw.id, extraction: { status: "failed", reason: "ocr_failed" } };
  const report = diagnosePillPhotoValidation(failed, data.fixture, data.catalog);
  assert.equal(report.rows[0]!.signalStatus, "extraction_failed");
  assert.equal(report.score.metrics.recallAt["5"]!.total, 6);
  assert.equal(report.score.passed, false);
  assert.equal(comparePillPhotoDiagnostics(noSignals, report).sameImages, true, "실패로 원신호가 없어져도 평가 이미지 자체는 같다");
});

test("실행 차이에 전처리 변경을 명시하고 HTML은 모델 원문을 실행 가능한 마크업으로 만들지 않는다", () => {
  const data = scenario();
  replaceCase(data, 0, (vision, ocr) => {
    vision.observation.front = observedSide("<script>alert(1)</script>", "single");
    ocr.front.imprintCandidates = ["<script>alert(1)</script>"];
  });
  const before = diagnose(data);
  data.saved.preflight.pipeline.preprocessing = "centered-v2";
  data.saved.preflight.pipeline.phonePreprocessing = "centered-v2";
  data.saved.features.pipeline.preprocessingVersion = "centered-v2";
  const after = diagnose(data);
  const diff = comparePillPhotoDiagnostics(before, after);
  assert.deepEqual(diff.changedPipelineFields, ["preprocessingVersion"]);
  assert.equal(diff.interpretation, "different_conditions_not_same_condition_repeat");
  assert.equal(diff.repeatabilityClaim, false);
  assert.equal(comparePillPhotoDiagnostics(before, { ...before, searchRulesVersion: "different-search" }).sameSearchAndCatalog, false);
  const html = renderPillPhotoDiagnostics([before, after], diff);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("default-src 'none'"));
});

test("CLI는 holdout preflight를 거절한 뒤 존재하지 않는 features·private fixture에 접근하지 않는다", async () => {
  assert.throws(() => parsePillPhotoDiagnosticArgs(["--run", "a", "--run", "b"]), /invalid_arguments/);
  assert.throws(() => parsePillPhotoDiagnosticArgs(["--run", "a", "--live"]), /invalid_arguments/);
  const root = await mkdtemp(join(tmpdir(), "pill-diagnostic-test-"));
  const validation = join(root, "validation");
  const holdout = join(root, "holdout");
  await Promise.all([mkdir(validation), mkdir(holdout)]);
  const data = scenario();
  await writeFile(join(validation, "preflight.json"), JSON.stringify(data.saved.preflight));
  await writeFile(join(holdout, "preflight.json"), JSON.stringify({ ...data.saved.preflight, split: "holdout" }));
  await assert.rejects(readPillPhotoDiagnosticRuns([validation, holdout]), /diagnostic_validation_preflight_required/);
  await writeFile(join(validation, "features.json"), JSON.stringify(data.saved.features));
  await Promise.all(data.saved.cases.map((row) => writeFile(join(validation, `case-${row.id}.json`), JSON.stringify(row))));
  const read = await readPillPhotoDiagnosticRuns([validation]);
  assert.match(read[0]!.inputHashes.features, /^[a-f0-9]{64}$/);
  assert.deepEqual(read[0]!.saved, data.saved);
  await writeFile(join(validation, "features.json"), " ".repeat(512 * 1024 + 1));
  await assert.rejects(readPillPhotoDiagnosticRuns([validation]), /fixture_size_exceeded/);
});
