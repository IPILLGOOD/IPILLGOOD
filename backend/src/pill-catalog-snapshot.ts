import { createHash } from "node:crypto";
import { z } from "zod";
import { fetchOfficialPillPage, PILL_API_ENDPOINT, PILL_SOURCE_URL, type OfficialPillItem, type OfficialPillPageRequest, type OfficialPillPageResult } from "./official-pill-catalog.ts";
import { type PillCatalog } from "./pill-identification.ts";
import { stableJson } from "./stable-json.ts";

// Local/offline tooling only. Do not load the full snapshot in a Worker request.
export const PILL_NORMALIZATION_VERSION = "mfds-pill-2026-08-31-v1";
export const MAX_PILL_SNAPSHOT_BYTES = 64 * 1024 * 1024;
const PAGE_SIZE = 100;
const MAX_RECORDS = 50_000;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const text = z.string().min(1).max(4_000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
});
const timestamp = z.string().datetime();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const side = z.object({
  rawImprint: text.nullable(), imprint: text.nullable(), imprintHasDescription: z.boolean(),
  scoreLine: z.enum(["none", "single", "cross", "other", "unknown"]), mark: text.nullable(),
}).strict();
const itemSchema = z.object({
  itemSeq: z.string().regex(/^\d{9}$/), productName: text, manufacturer: text.nullable(),
  form: z.enum(["tablet", "capsule", "unknown"]), formName: text.nullable(), shape: text.nullable(),
  colors: z.array(text).max(8_000), front: side, back: side,
  imageUrl: z.string().max(4_000).refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.port
        && ["nedrug.mfds.go.kr", "health.kr", "www.health.kr", "common.health.kr"].includes(url.hostname);
    } catch { return false; }
  }).nullable(),
  source: z.object({ url: z.literal(PILL_SOURCE_URL), fetchedAt: timestamp, changedAt: date.nullable(), imageRegisteredAt: date.nullable() }).strict(),
}).strict();
const passSchema = z.object({ startedAt: timestamp, finishedAt: timestamp, pages: z.number().int().positive(), records: z.number().int().positive(), digest }).strict();
const snapshotSchema = z.object({
  schemaVersion: z.literal(1), normalizationVersion: z.literal(PILL_NORMALIZATION_VERSION),
  sourceUrl: z.literal(PILL_SOURCE_URL), endpoint: z.literal(PILL_API_ENDPOINT), scope: z.literal("full_catalog"),
  version: z.string(), totalCount: z.number().int().positive().max(MAX_RECORDS), verifiedAt: timestamp,
  verification: z.object({ method: z.literal("two_pass_consistent"), pageSize: z.literal(PAGE_SIZE), passes: z.tuple([passSchema, passSchema]) }).strict(),
  items: z.array(itemSchema).min(1).max(MAX_RECORDS),
}).strict();

export type PillCatalogSnapshot = z.infer<typeof snapshotSchema>;
export type PillCollectionProgress = { pass: number; pageNo: number; totalPages: number; totalCount: number; requests: number };
export type PillCollectionResult =
  | { status: "collected"; requests: number; snapshot: PillCatalogSnapshot }
  | { status: "incomplete"; requests: number; reason: string; pass: number; pageNo: number };

/** Hash preserved official fields, NOT fetch time, upstream bytes or photo-identification accuracy. */
function itemDigest(item: OfficialPillItem): string {
  const source = { url: item.source.url, changedAt: item.source.changedAt, imageRegisteredAt: item.source.imageRegisteredAt };
  return hash(stableJson({ ...item, source }));
}
function catalogDigest(hashes: string[]): string {
  return hash(`${PILL_NORMALIZATION_VERSION}\n${[...hashes].sort().join("\n")}`);
}

/** Two complete, bounded scans; no writes, retries, resume or synthetic fallback. */
export async function collectPillCatalogSnapshot(options: {
  readPage?: (request: OfficialPillPageRequest) => Promise<OfficialPillPageResult>;
  maxRequests?: number;
  maxDurationMs?: number;
  now?: () => Date;
  beforeRequest?: () => Promise<void>;
  onProgress?: (progress: PillCollectionProgress) => void;
} = {}): Promise<PillCollectionResult> {
  const readPage = options.readPage ?? fetchOfficialPillPage;
  const now = options.now ?? (() => new Date());
  const maxRequests = options.maxRequests ?? 600;
  const maxDurationMs = options.maxDurationMs ?? 10 * 60_000;
  let requests = 0;
  let pass = 1;
  let pageNo = 1;
  const fail = (reason: string): PillCollectionResult => ({ status: "incomplete", requests, reason, pass, pageNo });
  if (!Number.isInteger(maxRequests) || maxRequests < 2 || maxRequests > 2_000
    || !Number.isInteger(maxDurationMs) || maxDurationMs < 1 || maxDurationMs > 30 * 60_000) return fail("invalid_options");
  const started = now().getTime();
  if (!Number.isFinite(started)) return fail("invalid_clock");
  let totalCount: number | null = null;
  let totalPages = 1;
  const items: OfficialPillItem[] = [];
  const passes: Array<z.infer<typeof passSchema>> = [];
  let contentBytes = 0;
  try {
    for (pass = 1; pass <= 2; pass++) {
      const passStartedAt = now().toISOString();
      const hashes: string[] = [];
      const unique = new Set<string>();
      for (pageNo = 1; pageNo <= totalPages; pageNo++) {
        if (requests >= maxRequests) return fail("request_budget_exceeded");
        if (requests > 0) await options.beforeRequest?.();
        if (now().getTime() - started >= maxDurationMs) return fail("time_budget_exceeded");
        requests++;
        const page = await readPage({ pageNo, numOfRows: PAGE_SIZE });
        if (page.status !== "connected") return fail(page.status === "unavailable" ? page.reason : page.status);
        if (!Number.isSafeInteger(page.totalCount) || page.totalCount < 0 || page.totalCount > MAX_RECORDS) return fail("record_budget_exceeded");
        if (totalCount === null) {
          totalCount = page.totalCount;
          if (totalCount === 0) return fail("empty_catalog_review_required");
          totalPages = Math.ceil(totalCount / PAGE_SIZE);
          if (totalPages * 2 > maxRequests) return fail("request_budget_exceeded");
        }
        if (page.totalCount !== totalCount) return fail("total_count_changed");
        if (page.pageNo !== pageNo || page.numOfRows !== PAGE_SIZE || page.items.length !== Math.min(PAGE_SIZE, totalCount - (pageNo - 1) * PAGE_SIZE)) return fail("invalid_page");
        const checked = z.array(itemSchema).safeParse(page.items);
        if (!checked.success) return fail("invalid_record");
        for (const item of checked.data) {
          const signature = itemDigest(item);
          // Repeated source rows may be legitimate, but require review rather than silent deduplication.
          if (unique.has(signature)) return fail("duplicate_records_review_required");
          unique.add(signature);
          hashes.push(signature);
          if (pass === 1) {
            contentBytes += Buffer.byteLength(JSON.stringify(item)) + 1;
            if (contentBytes > MAX_PILL_SNAPSHOT_BYTES - 8_192) return fail("snapshot_size_exceeded");
            items.push(item);
          }
        }
        options.onProgress?.({ pass, pageNo, totalPages, totalCount, requests });
      }
      passes.push({ startedAt: passStartedAt, finishedAt: now().toISOString(), pages: totalPages, records: hashes.length, digest: catalogDigest(hashes) });
    }
    pass = 2;
    pageNo = totalPages;
    if (passes[0]!.digest !== passes[1]!.digest) return fail("content_changed_between_passes");
    const snapshot: PillCatalogSnapshot = {
      schemaVersion: 1, normalizationVersion: PILL_NORMALIZATION_VERSION, sourceUrl: PILL_SOURCE_URL, endpoint: PILL_API_ENDPOINT,
      scope: "full_catalog", version: `mfds-pill-v1-${passes[0]!.digest}`, totalCount: totalCount!, verifiedAt: passes[1]!.finishedAt,
      verification: { method: "two_pass_consistent", pageSize: PAGE_SIZE, passes: [passes[0]!, passes[1]!] }, items,
    };
    const checked = validatePillCatalogSnapshot(snapshot);
    if (!checked.ok) return fail(checked.reason);
    return { status: "collected", requests, snapshot: checked.snapshot };
  } catch {
    return fail("collection_failed"); // Never expose upstream/FS errors or credentials.
  }
}

/** Local integrity checks are NOT a signature or proof that the upstream supplied an atomic snapshot. */
export function validatePillCatalogSnapshot(value: unknown):
  | { ok: true; snapshot: PillCatalogSnapshot }
  | { ok: false; reason: string } {
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: "invalid_snapshot" };
  const snapshot = parsed.data;
  const [first, second] = snapshot.verification.passes;
  const times = [first.startedAt, first.finishedAt, second.startedAt, second.finishedAt, snapshot.verifiedAt].map(Date.parse);
  const hashes = snapshot.items.map(itemDigest);
  const actualDigest = catalogDigest(hashes);
  if (snapshot.totalCount !== snapshot.items.length || new Set(hashes).size !== hashes.length
    || snapshot.version !== `mfds-pill-v1-${actualDigest}`
    || [first, second].some((entry) => entry.digest !== actualDigest || entry.records !== snapshot.totalCount || entry.pages !== Math.ceil(snapshot.totalCount / PAGE_SIZE))
    || times.some((time, index) => index > 0 && time < times[index - 1]!) || snapshot.verifiedAt !== second.finishedAt
    || snapshot.items.some((item) => Date.parse(item.source.fetchedAt) < times[0]! || Date.parse(item.source.fetchedAt) > times[1]!)) {
    return { ok: false, reason: "snapshot_integrity_failed" };
  }
  return { ok: true, snapshot };
}

/** Explicit local freshness policy; do not silently use stale data or a partial page as complete. */
export function snapshotSearchCatalog(snapshot: PillCatalogSnapshot, options: { now: Date; maxAgeHours: number }):
  | { ok: true; catalog: PillCatalog }
  | { ok: false; reason: string } {
  if (!Number.isFinite(options.now.getTime()) || !Number.isInteger(options.maxAgeHours) || options.maxAgeHours < 1 || options.maxAgeHours > 168) return { ok: false, reason: "invalid_freshness_policy" };
  const checked = validatePillCatalogSnapshot(snapshot);
  if (!checked.ok) return checked;
  const age = options.now.getTime() - Date.parse(checked.snapshot.verifiedAt);
  if (age < 0 || age > options.maxAgeHours * 3_600_000) return { ok: false, reason: "snapshot_expired_or_future" };
  return { ok: true, catalog: { items: checked.snapshot.items, totalCount: checked.snapshot.totalCount, completeness: "complete", version: checked.snapshot.version } };
}
