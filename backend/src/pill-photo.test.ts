import assert from "node:assert/strict";
import test from "node:test";
import { observedSide, pillEnvelope, pillObservation, pillRecord } from "../test-support/pill-fixtures.ts";
import { PILL_PHOTO_CASES, PILL_PHOTO_FILES } from "../test-support/pill-photo-review.ts";
import { parseOfficialPillPage } from "./official-pill-catalog.ts";
import { comparePillPhotoFeatures, migratePillPhotoFeaturesV1, PILL_PHOTO_PROMPT_VERSION, pillPhotoFeaturesSchema, pillPhotoFeaturesV1Schema } from "./pill-photo-features.ts";
import { applyReviewedPhotoMaskGate, assessReviewedPhotoMask, extractReviewedPillPhotos, MIN_REVIEWED_PILL_MASK_SOLIDITY, parsePillPhotoResponse, pillPhotoRequest, prepareReviewedPillPhoto, reviewedPhotoIndex } from "./pill-photo-experiment.ts";
import { parsePillPhotoArgs, readReviewedPhoto, renderPillPhotoReport, scorePillPhotoCase, type PillPhotoReport } from "../scripts/pill-photo.ts";

function features() {
  const { source, ...observation } = pillObservation();
  assert.equal(source, "manual");
  return { observation, pairConsistency: "consistent", bothSidesVisible: true, imageArtifact: "none" };
}
function catalog(records = [pillRecord()]) {
  return { ...parseOfficialPillPage(pillEnvelope(records), "json", "2026-08-31T00:00:00.000Z"), completeness: "complete" as const, version: "test" };
}
function response(text = JSON.stringify(features())) {
  return { status: "completed", output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] }], usage: { input_tokens: 100, output_tokens: 20 } };
}

test("고정 prompt-v1 사진 특징은 원본과 분리해 pill-observation.v2로 변환한다", () => {
  const current = features();
  const legacy = {
    ...current,
    observation: {
      form: current.observation.form, integrity: current.observation.integrity, count: current.observation.count,
      overlapping: current.observation.overlapping, quality: current.observation.quality, shape: current.observation.shape,
      colors: current.observation.colors, front: { imprint: null, scoreLine: "unknown" }, back: { imprint: "", scoreLine: "none" },
    },
  };
  const before = JSON.stringify(legacy);
  assert.equal(pillPhotoFeaturesV1Schema.safeParse(legacy).success, true);
  assert.equal(pillPhotoFeaturesSchema.safeParse(legacy).success, false);
  const migrated = migratePillPhotoFeaturesV1(legacy);
  assert.equal(JSON.stringify(legacy), before);
  assert.equal(migrated.observation.schemaVersion, "pill-observation.v2");
  assert.deepEqual(migrated.observation.front, observedSide(null, "unknown"));
  assert.deepEqual(migrated.observation.back, observedSide("", "none"));
  assert.equal(PILL_PHOTO_PROMPT_VERSION, "pill-photo-observation-v2");
});

test("사진 특징 계약은 기존 검색에 연결되며 입력을 변경하거나 약을 확정하지 않는다", () => {
  const input = features(), data = catalog();
  const before = JSON.stringify({ input, data });
  const result = comparePillPhotoFeatures(input, data);
  assert.equal(result.status, "searched");
  assert.equal(result.observation?.source, "image_features");
  assert.equal(result.search?.status, "candidates_found");
  assert.equal(result.search?.candidates[0]?.itemSeq, "209900001");
  assert.equal(JSON.stringify({ input, data }), before);
  assert.equal("medicationPlan" in result, false);
});

test("사진 손상·불확실한 쌍·동일 면은 후보 검색 전에 재촬영으로 차단한다", () => {
  for (const patch of [{ imageArtifact: "present" }, { imageArtifact: "uncertain" }, { pairConsistency: "inconsistent" }, { pairConsistency: "uncertain" }, { bothSidesVisible: false }]) {
    const result = comparePillPhotoFeatures({ ...features(), ...patch }, catalog());
    assert.equal(result.status, "needs_retake");
    assert.equal(result.search, null);
  }
});

test("검수 사진의 투명 마스크는 깊은 잘림을 로컬에서 감지하고 모델 판정을 덮어쓰되 입력을 변경하지 않는다", async () => {
  const assessments = await Promise.all(PILL_PHOTO_FILES.map(async (_, index) => assessReviewedPhotoMask(await readReviewedPhoto(index))));
  assert.deepEqual(assessments.flatMap((assessment, index) => assessment.status === "suspicious" ? [index] : []), [8]);
  assert.ok(assessments[8]!.alphaSolidity < MIN_REVIEWED_PILL_MASK_SOLIDITY);
  assert.equal(assessments.filter((assessment) => assessment.status === "accepted")
    .every((assessment) => assessment.alphaSolidity >= MIN_REVIEWED_PILL_MASK_SOLIDITY), true);
  const input = pillPhotoFeaturesSchema.parse(features());
  const before = JSON.stringify(input);
  const guarded = applyReviewedPhotoMaskGate(input, [assessments[8]!]);
  assert.equal(guarded.imageArtifact, "present");
  assert.equal(JSON.stringify(input), before);
});

test("외부 출력의 약명·품목코드·임의 색상·source 추가와 누락 필드는 거절한다", () => {
  for (const value of [
    { ...features(), drugName: "알 수 없는 약" }, { ...features(), itemSeq: "209900001" },
    { ...features(), observation: pillObservation() },
    { ...features(), observation: { ...features().observation, colors: ["추정색"] } },
    { ...features(), bothSidesVisible: undefined },
  ]) assert.equal(comparePillPhotoFeatures(value, catalog()).status, "invalid_features");
});

test("사진 각인 미상·흐림·복수 약·지원하지 않는 제형은 기존 안전 상태를 유지한다", () => {
  for (const patch of [{ quality: "blurred" }, { count: 2 }, { overlapping: true }, { back: null }, { front: observedSide(null, "unknown") }]) {
    assert.equal(comparePillPhotoFeatures({ ...features(), observation: { ...features().observation, ...patch } }, catalog()).search?.status, "needs_retake");
  }
  for (const form of ["powder", "granule", "liquid", "other"]) {
    assert.equal(comparePillPhotoFeatures({ ...features(), observation: { ...features().observation, form } }, catalog()).search?.status, "unsupported_form");
  }
  for (const integrity of ["split", "damaged"]) {
    assert.equal(comparePillPhotoFeatures({ ...features(), observation: { ...features().observation, integrity } }, catalog()).search?.status, "unsupported_form");
  }
});

test("복수 각인과 판독 불가·직접 확인한 무각인을 구분하고 공식 각인 근거 부족은 보류한다", () => {
  const multiple = { ...observedSide("T0", "unknown"), imprintCandidates: ["T0", "TO"] };
  assert.deepEqual(pillPhotoFeaturesSchema.parse({ ...features(), observation: { ...features().observation, front: multiple } }).observation.front?.imprintCandidates, ["T0", "TO"]);
  const noImprints = catalog([pillRecord({ PRINT_FRONT: "", PRINT_BACK: "" })]);
  assert.equal(comparePillPhotoFeatures(features(), noImprints).search?.status, "needs_review");
  const blank = { ...features(), observation: { ...features().observation, front: observedSide("", "unknown") } };
  assert.equal(pillPhotoFeaturesSchema.parse(blank).observation.front?.noImprintObserved, true);
});

test("사진 앞뒤 방향이 뒤집혀도 기존 검색의 각인·분할선 쌍 비교를 유지한다", () => {
  const original = features();
  const swapped = { ...original, observation: { ...original.observation, front: original.observation.back, back: original.observation.front } };
  assert.equal(comparePillPhotoFeatures(swapped, catalog()).search?.candidates[0]?.variants[0]?.orientation, "swapped");
});

test("공개 검수 명세는 중복 없는 SHA256·9개 파일·4개 독립 코드와 2개 거절 사례다", () => {
  assert.equal(PILL_PHOTO_FILES.length, 9);
  assert.equal(new Set(PILL_PHOTO_FILES.map((file) => file.sha256)).size, 9);
  for (const file of PILL_PHOTO_FILES) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.match(file.path, /^\d{5}\/IMG_\d{8}_\d{6}\.png$/);
    assert.ok(file.bytes > 0 && file.bytes < 5 * 1024 * 1024);
  }
  assert.equal(PILL_PHOTO_CASES.filter((item) => item.kind === "candidate").length, 4);
  assert.equal(PILL_PHOTO_CASES.filter((item) => item.kind === "reject").length, 2);
  for (const item of PILL_PHOTO_CASES) for (const index of item.photos) assert.ok(PILL_PHOTO_FILES[index]);
});

test("외부 요청에는 사진·추출 계약만 있고 정답 코드·약명·경로·검색 예제가 없다", () => {
  const request = pillPhotoRequest(Buffer.from("fake-image-A"), Buffer.from("fake-image-B"), "test-model");
  const serialized = JSON.stringify(request);
  assert.equal(request.store, false);
  assert.equal(request.text.format.strict, true);
  assert.equal(request.input[0]?.content.filter((part) => part.type === "input_image").length, 2);
  assert.equal("tools" in request, false);
  assert.ok(serialized.includes('"imprintCandidates"'));
  assert.ok(serialized.includes('"maxItems":5'));
  assert.ok(serialized.includes('"pill-observation.v2"'));
  for (const item of PILL_PHOTO_CASES) {
    if (item.expectedItemSeq) assert.ok(!serialized.includes(item.expectedItemSeq));
    assert.ok(!serialized.includes(item.id));
  }
  for (const file of PILL_PHOTO_FILES) assert.ok(!serialized.includes(file.path));
  assert.ok(!serialized.includes("테스트 전용 정제"));
  for (const forbidden of ["drugName", "ingredientName", "itemSeq", "productName"]) assert.ok(!serialized.includes(`"${forbidden}"`));
  assert.equal(request.text.format.schema.additionalProperties, false);
});

test("미동의·미검수·잘못된 입력은 디코더나 네트워크 호출 없이 거절한다", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls++; throw new Error("must_not_call"); };
  const empty = [Buffer.alloc(0), Buffer.alloc(0)] as const;
  assert.deepEqual(await extractReviewedPillPhotos(empty, { fetchImpl }), { ok: false, reason: "transfer_not_confirmed" });
  assert.deepEqual(await extractReviewedPillPhotos(empty, { allowExternalTransfer: true, fetchImpl }), { ok: false, reason: "unreviewed_photo" });
  assert.deepEqual(await extractReviewedPillPhotos(null as unknown as typeof empty, { allowExternalTransfer: true, fetchImpl }), { ok: false, reason: "unreviewed_photo" });
  assert.equal(reviewedPhotoIndex(null as unknown as Uint8Array), -1);
  assert.equal(reviewedPhotoIndex(Buffer.alloc(5 * 1024 * 1024 + 1)), -1);
  await assert.rejects(prepareReviewedPillPhoto(Buffer.from("not-a-reviewed-image")), /unreviewed_photo/);
  assert.equal(calls, 0);
});

test("구조화 출력은 completed 메시지와 안전한 토큰 수만 읽고 원문 응답을 반환하지 않는다", () => {
  const result = parsePillPhotoResponse(response());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.usage, { inputTokens: 100, outputTokens: 20 });
    assert.equal("output" in result, false);
  }
  const badUsage = parsePillPhotoResponse({ ...response(), usage: { input_tokens: -1, output_tokens: "x" } });
  assert.equal(badUsage.ok && badUsage.usage, null);
});

test("거절·잘린 응답·비JSON·추가 식별 주장·여러 메시지·도구 호출을 성공으로 취급하지 않는다", () => {
  assert.deepEqual(parsePillPhotoResponse({ ...response(), status: "incomplete" }), { ok: false, reason: "incomplete_response" });
  const refused = response();
  refused.output[0]!.content = [{ type: "refusal", text: "refused" }];
  assert.deepEqual(parsePillPhotoResponse(refused), { ok: false, reason: "refused" });
  for (const value of [null, response("not-json"), response("x".repeat(17000)), response(JSON.stringify({ ...features(), identified: true })),
    { ...response(), output: [] }, { ...response(), output: [...response().output, ...response().output] },
    { ...response(), output: [{ type: "function_call" }] }, { ...response(), output: [{ ...response().output[0], role: "user" }] }]) {
    assert.equal(parsePillPhotoResponse(value).ok, false);
  }
});

test("로컬 명령은 명시적 이중 전송 플래그와 고정 사례만 허용한다", () => {
  const args = ["--catalog", "fixture.json", "--max-age-hours", "24"];
  assert.equal(parsePillPhotoArgs(["review", ...args]).cases.length, 6);
  assert.equal(parsePillPhotoArgs(["evaluate", ...args, "--live", "--confirm-public-transfer", "--case", "oval-tablet"]).cases.length, 1);
  for (const extra of [[], ["--live"], ["--confirm-public-transfer"]]) assert.throws(() => parsePillPhotoArgs(["evaluate", ...args, ...extra]), /explicit_public_transfer_required/);
  assert.throws(() => parsePillPhotoArgs(["review", ...args, "--live"]), /review_is_offline/);
  assert.throws(() => parsePillPhotoArgs(["review", ...args, "--images", "private.png"]), /invalid_arguments/);
  assert.throws(() => parsePillPhotoArgs(["review", ...args, "--case", "private"]), /unknown_case/);
  assert.throws(() => parsePillPhotoArgs(["review", ...args, "--catalog", "other"]), /invalid_arguments/);
  assert.throws(() => parsePillPhotoArgs(["review", "--catalog", "fixture.json", "--max-age-hours", "999"]), /invalid_freshness_policy/);
});

test("평가는 보류·미실행·단순 무검색 결과를 올바른 약 또는 예외 거절로 세지 않는다", () => {
  const matched = comparePillPhotoFeatures(features(), catalog());
  assert.equal(scorePillPhotoCase("209900001", matched).expectedRank, 1);
  assert.equal(scorePillPhotoCase(null, matched).outcome, "rejection_missed");
  assert.equal(scorePillPhotoCase(null, null).outcome, "not_evaluated");
  const retake = comparePillPhotoFeatures({ ...features(), imageArtifact: "present" }, catalog());
  assert.equal(scorePillPhotoCase(null, retake).outcome, "rejected");
  assert.equal(scorePillPhotoCase(null, retake, "image_artifact_or_uncertainty").expectedGateObserved, true);
  assert.equal(scorePillPhotoCase(null, retake, "unverified_photo_pair").expectedGateObserved, false);
  assert.equal(scorePillPhotoCase("209900001", retake).outcome, "expected_candidate_missing");
  const held = comparePillPhotoFeatures(features(), catalog([pillRecord({ PRINT_FRONT: "", PRINT_BACK: "" })]));
  assert.equal(scorePillPhotoCase("209900001", held).expectedHeld, true);
  assert.equal(scorePillPhotoCase("209900001", held).outcome, "expected_candidate_missing");
  const missing = comparePillPhotoFeatures(features(), catalog([]));
  assert.equal(scorePillPhotoCase(null, missing).outcome, "rejection_missed");
});

test("정적 HTML은 모델·제품 텍스트를 이스케이프하고 외부 이미지를 자동 요청하지 않는다", () => {
  const report: PillPhotoReport = { mode: "review", createdAt: "test", versions: { review: "healthkr-pilot-2026-08-31-v1", preprocessing: "public-rgba-alpha-bounds-white-1024-v1", prompt: "pill-photo-observation-v2", maskPolicy: "reviewed-alpha-solidity-v1" }, model: null, catalogVersion: "test", catalogRecords: 1, catalogVerifiedAt: "test", maxAgeHours: 24, requests: 0,
    sourceUrl: "javascript:alert(1)", rows: [{ id: "<script>alert(1)</script>", kind: "candidate", expectedItemSeq: "209900001", expectedProduct: "<img src=x onerror=alert(1)>", evidenceUrl: null, photos: ["0", "1"], extraction: null, maskAssessments: [], comparison: null, evaluation: scorePillPhotoCase("209900001", null) }] };
  const rendered = renderPillPhotoReport(report);
  assert.ok(!rendered.includes("<script>"));
  assert.ok(!rendered.includes("<img src=x"));
  assert.ok(!rendered.includes('href="javascript:'));
  assert.ok(!/<img[^>]+src="https?:/i.test(rendered));
  assert.ok(rendered.includes("&lt;script&gt;"));
  assert.ok(rendered.includes("Content-Security-Policy"));
});
