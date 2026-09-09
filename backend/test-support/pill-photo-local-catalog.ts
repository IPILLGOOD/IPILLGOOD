// Node-only local photo testing. Never use this historical snapshot as a live-data fallback.
import { join } from "node:path";
import { z } from "zod";
import { MAX_PILL_SNAPSHOT_BYTES } from "../src/pill-catalog-snapshot.ts";
import type { PillCatalog } from "../src/pill-identification.ts";
import { decodeFrozenPillCatalog, PILL_PHOTO_FIXTURE_DIRECTORY, readBoundedFixtureFile } from "./pill-photo-fixture.ts";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
// Only catalog metadata is needed here; baseline observations and reviewed images are not loaded.
const catalogManifestSchema = z.object({
  schemaVersion: z.literal(1),
  fixtureVersion: z.literal("pill-photo-shared-2026-08-31-v1"),
  purpose: z.literal("historical_offline_replay_only"),
  catalog: z.object({
    file: z.literal("catalog.json.gz"),
    bytes: z.number().int().positive().max(4 * 1024 * 1024),
    sha256: digest,
    uncompressedBytes: z.number().int().positive().max(MAX_PILL_SNAPSHOT_BYTES),
    uncompressedSha256: digest,
    version: z.string().min(1).max(200),
    verifiedAt: z.string().datetime(),
    records: z.number().int().positive().max(50_000),
  }),
});

export type LocalPillPhotoCatalog = {
  catalog: PillCatalog;
  metadata: {
    mode: "fixed_local_test_snapshot";
    verifiedAt: string;
    version: string;
    records: number;
    /** SHA-256 of the compressed Git fixture, not an AI result or a freshness claim. */
    sha256: string;
  };
};

/** Pure integrity check shared with tests; the CLI accepts no custom catalog or clock. */
export function decodeLocalPillPhotoCatalog(bytes: Buffer, manifest: unknown): LocalPillPhotoCatalog {
  const checked = catalogManifestSchema.safeParse(manifest);
  if (!checked.success) throw new Error("local_catalog_manifest_invalid");
  const snapshot = decodeFrozenPillCatalog(bytes, checked.data.catalog);
  return {
    // Completeness describes the fixed collection, not its age. Keep its actual date in every result.
    catalog: { items: snapshot.items, totalCount: snapshot.totalCount, completeness: "complete", version: snapshot.version },
    metadata: {
      mode: "fixed_local_test_snapshot",
      verifiedAt: snapshot.verifiedAt,
      version: snapshot.version,
      records: snapshot.totalCount,
      sha256: checked.data.catalog.sha256,
    },
  };
}

/** Fixed local test data only: no network, photo/baseline reads, freshness override or arbitrary paths. */
export async function loadLocalPillPhotoCatalog(): Promise<LocalPillPhotoCatalog> {
  const rawManifest = await readBoundedFixtureFile(join(PILL_PHOTO_FIXTURE_DIRECTORY, "manifest.json"), 16 * 1024);
  let manifest: unknown;
  try { manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawManifest)); }
  catch { throw new Error("local_catalog_manifest_invalid"); }
  const checked = catalogManifestSchema.safeParse(manifest);
  if (!checked.success) throw new Error("local_catalog_manifest_invalid");
  const bytes = await readBoundedFixtureFile(join(PILL_PHOTO_FIXTURE_DIRECTORY, "catalog.json.gz"), checked.data.catalog.bytes);
  return decodeLocalPillPhotoCatalog(bytes, checked.data);
}
