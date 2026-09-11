import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { parseOfficialPillPage } from "./official-pill-catalog.ts";
import { pillEnvelope, pillObservation, pillRecord } from "../test-support/pill-fixtures.ts";
import { searchPillCandidates, searchPillCandidateChunks } from "./pill-identification.ts";
import { boundedPillResponse, readPillWebChunks, readPillWebManifest } from "./pill-catalog-web.ts";
import { parsePillWebUpload, validatePillWebJpeg, analyzePillWebPhotos, PILL_WEB_IMAGE_NAMES, PILL_WEB_PREPROCESSING_VERSION } from "./pill-photo-web.ts";
import { PILL_PHOTO_OCR_SIDE_SCHEMA_VERSION } from "./pill-photo-ocr.ts";
const now = Date.parse("2026-09-12T00:00:00Z");
const data = parseOfficialPillPage(pillEnvelope([pillRecord(), pillRecord({ ITEM_SEQ: "209900002" }),
  pillRecord({ ITEM_SEQ: "209900001", COLOR_CLASS1: "노랑" }), pillRecord({ ITEM_SEQ: "209900003", FORM_CODE_NAME: null })]), "json", new Date(now).toISOString());
const catalog = { items: data.items, totalCount: data.items.length, version: `mfds-pill-v1-${"a".repeat(64)}`, completeness: "complete" as const };
async function* chunks(items = catalog.items) { for (const item of items) yield [item]; }
const jpeg = (color: string, size = 768) => sharp({ create: { width: size, height: size, channels: 3, background: color } }).jpeg().toBuffer();
const sources = Promise.all([jpeg("white"), jpeg("gray")]);
async function upload() {
  const images = await sources; const form = new FormData();
  form.set("consent", "true"); form.set("version", PILL_WEB_PREPROCESSING_VERSION);
  for (const name of PILL_WEB_IMAGE_NAMES) form.set(name, new File([images[name.startsWith("front") ? 0 : 1]!], "photo.jpg", { type: "image/jpeg" }));
  return form;
}
test("streamed catalog preserves full search ranking, counts, held groups and cross-chunk variants", async () => {
  for (const input of [pillObservation(), { ...pillObservation(), source: "image_features" }, { ...pillObservation(), count: 2 }]) {
    assert.deepEqual(await searchPillCandidateChunks(input, catalog, chunks(), { limit: 1 }), searchPillCandidates(input, catalog, { limit: 1 }));
  }
});
test("truncated, overlong and failed catalog streams never expose partial candidates", async () => {
  for (const items of [catalog.items.slice(1), [...catalog.items, catalog.items[0]!]]) {
    const result = await searchPillCandidateChunks(pillObservation(), catalog, chunks(items));
    assert.equal(result.status, "unavailable"); assert.equal(result.candidates.length + result.heldCandidates.length, 0);
  }
  await assert.rejects(() => searchPillCandidateChunks(pillObservation(), catalog, (async function* () { yield catalog.items.slice(0, 1); throw new Error("broken_asset"); })()));
  const limited = await searchPillCandidateChunks(pillObservation(), catalog, chunks(), { maxVariants: 1 });
  assert.equal(limited.status, "needs_retake"); assert.equal(limited.candidates.length, 0);
});
function assets() {
  const bytes = Buffer.from(JSON.stringify(catalog.items)); const sha256 = createHash("sha256").update(bytes).digest("hex");
  const manifest = { schemaVersion: "pill-web-catalog.v1", version: catalog.version, verifiedAt: new Date(now).toISOString(), totalCount: catalog.totalCount,
    chunks: [{ path: `/pill-catalog/${sha256}.json`, count: catalog.totalCount, bytes: bytes.length, sha256 }] };
  return { manifest, bytes, read: async (path: string) => path.endsWith("manifest.json") ? Response.json(manifest) : new Response(bytes) };
}
test("catalog assets require a fresh manifest, complete counts and exact immutable chunk hashes", async () => {
  const source = assets(); const manifest = await readPillWebManifest(source.read, now);
  const received = []; for await (const chunk of readPillWebChunks(manifest, source.read)) received.push(...chunk);
  assert.deepEqual(received, catalog.items);
  await assert.rejects(() => readPillWebManifest(source.read, now - 1));
  await assert.rejects(() => readPillWebManifest(source.read, now + 168 * 3_600_000 + 1));
  source.manifest.totalCount++;
  await assert.rejects(() => readPillWebManifest(source.read, now));
  await assert.rejects(async () => { for await (const _ of readPillWebChunks(manifest, async () => new Response(source.bytes.toString().replace("209900001", "209900009")))) void _; });
});
test("asset/upload readers enforce the byte cap on streamed bodies without content-length", async () => {
  await assert.rejects(() => boundedPillResponse(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(100)); controller.close(); } })), 50));
});
test("web upload rejects duplicate sides, missing views, metadata, consent and fake images", async () => {
  const form = await upload(); const images = await parsePillWebUpload(form);
  assert.equal(Object.keys(images).length, 18);
  assert.deepEqual(validatePillWebJpeg(images["front-context"]!), { width: 768, height: 768 });
  form.set("back-context", form.get("front-context")!); await assert.rejects(() => parsePillWebUpload(form), /duplicate_photo/);
  for (const key of ["front-color-90", "consent"]) {
    const bad = await upload(); bad.delete(key); await assert.rejects(() => parsePillWebUpload(bad));
  }
  const metadata = await sharp(await jpeg("white")).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  assert.throws(() => validatePillWebJpeg(metadata));
  assert.throws(() => validatePillWebJpeg(Buffer.from("not a photo")));
  assert.throws(() => validatePillWebJpeg(awaitedOversize));
});
const awaitedOversize = Buffer.alloc(512 * 1024 + 1);
const response = (features: unknown) => Response.json({ status: "completed", output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(features) }] }] });
test("web pipeline uses JPEG-only visual/OCR requests and the shared deterministic catalog comparison", async () => {
  const images = await parsePillWebUpload(await upload()); let calls = 0;
  const observation = pillObservation(); const { source: _, ...body } = observation; void _;
  const result = await analyzePillWebPhotos(images, { apiKey: "test-key", model: "test-model", catalog: { ...catalog, verifiedAt: new Date(now).toISOString() }, chunks,
    fetchImpl: async (_url, init) => {
      const payload = JSON.parse(String(init?.body)); assert.equal(payload.store, false);
      assert.ok(payload.input[0].content.filter((part: { type: string }) => part.type === "input_image").every((part: { image_url: string }) => part.image_url.startsWith("data:image/jpeg;base64,")));
      const stage = calls++;
      return stage === 0 ? response({ observation: body, pairConsistency: "consistent", bothSidesVisible: true, imageArtifact: "none" })
        : response({ schemaVersion: PILL_PHOTO_OCR_SIDE_SCHEMA_VERSION, side: (() => { const { scoreLine: _, ...side } = (stage === 1 ? observation.front : observation.back)!; void _; return side; })() });
    },
  });
  assert.equal(calls, 3); assert.equal(result.comparison.status, "searched"); assert.equal(result.comparison.search?.candidates[0]?.itemSeq, "209900001");
  assert.ok(!JSON.stringify(result).includes("base64"));
});
