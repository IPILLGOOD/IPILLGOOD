// Offline, label-assisted diagnostics only. Never feed this report back into model inference.
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { pillPhotoFeaturesSchema, type PillPhotoFeatures } from "../src/pill-photo-features.ts";
import { PILL_SEARCH_RULES_VERSION, type PillCatalog } from "../src/pill-identification.ts";
import { fusePillPhotoSignals, pillPhotoOcrFeaturesSchema, PILL_PHOTO_FUSION_VERSION } from "../src/pill-photo-ocr.ts";
import { PILL_PHOTO_PHONE_VALIDATION_VERSION, type PillPhotoPhoneValidationManifest } from "./pill-photo-phone-validation.ts";
import { parsePillPhotoScoreInput, scorePillPhotoEvaluation } from "./pill-photo-score.ts";
import { diagnosePillSearch } from "./pill-photo-search-diagnostics.ts";

export const PILL_PHOTO_DIAGNOSTICS_VERSION = "pill-photo-validation-diagnostics.v2-search-trace";
const CASE_IDS = Array.from({ length: 6 }, (_, index) => `v4-v0${index + 1}`);
const version = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/).refine((value) => !/^sk-/i.test(value));
const usage = z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }).strict().nullable();
const preflightSchema = z.object({
  status: z.literal("ready"), fixtureVersion: z.literal(PILL_PHOTO_PHONE_VALIDATION_VERSION),
  split: z.literal("validation"), cases: z.array(z.string()).length(6), maximumRequests: z.literal(18),
  pipeline: z.object({ review: version, preprocessing: version, phonePreprocessing: version,
    prompt: version, ocrPrompt: version, fusion: z.literal(PILL_PHOTO_FUSION_VERSION), maskPolicy: version }).strict(),
  model: version, ocrModel: version,
}).strict();
const rawCaseSchema = z.object({
  id: z.string(), extraction: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), features: pillPhotoFeaturesSchema, usage,
      signals: z.object({
        vision: z.object({ features: pillPhotoFeaturesSchema, usage }).strict(),
        ocr: z.object({ features: pillPhotoOcrFeaturesSchema, usage }).strict(),
        // The entire evidence object must equal the deterministic recomputation below.
        fusion: z.unknown(),
      }).strict().optional(),
    }).strict(),
    z.object({ ok: z.literal(false), reason: z.string() }).strict(),
  ]),
}).strict();

export interface PillPhotoDiagnosticFixture {
  fixtureVersion: string;
  scope: { split: "validation" | "holdout"; claim: string };
  products: Pick<PillPhotoPhoneValidationManifest["products"][number],
    "id" | "expectedItemSeq" | "expectedObservation" | "appearanceHistory">[];
  images: Pick<PillPhotoPhoneValidationManifest["images"][number], "path" | "sha256" | "officialSide">[];
  cases: PillPhotoPhoneValidationManifest["cases"];
}

/** Read/check this BEFORE loading a run's features, case files or any private fixture. */
export function parsePillPhotoDiagnosticPreflight(value: unknown) {
  const parsed = preflightSchema.safeParse(value);
  if (!parsed.success || !isDeepStrictEqual(parsed.data.cases, CASE_IDS)) throw new Error("diagnostic_validation_preflight_required");
  return parsed.data;
}

function scoringFixture(fixture: PillPhotoDiagnosticFixture) {
  if (fixture.fixtureVersion !== PILL_PHOTO_PHONE_VALIDATION_VERSION || fixture.scope.split !== "validation"
    || !isDeepStrictEqual(fixture.cases.map((row) => row.id), CASE_IDS)
    || fixture.products.length !== 6 || fixture.images.length !== 12
    || new Set(fixture.products.map((row) => row.id)).size !== 6
    || new Set(fixture.products.map((row) => row.expectedItemSeq)).size !== 6
    || new Set(fixture.images.map((row) => row.path)).size !== 12
    || new Set(fixture.images.map((row) => row.sha256)).size !== 12
    || new Set(fixture.cases.flatMap((row) => row.photos)).size !== 12
    || fixture.cases.some((row) => {
      const product = fixture.products.find((product) => product.id === row.id);
      const images = row.photos.map((path) => fixture.images.find((image) => image.path === path));
      return row.split !== "validation" || row.expectedItemSeq !== product?.expectedItemSeq
        || images.length !== 2 || images.some((image) => !image) || new Set(images.map((image) => image?.officialSide)).size !== 2;
    })) throw new Error("diagnostic_validation_fixture_required");
  return { ...fixture, minimumCasesForPass: { validation: 6, holdout: 6 } };
}

const normalize = (value: string) => value.normalize("NFKC").trim().toUpperCase().replace(/\s+/gu, "");
type ImprintReading = Pick<NonNullable<PillPhotoFeatures["observation"]["front"]>,
  "imprintCandidates" | "noImprintObserved" | "imprintVisibility">;

/** Literal text comparison only: not confusion expansion, logo recognition or pill identification. */
function readingEvidence(reading: ImprintReading | null, officialImprint: string | null) {
  return {
    reading,
    exactTextMatch: officialImprint && normalize(officialImprint)
      ? (reading?.imprintCandidates.some((value) => normalize(value) === normalize(officialImprint)) ?? false) : null,
  };
}

function searchEvidence(features: PillPhotoFeatures, expectedItemSeq: string, catalog: PillCatalog) {
  return diagnosePillSearch(features, catalog, expectedItemSeq);
}

export function diagnosePillPhotoValidation(
  saved: { preflight: unknown; features: unknown; cases: unknown[] },
  fixture: PillPhotoDiagnosticFixture,
  catalog: PillCatalog,
) {
  const preflight = parsePillPhotoDiagnosticPreflight(saved.preflight);
  const manifest = scoringFixture(fixture);
  const input = parsePillPhotoScoreInput(saved.features, manifest, "validation");
  const pipeline = input.pipeline;
  if (input.requests > preflight.maximumRequests || pipeline.mode !== "vision_ocr"
    || pipeline.model !== preflight.model || pipeline.ocrModel !== preflight.ocrModel
    || pipeline.preprocessingVersion !== preflight.pipeline.preprocessing
    || preflight.pipeline.phonePreprocessing !== preflight.pipeline.preprocessing
    || pipeline.visionVersion !== preflight.pipeline.prompt || pipeline.ocrVersion !== preflight.pipeline.ocrPrompt
    || pipeline.fusionVersion !== preflight.pipeline.fusion) throw new Error("diagnostic_run_metadata_mismatch");
  if (catalog.completeness !== "complete" || catalog.items.length !== catalog.totalCount || !catalog.version
    || fixture.products.some((product) => !catalog.items.some((item) => item.itemSeq === product.expectedItemSeq))) {
    throw new Error("diagnostic_catalog_mismatch");
  }
  if (saved.cases.length !== 6) throw new Error("diagnostic_case_mismatch");
  const score = scorePillPhotoEvaluation(input, manifest, catalog, "validation");
  const rows = input.cases.map((scoredCase, index) => {
    const parsed = rawCaseSchema.safeParse(saved.cases[index]);
    if (!parsed.success || parsed.data.id !== scoredCase.id) throw new Error("diagnostic_case_mismatch");
    const raw = parsed.data.extraction;
    const scoreExtraction = raw.ok ? { status: "ok", features: raw.features, usage: raw.usage }
      : { status: "failed", reason: raw.reason };
    if (!isDeepStrictEqual(scoreExtraction, scoredCase.extraction)) throw new Error("diagnostic_saved_features_mismatch");
    const product = fixture.products.find((product) => product.id === scoredCase.id)!;
    const base = { id: scoredCase.id, score: score.rows[index]!, historicalAppearance: !!product.appearanceHistory,
      officialReference: product.expectedObservation,
      preprocessing: { version: pipeline.preprocessingVersion, historicalCropPixels: "not_recorded",
        perRotationReadings: "not_recorded", independentPixelQualityAssessment: "not_performed" } };
    if (!raw.ok) return { ...base, extractionFailure: raw.reason, signalStatus: "extraction_failed", sides: [],
      observedPhotoFeatures: null, vision: null, fused: null };
    const signals = raw.signals;
    if (signals) {
      const recomputed = fusePillPhotoSignals(signals.vision.features, signals.ocr.features);
      if (!isDeepStrictEqual(recomputed.features, raw.features) || !isDeepStrictEqual(recomputed.evidence, signals.fusion)) {
        throw new Error("diagnostic_fusion_mismatch");
      }
    }
    const sides = (["front", "back"] as const).map((inputSide, sideIndex) => {
      const path = fixture.cases[index]!.photos[sideIndex]!;
      const image = fixture.images.find((image) => image.path === path)!;
      const official = product.expectedObservation[image.officialSide];
      const vision = signals ? readingEvidence(signals.vision.features.observation[inputSide], official.imprint) : null;
      const ocr = signals ? readingEvidence(signals.ocr.features[inputSide], official.imprint) : null;
      const fused = readingEvidence(raw.features.observation[inputSide], official.imprint);
      const fusion = signals ? fusePillPhotoSignals(signals.vision.features, signals.ocr.features).evidence[inputSide] : null;
      return { inputSide, image: { path, sha256: image.sha256, officialSide: image.officialSide },
        official: { ...official, absentImprintMeaning: "missing_official_text_is_not_confirmed_blank" },
        vision, ocr, fused, fusion,
        exactTextLostInFusion: signals && fused.exactTextMatch !== null
          ? (vision!.exactTextMatch === true || ocr!.exactTextMatch === true) && !fused.exactTextMatch : null };
    });
    return { ...base, extractionFailure: null, signalStatus: signals ? "verified" : "raw_signals_not_recorded", sides,
      observedPhotoFeatures: { vision: signals?.vision.features ?? null, fused: raw.features },
      vision: signals ? searchEvidence(signals.vision.features, product.expectedItemSeq, catalog) : null,
      fused: searchEvidence(raw.features, product.expectedItemSeq, catalog) };
  });
  return {
    schemaVersion: PILL_PHOTO_DIAGNOSTICS_VERSION, mode: "saved_feature_replay_with_current_code",
    productionReadinessClaim: false, externalRequests: 0, labelAssisted: true,
    fixtureVersion: fixture.fixtureVersion, split: "validation", createdAt: input.createdAt,
    historicalRequests: input.requests, pipeline, searchRulesVersion: PILL_SEARCH_RULES_VERSION,
    catalogVersion: catalog.version,
    counts: { products: fixture.products.length, cases: rows.length, images: fixture.images.length },
    imageHashes: fixture.images.map(({ path, sha256 }) => ({ path, sha256 })),
    limits: ["Not a new inference run or independent accuracy evaluation.",
      "Literal imprint text matches exclude confusion expansion and cannot verify logos or blank surfaces.",
      "Saved labels are diagnostic references only; historical appearance differences need human review.",
      "Crop pixels, rotation-specific OCR and independent image quality were not recorded by these runs.",
      "Expected labels are used only after the full search; pre-limit ranks use its actual order, never a label-only catalog."],
    score, rows,
  };
}

export type PillPhotoDiagnosticsReport = ReturnType<typeof diagnosePillPhotoValidation>;

export function comparePillPhotoDiagnostics(before: PillPhotoDiagnosticsReport, after: PillPhotoDiagnosticsReport) {
  if (before.fixtureVersion !== after.fixtureVersion
    || !isDeepStrictEqual(before.rows.map((row) => row.id), after.rows.map((row) => row.id))) throw new Error("diagnostic_comparison_fixture_mismatch");
  const changedPipelineFields = (Object.keys(before.pipeline) as (keyof typeof before.pipeline)[])
    .filter((key) => before.pipeline[key] !== after.pipeline[key]);
  const sameImages = isDeepStrictEqual(before.imageHashes, after.imageHashes);
  const sameSearchAndCatalog = before.searchRulesVersion === after.searchRulesVersion && before.catalogVersion === after.catalogVersion;
  return {
    changedPipelineFields, sameImages, sameSearchAndCatalog,
    repeatabilityClaim: false,
    interpretation: changedPipelineFields.length || !sameImages || !sameSearchAndCatalog ? "different_conditions_not_same_condition_repeat"
      : "same_recorded_conditions_only_unrecorded_conditions_unknown",
    rows: before.rows.map((row, index) => ({ id: row.id,
      before: row.score, after: after.rows[index]!.score,
      resultChanged: !isDeepStrictEqual(row.score, after.rows[index]!.score),
      sideSignalsChanged: !isDeepStrictEqual(row.sides, after.rows[index]!.sides) })),
  };
}

const escapeHtml = (value: unknown) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]!);

export function renderPillPhotoDiagnostics(reports: PillPhotoDiagnosticsReport[], diff: unknown = null) {
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>휴대폰 validation 단계별 진단</title><style>body{font-family:system-ui;max-width:1200px;margin:2rem auto;padding:1rem;color:#213547}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.5rem;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}summary{cursor:pointer}section{margin:2rem 0}</style>
<h1>휴대폰 validation 단계별 진단</h1><p>저장된 특징의 오프라인 재생 · 외부 요청 0회 · 정확도 개선/새 추론/사용자 기능 완료 아님</p>
${reports.map((report) => `<section><h2>${escapeHtml(report.pipeline.preprocessingVersion)}</h2>
<p>${escapeHtml(report.createdAt)} / ${escapeHtml(report.searchRulesVersion)}</p>
<p>${[1, 5, 20].map((k) => `recall@${k}: ${report.score.metrics.recallAt[String(k)]!.hits}/${report.counts.cases}`).join(" · ")}</p>
<table><tr><th>사례</th><th>Vision 정답 순위</th><th>결합 후 순위</th><th>보류/탈락 사유</th><th>원신호</th></tr>
${report.rows.map((row) => `<tr><td>${escapeHtml(row.id)}</td><td>${row.vision?.expectedRank ?? "—"}</td><td>${row.score.expectedRank ?? "—"}</td><td>${escapeHtml(row.extractionFailure ?? row.fused?.gateReason ?? row.fused?.expectedDisposition ?? "not_recorded")}</td><td>${escapeHtml(row.signalStatus)}</td></tr>`).join("")}</table>
${report.rows.map((row) => `<details><summary>${escapeHtml(row.id)}: 앞뒤 원문·공식 참조·결합 출처·검색 근거</summary><pre>${escapeHtml(JSON.stringify(row, null, 2))}</pre></details>`).join("")}
<details><summary>버전·점수·해석 한계</summary><pre>${escapeHtml(JSON.stringify({ pipeline: report.pipeline, score: report.score, limits: report.limits }, null, 2))}</pre></details></section>`).join("")}
${diff ? `<h2>실행 간 비교</h2><pre>${escapeHtml(JSON.stringify(diff, null, 2))}</pre>` : ""}</html>`;
}
