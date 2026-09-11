// Runtime reads bounded immutable chunks, never the full offline snapshot.
import { createHash } from "node:crypto";
import { z } from "zod";
import type { OfficialPillItem } from "./official-pill-catalog.ts";
export { searchPillCandidateChunks } from "./pill-identification.ts";
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const PILL_WEB_CATALOG_PATH = "/pill-catalog/manifest.json";
export const PILL_WEB_CATALOG_MAX_AGE_MS = 168 * 3_600_000;
export const pillWebCatalogManifestSchema = z.object({
  schemaVersion: z.literal("pill-web-catalog.v1"),
  version: z.string().regex(/^mfds-pill-v1-[a-f0-9]{64}$/),
  verifiedAt: z.string().datetime(),
  totalCount: z.number().int().min(1).max(50_000),
  chunks: z.array(z.object({
    path: z.string().regex(/^\/pill-catalog\/[a-f0-9]{64}\.json$/),
    count: z.number().int().min(1).max(1000),
    bytes: z.number().int().min(1).max(2 * 1024 * 1024), sha256,
  }).strict()).min(1).max(100),
}).strict();
export type PillWebCatalogManifest = z.infer<typeof pillWebCatalogManifestSchema>;
export async function boundedPillResponse(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel(); throw new Error("catalog_unavailable");
  }
  const reader = response.body.getReader();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => undefined); }, 30_000);
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (timedOut) throw new Error("catalog_unavailable");
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) throw new Error("catalog_unavailable");
      parts.push(next.value);
    }
    return Buffer.concat(parts);
  } finally { clearTimeout(timer); await reader.cancel().catch(() => undefined); }
}
export async function readPillWebManifest(readAsset: (path: string) => Promise<Response>, now = Date.now()) {
  const bytes = await boundedPillResponse(await readAsset(PILL_WEB_CATALOG_PATH), 32 * 1024);
  const manifest = pillWebCatalogManifestSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  const age = now - Date.parse(manifest.verifiedAt);
  if (age < 0 || age > PILL_WEB_CATALOG_MAX_AGE_MS
    || manifest.chunks.reduce((sum, chunk) => sum + chunk.count, 0) !== manifest.totalCount
    || new Set(manifest.chunks.map(chunk => chunk.path)).size !== manifest.chunks.length
    || manifest.chunks.some(chunk => chunk.path !== `/pill-catalog/${chunk.sha256}.json`)) throw new Error("catalog_unavailable");
  return manifest;
}
export async function* readPillWebChunks(manifest: PillWebCatalogManifest, readAsset: (path: string) => Promise<Response>): AsyncGenerator<OfficialPillItem[]> {
  // Each chunk hash is pinned by the validated manifest. The exporter validates every record offline.
  for (const chunk of manifest.chunks) {
    const bytes = await boundedPillResponse(await readAsset(chunk.path), chunk.bytes);
    if (bytes.byteLength !== chunk.bytes || createHash("sha256").update(bytes).digest("hex") !== chunk.sha256) throw new Error("catalog_unavailable");
    const items: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(items) || items.length !== chunk.count) throw new Error("catalog_unavailable");
    yield items as OfficialPillItem[];
  }
}
