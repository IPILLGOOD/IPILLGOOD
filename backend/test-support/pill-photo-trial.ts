// Node-only controlled validation experiments. This module never reads keys or calls a provider.
import { createHash } from "node:crypto";
import sharp from "sharp";
import { isDeepStrictEqual } from "node:util";
import { pillPhotoExperimentVersions, type PreparedPillPhotoRequests, type PillPhotoRequestStage } from "../src/pill-photo-experiment.ts";
import { PILL_SEARCH_RULES_VERSION } from "../src/pill-identification.ts";
import { PILL_PHOTO_SCORE_POLICY_VERSION, type PillPhotoCaseScore } from "./pill-photo-score.ts";
import { PILL_PHOTO_PHONE_VALIDATION_VERSION } from "./pill-photo-phone-validation.ts";
import { PILL_PHOTO_STRUCTURED_PROMPT_VERSION, pillPhotoVisionInstructions } from "../src/pill-photo-prompt-profiles.ts";
import { PILL_PHOTO_OCR_INSTRUCTIONS } from "../src/pill-photo-ocr.ts";

export const PILL_PHOTO_TRIAL_PROTOCOL = Object.freeze({
  schemaVersion: "pill-photo-trial-protocol.v1", id: "validation-baseline-v1",
  fixtureVersion: "pill-photo-phone-validation-local-2026-09-02-v4", split: "validation",
  products: 6, cases: 6, images: 12, repetitions: 3, maximumRequests: 54,
  model: "gpt-5.6-sol", ocrModel: "gpt-5.6-sol", modelSnapshotPinned: false,
  preprocessing: "pill-phone-centered-detail-contrast-v1",
  visionPrompt: "pill-photo-observation-v3-multiview", ocrPrompt: "pill-photo-imprint-ocr-per-side-dual-view-v2",
  fusion: "pill-photo-vision-ocr-consensus-v1", search: "pill-structured-v8-anchored-partial-imprint",
  scorePolicy: "capture-candidate-recall-v2-minimum-sample",
  reasoningEffort: "low", imageDetail: "high", visionMaxOutputTokens: 2400, ocrMaxOutputTokens: 1400,
  store: false, retries: 0, stopOnAnyExtractionFailure: true,
} as const);
export const PILL_PHOTO_STRUCTURED_TRIAL_PROTOCOL = Object.freeze({
  ...PILL_PHOTO_TRIAL_PROTOCOL, id: "validation-structured-observation-v1",
  visionPrompt: PILL_PHOTO_STRUCTURED_PROMPT_VERSION,
} as const);
export type PillPhotoTrialProtocol = typeof PILL_PHOTO_TRIAL_PROTOCOL | typeof PILL_PHOTO_STRUCTURED_TRIAL_PROTOCOL;
export function pillPhotoTrialProtocol(id: string = PILL_PHOTO_TRIAL_PROTOCOL.id): PillPhotoTrialProtocol {
  if (id === PILL_PHOTO_TRIAL_PROTOCOL.id) return PILL_PHOTO_TRIAL_PROTOCOL;
  if (id === PILL_PHOTO_STRUCTURED_TRIAL_PROTOCOL.id) return PILL_PHOTO_STRUCTURED_TRIAL_PROTOCOL;
  throw new Error("trial_unknown_protocol");
}
export const PILL_PHOTO_TRIAL_CASE_IDS = Array.from({ length: 6 }, (_, index) => `v4-v0${index + 1}`);
export const PILL_PHOTO_REQUEST_STAGES = ["vision", "ocrFront", "ocrBack"] as const;
export const trialSha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

export function assertCurrentPillPhotoTrialProtocol(protocol: PillPhotoTrialProtocol = PILL_PHOTO_TRIAL_PROTOCOL) {
  if (!isDeepStrictEqual(protocol, pillPhotoTrialProtocol(protocol.id))
    || protocol.fixtureVersion !== PILL_PHOTO_PHONE_VALIDATION_VERSION
    || protocol.preprocessing !== pillPhotoExperimentVersions.phonePreprocessing
    || (protocol.id === PILL_PHOTO_TRIAL_PROTOCOL.id && protocol.visionPrompt !== pillPhotoExperimentVersions.prompt)
    || protocol.ocrPrompt !== pillPhotoExperimentVersions.ocrPrompt
    || protocol.fusion !== pillPhotoExperimentVersions.fusion || protocol.search !== PILL_SEARCH_RULES_VERSION
    || protocol.scorePolicy !== PILL_PHOTO_SCORE_POLICY_VERSION) throw new Error("trial_protocol_version_mismatch");
}

/** Persist the actual request images, not separately regenerated approximations of them. */
export async function describePillPhotoTrialPreparation(prepared: PreparedPillPhotoRequests, protocol: PillPhotoTrialProtocol = PILL_PHOTO_TRIAL_PROTOCOL) {
  assertCurrentPillPhotoTrialProtocol(protocol);
  const images = new Map<string, Buffer>();
  const requests = [];
  for (const stage of PILL_PHOTO_REQUEST_STAGES) {
    const request = prepared.requests[stage];
    if (request.model !== (stage === "vision" ? protocol.model : protocol.ocrModel)
      || request.instructions !== (stage === "vision" ? pillPhotoVisionInstructions(protocol.visionPrompt) : PILL_PHOTO_OCR_INSTRUCTIONS)
      || request.reasoning.effort !== protocol.reasoningEffort || request.store !== protocol.store
      || request.max_output_tokens !== (stage === "vision" ? protocol.visionMaxOutputTokens : protocol.ocrMaxOutputTokens)) {
      throw new Error("trial_request_settings_mismatch");
    }
    const placements = [];
    const content = [];
    let imageIndex = 0;
    for (const part of request.input[0]!.content) {
      if (!("image_url" in part)) { content.push(part); continue; }
      const prefix = "data:image/png;base64,";
      if (part.detail !== protocol.imageDetail || !part.image_url.startsWith(prefix) || part.image_url.length > 8 * 1024 * 1024) {
        throw new Error("trial_invalid_request_image");
      }
      const encoded = part.image_url.slice(prefix.length);
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.toString("base64") !== encoded || !bytes.length) throw new Error("trial_invalid_request_image");
      const sha256 = trialSha256(bytes);
      const metadata = await sharp(bytes, { limitInputPixels: 25_000_000, failOn: "warning" }).metadata();
      if (metadata.format !== "png" || !metadata.width || !metadata.height || metadata.exif || metadata.xmp || metadata.hasAlpha) {
        throw new Error("trial_invalid_request_image");
      }
      images.set(sha256, bytes);
      const placement = { index: imageIndex++, sha256, path: `images/${sha256}.png`, bytes: bytes.length,
        width: metadata.width, height: metadata.height, detail: part.detail };
      placements.push(placement);
      content.push({ type: "input_image", ...placement });
    }
    if (placements.length !== (stage === "vision" ? 4 : 8)) throw new Error("trial_request_image_count_mismatch");
    requests.push({ stage, bodySha256: trialSha256(JSON.stringify(request)),
      instructionsSha256: trialSha256(request.instructions), schemaSha256: trialSha256(JSON.stringify(request.text.format)),
      images: placements,
      // Image slots are descriptors here, NOT a request body that may be sent to the API.
      requestDescription: { ...request, input: [{ role: "user", content }] } });
  }
  return { images, manifest: { sourceSha256: prepared.sourceSha256, preprocessing: prepared.preprocessing, requests } };
}

export type PillPhotoTrialCasePreparation = Awaited<ReturnType<typeof describePillPhotoTrialPreparation>>["manifest"];

export function renderPillPhotoTrialPlan(cases: ({ id: string } & PillPhotoTrialCasePreparation)[]) {
  const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Validation 전송 전 이미지 점검</title><style>body{font-family:system-ui;max-width:1200px;margin:2rem auto;padding:1rem}.grid{display:flex;flex-wrap:wrap;gap:1rem}figure{margin:0}img{width:180px;height:180px;object-fit:contain;border:1px solid #ccc}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{margin:1rem 0}</style>
<h1>Validation 전송 전 이미지 점검</h1><p>준비만 완료 · 외부 API 호출 0회 · 추론/정답/정확도 평가 결과 아님</p>
<p>Vision: A 전체·세부, B 전체·세부 순서. OCR: 한 면의 색상 0/90/180/270도, 대비 0/90/180/270도 순서. 여러 약이 아니라 같은 약의 변형입니다.</p>
${cases.map((entry) => `<details><summary>${escape(entry.id)} — 실제 요청 이미지 보기</summary>
<pre>${escape(JSON.stringify(entry.preprocessing, null, 2))}</pre>
${entry.requests.map((request) => `<h2>${escape(request.stage)}</h2><div class="grid">${request.images.map((image) => {
    if (!/^[a-f0-9]{64}$/.test(image.sha256)) throw new Error("trial_invalid_preview_image_hash");
    return `<figure><img loading="lazy" src="images/${image.sha256}.png" alt="${escape(entry.id)} ${escape(request.stage)} ${image.index + 1}"><figcaption>${image.index + 1}: ${image.width} × ${image.height}</figcaption></figure>`;
  }).join("")}</div>`).join("")}</details>`).join("")}</html>`;
}

export function assertPillPhotoTrialPreparation(expected: PillPhotoTrialCasePreparation, actual: PreparedPillPhotoRequests) {
  if (!isDeepStrictEqual(expected.sourceSha256, actual.sourceSha256)
    || !isDeepStrictEqual(expected.preprocessing, actual.preprocessing)
    || expected.requests.length !== 3
    || expected.requests.some((request, index) => request.stage !== PILL_PHOTO_REQUEST_STAGES[index]
      || request.bodySha256 !== trialSha256(JSON.stringify(actual.requests[request.stage])))) {
    throw new Error("trial_prepared_request_changed");
  }
}

/** Shared budget/order guard. Counting occurs BEFORE the transport, not after a successful response. */
export function createPillPhotoTrialRequestGuard(expected: PillPhotoTrialCasePreparation, count: { attempted: number }) {
  let nextStage = 0;
  let pending: PillPhotoRequestStage | null = null;
  return {
    start(stage: PillPhotoRequestStage, bodySha256: string) {
      if (pending || stage !== PILL_PHOTO_REQUEST_STAGES[nextStage] || bodySha256 !== expected.requests[nextStage]?.bodySha256
        || count.attempted >= PILL_PHOTO_TRIAL_PROTOCOL.maximumRequests) throw new Error("trial_request_guard_failed");
      count.attempted++;
      pending = stage;
    },
    finish(stage: PillPhotoRequestStage) {
      if (pending !== stage) throw new Error("trial_request_guard_failed");
      pending = null;
      nextStage++;
    },
    complete() { return nextStage === 3 && pending === null; },
  };
}

type ScoredRepeat = { repetition: number; rows: PillPhotoCaseScore[]; passed: boolean };
export function summarizePillPhotoTrialRepeats(repeats: ScoredRepeat[]) {
  if (repeats.length !== PILL_PHOTO_TRIAL_PROTOCOL.repetitions
    || repeats.some((repeat, index) => repeat.repetition !== index + 1
      || !isDeepStrictEqual(repeat.rows.map((row) => row.id), PILL_PHOTO_TRIAL_CASE_IDS))) {
    throw new Error("trial_incomplete_repetitions");
  }
  const hits = (k: number) => repeats.map((repeat) => repeat.rows.filter((row) => row.expectedRank !== null && row.expectedRank <= k).length);
  return { independentProducts: 6, repeatedEvaluations: 18,
    allRepetitionsPassed: repeats.every((repeat) => repeat.passed && repeat.rows.every((row) => row.extractionStatus === "ok")),
    providerDeterminismClaim: false,
    safetyByRepetition: repeats.map((repeat) => ({ repetition: repeat.repetition,
      strongWrongCandidates: repeat.rows.reduce((sum, row) => sum + row.strongWrongCandidateItemSeqs.length, 0),
      retakeCandidateExposureCases: repeat.rows.filter((row) => row.needsRetake && (row.candidateItemSeqs.length || row.heldCandidateItemSeqs.length)).length })),
    recall: [1, 5, 20].map((k) => ({ k, hitsByRepetition: hits(k), denominatorPerRepetition: 6,
      minHits: Math.min(...hits(k)), maxHits: Math.max(...hits(k)) })),
    rows: PILL_PHOTO_TRIAL_CASE_IDS.map((id, index) => {
      const rows = repeats.map((repeat) => repeat.rows[index]!);
      return { id, ranks: rows.map((row) => row.expectedRank), changed: rows.some((row) => !isDeepStrictEqual(row, rows[0])), results: rows };
    }) };
}
