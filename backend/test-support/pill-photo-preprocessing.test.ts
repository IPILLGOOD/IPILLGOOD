import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import { readReviewedPhoto } from "../scripts/pill-photo.ts";
import { prepareReviewedPillPhotoVariants } from "../src/pill-photo-experiment.ts";
import {
  PILL_PHOTO_CONTEXT_MAX_EDGE,
  PILL_PHOTO_DETAIL_EDGE,
  PILL_PHOTO_MIN_AXIS_ELONGATION,
  PILL_PHOTO_VARIANT_PREPROCESSING_VERSION,
  prepareValidatedPillPhotoVariants,
} from "../src/pill-photo-preprocessing.ts";
import { loadPillPhotoEvaluationFixture } from "./pill-photo-evaluation.ts";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("검증·보류 사진 16장의 전체·정렬·대비 변형을 고정 크기와 무메타데이터 PNG로 만든다", async () => {
  const { manifest, inferenceInputs } = await loadPillPhotoEvaluationFixture();
  const imageByPath = new Map(manifest.images.map((image) => [image.path, image]));
  const pathByAbsolute = new Map(inferenceInputs.flatMap((input) => input.photos.map((path, index) => [
    path,
    manifest.cases.find((fixtureCase) => fixtureCase.id === input.id)!.photos[index]!,
  ] as const)));
  for (const absolutePath of inferenceInputs.flatMap((input) => input.photos)) {
    const relativePath = pathByAbsolute.get(absolutePath)!;
    const expected = imageByPath.get(relativePath)!;
    const original = await readFile(absolutePath);
    const variants = await prepareValidatedPillPhotoVariants(original, expected);
    assert.equal(variants.metadata.version, PILL_PHOTO_VARIANT_PREPROCESSING_VERSION);
    assert.ok(variants.metadata.source.alphaBounds.width > 0 && variants.metadata.source.alphaBounds.height > 0);
    assert.deepEqual(variants.metadata.orientation.textOrientationDegreesToEvaluate, [0, 90, 180, 270]);
    assert.ok(variants.metadata.orientation.elongation >= PILL_PHOTO_MIN_AXIS_ELONGATION);
    assert.equal(variants.metadata.orientation.applied, true);
    assert.equal(variants.metadata.variants.context.width <= PILL_PHOTO_CONTEXT_MAX_EDGE, true);
    assert.equal(variants.metadata.variants.context.height <= PILL_PHOTO_CONTEXT_MAX_EDGE, true);
    assert.equal(Math.max(variants.metadata.variants.alignedColor.width, variants.metadata.variants.alignedColor.height), PILL_PHOTO_DETAIL_EDGE);
    assert.equal(Math.max(variants.metadata.variants.alignedContrast.width, variants.metadata.variants.alignedContrast.height), PILL_PHOTO_DETAIL_EDGE);
    assert.ok(variants.metadata.variants.alignedColor.width >= variants.metadata.variants.alignedColor.height);
    assert.equal(variants.metadata.variants.alignedContrast.channels, 1);
    assert.notEqual(variants.metadata.variants.alignedColor.sha256, variants.metadata.variants.alignedContrast.sha256);
    for (const output of [variants.context, variants.alignedColor, variants.alignedContrast]) {
      const metadata = await sharp(output).metadata();
      assert.equal(metadata.format, "png");
      assert.equal(metadata.hasAlpha, false);
      assert.equal(metadata.exif, undefined);
      assert.equal(metadata.xmp, undefined);
    }
    assert.equal(sha256(original), expected.sha256);
  }
});

test("같은 원본과 버전은 바이트·회전 근거까지 결정적으로 같은 변형을 만든다", async () => {
  const { manifest, inferenceInputs } = await loadPillPhotoEvaluationFixture();
  const original = await readFile(inferenceInputs[0]!.photos[0]!);
  const expected = manifest.images.find((image) => image.path === manifest.cases[0]!.photos[0])!;
  const first = await prepareValidatedPillPhotoVariants(original, expected);
  const second = await prepareValidatedPillPhotoVariants(original, expected);
  assert.deepEqual(first.metadata, second.metadata);
  assert.deepEqual(first.context, second.context);
  assert.deepEqual(first.alignedColor, second.alignedColor);
  assert.deepEqual(first.alignedContrast, second.alignedContrast);
});

test("원형 마스크는 불안정한 주축으로 억지 회전하지 않는다", async () => {
  const circle = await sharp(Buffer.from(`<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg"><circle cx="256" cy="256" r="160" fill="#f3a8b8"/></svg>`)).png().toBuffer();
  const variants = await prepareValidatedPillPhotoVariants(circle, { bytes: circle.length, sha256: sha256(circle) });
  assert.equal(variants.metadata.orientation.applied, false);
  assert.equal(variants.metadata.orientation.reason, "round_or_uncertain_mask");
  assert.equal(variants.metadata.orientation.appliedRotationDegrees, 0);
});

test("해시·크기 불일치와 알파 없는 PNG는 변형 처리 전에 거절한다", async () => {
  const { manifest, inferenceInputs } = await loadPillPhotoEvaluationFixture();
  const original = await readFile(inferenceInputs[0]!.photos[0]!);
  const expected = manifest.images.find((image) => image.path === manifest.cases[0]!.photos[0])!;
  const altered = Buffer.from(original);
  altered[100] = altered[100]! ^ 1;
  await assert.rejects(prepareValidatedPillPhotoVariants(altered, expected), /unreviewed_photo/);
  await assert.rejects(prepareValidatedPillPhotoVariants(original, { ...expected, bytes: expected.bytes + 1 }), /unreviewed_photo/);
  const opaque = await sharp({ create: { width: 32, height: 32, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(prepareValidatedPillPhotoVariants(opaque, { bytes: opaque.length, sha256: sha256(opaque) }), /invalid_photo/);
});

test("기존 외부 전송 경로의 9개 고정 원본만 변형 wrapper에 들어갈 수 있다", async () => {
  const original = await readReviewedPhoto(0);
  const variants = await prepareReviewedPillPhotoVariants(original);
  assert.equal(variants.metadata.version, PILL_PHOTO_VARIANT_PREPROCESSING_VERSION);
  const changed = Buffer.from(original);
  changed[100] = changed[100]! ^ 1;
  await assert.rejects(prepareReviewedPillPhotoVariants(changed), /unreviewed_photo/);
});
