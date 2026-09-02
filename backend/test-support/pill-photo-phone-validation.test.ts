import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { loadFrozenPillPhotoFixture } from "./pill-photo-fixture.ts";
import { officialPillRecordDigest } from "./pill-photo-label-audit.ts";
import {
  loadPillPhotoPhoneValidationFixture,
  PILL_PHOTO_PHONE_VALIDATION_DIRECTORY,
  PILL_PHOTO_PHONE_VALIDATION_VERSION,
} from "./pill-photo-phone-validation.ts";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function createFixture(directory: string) {
  const frozen = await loadFrozenPillPhotoFixture();
  const items = frozen.snapshot.items.filter((item, index, all) =>
    (item.form === "tablet" || item.form === "capsule") && item.colors.length > 0
      && all.findIndex((other) => other.itemSeq === item.itemSeq) === index).slice(0, 6);
  assert.equal(items.length, 6);
  const products = [];
  const images = [];
  const cases = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    const sequence = String(index + 1).padStart(2, "0");
    const id = `v4-v${sequence}`;
    products.push({
      id,
      providedName: `fixture-${sequence}`,
      expectedItemSeq: item.itemSeq,
      officialProductName: item.productName,
      manufacturer: item.manufacturer,
      expectedOfficialRecordSha256: officialPillRecordDigest(item),
      expectedObservation: {
        form: item.form,
        formName: item.formName,
        shape: item.shape,
        colors: item.colors,
        front: { rawImprint: item.front.rawImprint, imprint: item.front.imprint, scoreLine: item.front.scoreLine, mark: item.front.mark },
        back: { rawImprint: item.back.rawImprint, imprint: item.back.imprint, scoreLine: item.back.scoreLine, mark: item.back.mark },
      },
      sideMapping: { "side-a": "front", "side-b": "back" },
    });
    const photos = [];
    for (const [sideIndex, captureSide] of ["side-a", "side-b"].entries()) {
      const name = `${id}-${captureSide}.jpg`;
      const bytes = await sharp({
        create: {
          width: 96,
          height: 72,
          channels: 3,
          background: { r: 20 + index * 30, g: 30 + sideIndex * 120, b: 40 + index * 5 },
        },
      }).jpeg({ quality: 90 }).toBuffer();
      await writeFile(join(directory, name), bytes);
      images.push({
        path: name,
        productId: id,
        captureSide,
        officialSide: sideIndex === 0 ? "front" : "back",
        bytes: bytes.length,
        width: 96,
        height: 72,
        sha256: sha256(bytes),
      });
      photos.push(name);
    }
    cases.push({ id, split: "validation", expectedItemSeq: item.itemSeq, photos });
  }
  const manifest = {
    schemaVersion: 1,
    fixtureVersion: PILL_PHOTO_PHONE_VALIDATION_VERSION,
    purpose: "smartphone_photo_feature_extraction_and_candidate_recall_validation",
    catalogFixtureVersion: frozen.manifest.fixtureVersion,
    reviewedAt: "2026-09-02",
    scope: {
      split: "validation",
      claim: "smartphone_validation_tuning_only",
      productCount: 6,
      caseCount: 6,
      imageCount: 12,
      historicalAppearanceCaseCount: 0,
      labelsMayBeUsedForTuning: true,
      labelsMayBeSentToModel: false,
      gitTracking: "ignored_local_intake",
    },
    products,
    images,
    cases,
  };
  await writeFile(join(directory, "manifest.local.json"), JSON.stringify(manifest));
  return manifest;
}

test("스마트폰 validation 로더는 해시 고정 사진만 읽고 라벨 없는 추론 입력을 반환한다", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), `pill-phone-validation-${process.pid}-`));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const manifest = await createFixture(directory);
  const loaded = await loadPillPhotoPhoneValidationFixture({ directory, previousImageHashes: new Set() });
  assert.equal(loaded.manifest.fixtureVersion, PILL_PHOTO_PHONE_VALIDATION_VERSION);
  assert.equal(loaded.inferenceInputs.length, 6);
  const serialized = JSON.stringify(loaded.inferenceInputs);
  assert.doesNotMatch(serialized, /expectedItemSeq|officialProductName|manufacturer|expectedObservation|officialSide/);
  assert.ok(manifest.products.every((product) => !serialized.includes(product.expectedItemSeq)));

  const first = loaded.manifest.images[0]!;
  const altered = Buffer.from(await readFile(join(directory, first.path)));
  altered[altered.length - 1] ^= 1;
  await writeFile(join(directory, first.path), altered);
  await assert.rejects(
    loadPillPhotoPhoneValidationFixture({ directory, previousImageHashes: new Set() }),
    /phone_validation_fixture_image_hash_mismatch/,
  );
});

test("현재 로컬 v4 intake가 존재하면 전체 관계·공식 라벨·JPEG 무결성을 검증한다", {
  skip: await access(join(PILL_PHOTO_PHONE_VALIDATION_DIRECTORY, "manifest.local.json")).then(() => false, () => true),
}, async () => {
  const loaded = await loadPillPhotoPhoneValidationFixture();
  assert.equal(loaded.manifest.products.length, 6);
  assert.equal(loaded.manifest.images.length, 12);
  assert.equal(loaded.inferenceInputs.length, 6);
  assert.equal(loaded.manifest.products.filter((product) => product.appearanceHistory).length, 1);
});
