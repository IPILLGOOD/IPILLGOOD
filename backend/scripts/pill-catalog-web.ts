// Publish only a fresh, two-pass-verified official snapshot. No fixture fallback.
import { mkdir, mkdtemp, writeFile, rename, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { readBoundedJson } from "./pill-catalog.ts";
import { MAX_PILL_SNAPSHOT_BYTES, snapshotSearchCatalog, validatePillCatalogSnapshot } from "../src/pill-catalog-snapshot.ts";
import { pillWebCatalogManifestSchema } from "../src/pill-catalog-web.ts";

const args = process.argv.slice(2);
if (args.length !== 1) throw new Error("Usage: node --experimental-strip-types backend/scripts/pill-catalog-web.ts <fresh-catalog.json>");
const checked = validatePillCatalogSnapshot(await readBoundedJson(resolve(args[0]!), MAX_PILL_SNAPSHOT_BYTES));
if (!checked.ok) throw new Error(checked.reason);
const fresh = snapshotSearchCatalog(checked.snapshot, { now: new Date(), maxAgeHours: 168 });
if (!fresh.ok) throw new Error(fresh.reason);
const publicRoot = resolve("front/public");
await mkdir(publicRoot, { recursive: true });
const pending = await mkdtemp(join(publicRoot, ".pill-catalog-"));
try {
  const chunks = [];
  for (let at = 0; at < checked.snapshot.items.length; at += 1000) {
    const items = checked.snapshot.items.slice(at, at + 1000);
    const bytes = Buffer.from(JSON.stringify(items));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await writeFile(join(pending, `${sha256}.json`), bytes);
    chunks.push({ path: `/pill-catalog/${sha256}.json`, count: items.length, bytes: bytes.length, sha256 });
  }
  const manifest = pillWebCatalogManifestSchema.parse({ schemaVersion: "pill-web-catalog.v1", version: checked.snapshot.version,
    verifiedAt: checked.snapshot.verifiedAt, totalCount: checked.snapshot.totalCount, chunks });
  await writeFile(join(pending, "manifest.json"), JSON.stringify(manifest));
  // This is a generated, ignored build input. Failed validation never overwrites the last good export.
  await rm(join(publicRoot, "pill-catalog"), { recursive: true, force: true });
  await rename(pending, join(publicRoot, "pill-catalog"));
  console.log(JSON.stringify({ status: "exported", records: manifest.totalCount, chunks: chunks.length, verifiedAt: manifest.verifiedAt }));
} finally { await rm(pending, { recursive: true, force: true }); }
