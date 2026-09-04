// Node-only historical test data. Never import this loader in a production route or live fallback.
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { MAX_PILL_SNAPSHOT_BYTES, validatePillCatalogSnapshot } from "../src/pill-catalog-snapshot.ts";
import { pillPhotoFeaturesV1Schema } from "../src/pill-photo-features.ts";
import { PILL_PHOTO_FILES, PILL_PHOTO_CASES, PILL_PHOTO_REVIEW_VERSION } from "./pill-photo-review.ts";

export const PILL_PHOTO_FIXTURE_DIRECTORY = fileURLToPath(new URL("./pill-photo-fixtures/", import.meta.url));
export const PILL_PHOTO_FIXTURE_IMAGES = join(PILL_PHOTO_FIXTURE_DIRECTORY, "images");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const file = z.object({ file: z.string(), bytes: z.number().int().positive(), sha256: digest });
const versions = z.object({ review: z.string(), preprocessing: z.string(), prompt: z.string() });
const historicalCandidateSchema = z.object({ itemSeq: z.string().regex(/^\d{9}$/) }).passthrough();
const historicalSearchSchema = z.object({
  status: z.string(), reason: z.string(),
  candidates: z.array(historicalCandidateSchema),
  heldCandidates: z.array(historicalCandidateSchema),
}).passthrough();
const historicalComparisonSchema = z.object({
  status: z.string(), reason: z.string(), search: historicalSearchSchema.nullable(),
}).passthrough();
const manifestSchema = z.object({
  schemaVersion: z.literal(1), fixtureVersion: z.literal("pill-photo-shared-2026-08-31-v1"),
  purpose: z.literal("historical_offline_replay_only"), photoReviewVersion: z.literal(PILL_PHOTO_REVIEW_VERSION),
  catalog: file.extend({ file: z.literal("catalog.json.gz"), bytes: z.number().int().positive().max(4 * 1024 * 1024),
    uncompressedBytes: z.number().int().positive().max(MAX_PILL_SNAPSHOT_BYTES), uncompressedSha256: digest,
    version: z.string(), verifiedAt: z.string().datetime(), records: z.number().int().positive() }),
  baseline: file.extend({ file: z.literal("baseline.json"), bytes: z.number().int().positive().max(256 * 1024),
    createdAt: z.string().datetime(), model: z.string(), historicalRequests: z.number().int().nonnegative(), versions }),
  images: z.array(z.object({ path: z.string(), bytes: z.number().int().positive(), sha256: digest })).length(9),
});
const baselineSchema = z.object({
  mode: z.literal("evaluate"), createdAt: z.string().datetime(), versions, model: z.string(),
  catalogVersion: z.string(), catalogRecords: z.number().int().positive(), catalogVerifiedAt: z.string().datetime(),
  requests: z.number().int().positive(),
  rows: z.array(z.object({ id: z.string(), expectedItemSeq: z.string().regex(/^\d{9}$/).nullable(), photos: z.array(z.string()).length(2),
    extraction: z.object({ ok: z.literal(true), features: pillPhotoFeaturesV1Schema,
      usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }).nullable() }),
    comparison: historicalComparisonSchema.nullable(),
    evaluation: z.object({ outcome: z.string(), expectedRank: z.number().int().positive().nullable(), expectedHeld: z.boolean(), expectedGateObserved: z.boolean().nullable() }),
  })).length(6),
});
export type PillPhotoFixtureManifest = z.infer<typeof manifestSchema>;

export async function readBoundedFixtureFile(path: string, maxBytes: number): Promise<Buffer> {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_PILL_SNAPSHOT_BYTES) throw new Error("invalid_fixture_limit");
  const handle = await open(path, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error("fixture_size_exceeded");
    const buffer = Buffer.alloc(maxBytes + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > maxBytes) throw new Error("fixture_size_exceeded");
    return buffer.subarray(0, total);
  } finally { await handle.close(); }
}

export function decodeFrozenPillCatalog(bytes: Buffer, expected: PillPhotoFixtureManifest["catalog"]) {
  if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) throw new Error("fixture_catalog_hash_mismatch");
  let raw: Buffer;
  try { raw = gunzipSync(bytes, { maxOutputLength: MAX_PILL_SNAPSHOT_BYTES }); }
  catch { throw new Error("fixture_catalog_decode_failed"); }
  if (raw.length !== expected.uncompressedBytes || sha256(raw) !== expected.uncompressedSha256) throw new Error("fixture_catalog_hash_mismatch");
  const checked = validatePillCatalogSnapshot(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)));
  if (!checked.ok || checked.snapshot.version !== expected.version || checked.snapshot.totalCount !== expected.records
    || checked.snapshot.verifiedAt !== expected.verifiedAt) throw new Error("fixture_catalog_invalid");
  return checked.snapshot;
}

/** Fixed Git fixture only, no arbitrary path, clock override, environment keys, network or current-data claim. */
export async function loadFrozenPillPhotoFixture() {
  const manifest = manifestSchema.parse(JSON.parse((await readBoundedFixtureFile(join(PILL_PHOTO_FIXTURE_DIRECTORY, "manifest.json"), 16 * 1024)).toString("utf8")));
  if (manifest.images.some((entry, index) => {
    const reviewed = PILL_PHOTO_FILES[index]!;
    return entry.path !== `images/${reviewed.path}` || entry.bytes !== reviewed.bytes || entry.sha256 !== reviewed.sha256;
  })) throw new Error("fixture_image_manifest_mismatch");
  const snapshot = decodeFrozenPillCatalog(await readBoundedFixtureFile(join(PILL_PHOTO_FIXTURE_DIRECTORY, "catalog.json.gz"), manifest.catalog.bytes), manifest.catalog);
  const rawBaseline = await readBoundedFixtureFile(join(PILL_PHOTO_FIXTURE_DIRECTORY, "baseline.json"), manifest.baseline.bytes);
  if (rawBaseline.length !== manifest.baseline.bytes || sha256(rawBaseline) !== manifest.baseline.sha256) throw new Error("fixture_baseline_hash_mismatch");
  const baseline = baselineSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBaseline)));
  if (baseline.catalogVersion !== snapshot.version || baseline.catalogRecords !== snapshot.totalCount || baseline.catalogVerifiedAt !== snapshot.verifiedAt
    || baseline.createdAt !== manifest.baseline.createdAt || baseline.model !== manifest.baseline.model
    || baseline.requests !== manifest.baseline.historicalRequests || JSON.stringify(baseline.versions) !== JSON.stringify(manifest.baseline.versions)
    || baseline.rows.some((row, index) => row.id !== PILL_PHOTO_CASES[index]!.id || row.expectedItemSeq !== PILL_PHOTO_CASES[index]!.expectedItemSeq
      || row.photos.join(",") !== PILL_PHOTO_CASES[index]!.photos.join(","))) throw new Error("fixture_baseline_mismatch");
  // Deliberately separate from snapshotSearchCatalog: historical data is not represented as fresh.
  const catalog = { items: snapshot.items, totalCount: snapshot.totalCount, completeness: "complete" as const, version: snapshot.version };
  return { manifest, snapshot, baseline, catalog };
}
