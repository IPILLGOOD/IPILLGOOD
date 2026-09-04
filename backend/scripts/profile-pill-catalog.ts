import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { fetchOfficialPillPage, type OfficialPillItem } from "../src/official-pill-catalog.ts";
import { readOfficialApiResponse } from "../src/official-api-response.ts";
import { stableJson } from "../src/stable-json.ts";

const PAGE_SIZE = 100;
const PROFILE_FIELDS = ["FORM_CODE_NAME", "DRUG_SHAPE", "COLOR_CLASS1", "COLOR_CLASS2", "LINE_FRONT", "LINE_BACK"] as const;
const OPTIONAL_FIELDS = ["PRINT_FRONT", "PRINT_BACK", "MARK_CODE_FRONT_ANAL", "MARK_CODE_BACK_ANAL", "CHANGE_DATE", "IMG_REGIST_TS", "ITEM_IMAGE"] as const;
type RawItem = Record<string, unknown>;
type Frequency = Map<string, number>;

/** Deterministic coverage of page positions, NOT a random or representative sample. */
export function pillSamplePages(totalCount: number): number[] {
  if (!Number.isSafeInteger(totalCount) || totalCount < 0) throw new Error("invalid_total_count");
  const last = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  return [...new Set([1, Math.min(2, last), ...[0.25, 0.5, 0.75].map((fraction) => 1 + Math.floor((last - 1) * fraction)), last])].sort((a, b) => a - b);
}

const value = (raw: unknown) => raw === null || raw === undefined ? "" : String(raw).normalize("NFKC").trim();
const increment = (counts: Frequency, key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
const frequencies = (counts: Frequency) => [...counts].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([value, count]) => ({ value, count }));

function rawItems(payload: string): RawItem[] {
  // Used only after the production parser has validated the same payload and pagination.
  const parsed = JSON.parse(payload);
  const items = (parsed.response ?? parsed).body.items;
  if (!items) return [];
  return Array.isArray(items) ? items : Array.isArray(items.item) ? items.item : items.item ? [items.item] : [];
}

/** Read-only bounded audit. Never publishes a PillCatalog, downloads images or writes files. */
export async function profilePillCatalog(options: { apiKey?: string; fetcher?: typeof fetch } = {}) {
  const startedAt = new Date().toISOString();
  const sample: Array<{ raw: RawItem; item: OfficialPillItem }> = [];
  const pages: Array<{ pageNo: number; records: number; totalCount: number }> = [];
  let initialTotalCount: number | null = null;
  let plannedPages = [1];
  let failure: { pageNo: number; reason: string } | null = null;

  for (let index = 0; index < plannedPages.length; index++) {
    const pageNo = plannedPages[index]!;
    let payload: string | null = null;
    const result = await fetchOfficialPillPage({ pageNo, numOfRows: PAGE_SIZE }, {
      apiKey: options.apiKey,
      fetcher: async (input, init) => {
        const response = await (options.fetcher ?? fetch)(input, init);
        if (!response.ok) return response;
        payload = await readOfficialApiResponse(response, "json");
        return new Response(payload, { headers: { "content-type": "application/json" } });
      },
    });
    if (result.status !== "connected" || payload === null) {
      failure = { pageNo, reason: result.status === "unavailable" ? result.reason : result.status };
      break; // No automatic retries against access errors, rate limits or malformed pages.
    }
    if (initialTotalCount === null) {
      initialTotalCount = result.totalCount;
      plannedPages = pillSamplePages(initialTotalCount);
    }
    pages.push({ pageNo, records: result.items.length, totalCount: result.totalCount });
    if (result.totalCount !== initialTotalCount) {
      failure = { pageNo, reason: "total_count_changed" };
      break; // A changing count is not a consistent snapshot.
    }
    const raw = rawItems(payload);
    result.items.forEach((item, index) => sample.push({ raw: raw[index]!, item }));
  }

  const distributions = Object.fromEntries(PROFILE_FIELDS.map((field) => [field, new Map<string, number>()])) as Record<typeof PROFILE_FIELDS[number], Frequency>;
  const missingFields = Object.fromEntries([...PROFILE_FIELDS, ...OPTIONAL_FIELDS].map((field) => [field, 0])) as Record<string, number>;
  const forms: Frequency = new Map();
  const colors: Frequency = new Map();
  const imageOrigins: Frequency = new Map();
  const itemOccurrences = new Map<string, number>();
  const appearanceSignatures = new Map<string, Set<string>>();
  const uniqueRawRecords = new Set<string>();
  const unknownForms: Frequency = new Map();
  const descriptionExamples: Array<Record<string, unknown>> = [];
  const otherHangulExamples: Array<Record<string, unknown>> = [];
  const imprintDescriptionCounts = { scoreLine: 0, mark: 0, otherHangul: 0 };
  let missingImageUrls = 0;
  let rejectedImageUrls = 0;
  let invalidChangedDates = 0;
  let invalidImageDates = 0;
  const changedDates: string[] = [];

  for (const { raw, item } of sample) {
    for (const field of PROFILE_FIELDS) increment(distributions[field], value(raw[field]));
    for (const field of Object.keys(missingFields)) if (!value(raw[field])) missingFields[field]!++;
    increment(forms, item.form);
    for (const color of item.colors) increment(colors, color);
    if (item.form === "unknown") increment(unknownForms, item.formName ?? "");
    increment(itemOccurrences, item.itemSeq);
    const signatures = appearanceSignatures.get(item.itemSeq) ?? new Set<string>();
    signatures.add(stableJson({ formName: item.formName, shape: item.shape, colors: item.colors, front: item.front, back: item.back, imageUrl: item.imageUrl }));
    appearanceSignatures.set(item.itemSeq, signatures);
    uniqueRawRecords.add(stableJson(raw));
    if (!value(raw.ITEM_IMAGE)) missingImageUrls++;
    else if (!item.imageUrl) rejectedImageUrls++;
    if (value(raw.ITEM_IMAGE)) {
      try { increment(imageOrigins, new URL(value(raw.ITEM_IMAGE)).origin); }
      catch { increment(imageOrigins, "invalid_url"); }
    }
    if (value(raw.CHANGE_DATE) && !item.source.changedAt) invalidChangedDates++;
    if (value(raw.IMG_REGIST_TS) && !item.source.imageRegisteredAt) invalidImageDates++;
    if (item.source.changedAt) changedDates.push(item.source.changedAt);
    for (const suffix of ["FRONT", "BACK"] as const) {
      const imprint = value(raw[`PRINT_${suffix}`]);
      if (imprint.includes("분할선")) imprintDescriptionCounts.scoreLine++;
      if (imprint.includes("마크")) imprintDescriptionCounts.mark++;
      const example = { itemSeq: item.itemSeq, side: suffix, rawImprint: imprint.slice(0, 100), rawLine: value(raw[`LINE_${suffix}`]), normalized: suffix === "FRONT" ? item.front : item.back };
      if (/분할선|마크/.test(imprint)) {
        if (descriptionExamples.length < 16) descriptionExamples.push(example);
      } else if (/[가-힣]/.test(imprint)) {
        imprintDescriptionCounts.otherHangul++;
        if (otherHangulExamples.length < 8) otherHangulExamples.push(example);
      }
    }
  }
  changedDates.sort();
  return {
    status: failure ? "incomplete" : "sampled",
    scope: "deterministic_page_sample_not_search_catalog",
    startedAt, finishedAt: new Date().toISOString(), pageSize: PAGE_SIZE, plannedPages, pages, failure,
    initialTotalCount, sampledRecords: sample.length, uniqueItemSeqs: itemOccurrences.size,
    exactDuplicateRows: sample.length - uniqueRawRecords.size,
    repeatedItemSeqs: [...itemOccurrences].filter(([, count]) => count > 1).map(([itemSeq, records]) => ({ itemSeq, records, distinctAppearances: appearanceSignatures.get(itemSeq)!.size })),
    distributions: Object.fromEntries(PROFILE_FIELDS.map((field) => [field, frequencies(distributions[field])])),
    normalizedForms: frequencies(forms), normalizedColors: frequencies(colors), unknownForms: frequencies(unknownForms),
    missingFields, imprintDescriptionCounts, descriptionExamples, otherHangulExamples,
    images: { origins: frequencies(imageOrigins), missingImageUrls, rejectedImageUrls, downloaded: 0 },
    dates: { invalidChangedDates, invalidImageDates, earliestChangedDate: changedDates[0] ?? null, latestChangedDate: changedDates.at(-1) ?? null },
  };
}

export function serializePillProfile(report: unknown, environment: Record<string, string | undefined> = process.env): string {
  const secrets = new Set<string>();
  for (const [name, secret] of Object.entries(environment)) {
    if (!/(?:KEY|SECRET|TOKEN|PASSWORD)/i.test(name) || !secret) continue;
    secrets.add(secret);
    secrets.add(encodeURIComponent(secret));
    try { secrets.add(decodeURIComponent(secret)); } catch { /* raw secret */ }
  }
  const variants = [...secrets].sort((a, b) => b.length - a.length);
  // Replace string values, not serialized JSON syntax or numeric counters.
  return JSON.stringify(report, (_key, value: unknown) => {
    if (typeof value !== "string") return value;
    return variants.reduce((redacted, secret) => redacted.replaceAll(secret, "[REDACTED]"), value);
  }, 2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3 || process.argv[2] !== "--live") {
    console.error("Explicit --live is required. Run from the repository root with node --env-file=front/.env.local --experimental-strip-types backend/scripts/profile-pill-catalog.ts --live");
    process.exitCode = 1;
  } else {
    try {
      const report = await profilePillCatalog();
      // Defense in depth: redact configured secrets even if an upstream echoes them in a field.
      console.log(serializePillProfile(report));
      if (report.status !== "sampled") process.exitCode = 1;
    } catch {
      console.error("Pill catalog profiling failed; raw errors and credentials are suppressed.");
      process.exitCode = 1;
    }
  }
}
