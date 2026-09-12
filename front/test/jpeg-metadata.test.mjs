import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { stripJpegMetadata } from "../src/components/pills/jpeg-metadata.ts";
import { validatePillWebJpeg } from "../../backend/src/pill-photo-web.ts";

test("canvas EXIF, XMP, IPTC and comments are removed without changing pixels or ICC", async () => {
  const encoded = await sharp({ create: { width: 320, height: 240, channels: 3, background: "#528a64" } })
    .withMetadata({ orientation: 1 }).jpeg().toBuffer();
  const segment = (marker, text) => {
    const content = Buffer.from(text);
    const header = Buffer.from([0xff, marker, 0, 0]);
    header.writeUInt16BE(content.length + 2, 2);
    return Buffer.concat([header, content]);
  };
  const jpeg = Buffer.concat([encoded.subarray(0, 2), segment(0xe1, "XMP-private"),
    segment(0xed, "IPTC-private"), segment(0xfe, "private-comment"), encoded.subarray(2)]);
  assert.throws(() => validatePillWebJpeg(jpeg), /invalid_photo/);
  const clean = stripJpegMetadata(jpeg);
  assert.deepEqual(validatePillWebJpeg(clean), { width: 320, height: 240 });
  const metadata = await sharp(clean).metadata();
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.xmp, undefined);
  assert.equal(metadata.iptc, undefined);
  assert.deepEqual(metadata.icc, (await sharp(jpeg).metadata()).icc);
  assert.deepEqual(await sharp(clean).raw().toBuffer(), await sharp(jpeg).raw().toBuffer());
  assert.equal(Buffer.from(clean).includes(Buffer.from("private")), false);
  assert.deepEqual(stripJpegMetadata(clean), clean);
});

test("invalid or truncated JPEG segments fail before uploading", () => {
  for (const bytes of [[], [0xff, 0xd8, 0xff, 0xd9], [0xff, 0xd8, 0xff, 0xe1, 0, 20, 0xff, 0xd9],
    [0xff, 0xd8, 0xff, 0xe1, 0, 1, 0xff, 0xd9]]) {
    assert.throws(() => stripJpegMetadata(new Uint8Array(bytes)), /사진을 처리하지 못했어요/);
  }
});
