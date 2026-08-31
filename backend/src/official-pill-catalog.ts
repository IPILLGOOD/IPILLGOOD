import { z } from "zod";
import { OfficialApiResponseError, parseOfficialXml, readOfficialApiResponse, type OfficialApiFormat } from "./official-api-response.ts";

export const PILL_SOURCE_URL = "https://www.data.go.kr/data/15057639/openapi.do";
export const PILL_API_ENDPOINT = "https://apis.data.go.kr/1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03";

export type PillForm = "tablet" | "capsule" | "unknown";
export type PillScoreLine = "none" | "single" | "cross" | "other" | "unknown";

export interface OfficialPillSide {
  imprint: string | null;
  scoreLine: PillScoreLine;
  mark: string | null;
}

export interface OfficialPillItem {
  itemSeq: string;
  productName: string;
  manufacturer: string | null;
  form: PillForm;
  formName: string | null;
  shape: string | null;
  colors: string[];
  front: OfficialPillSide;
  back: OfficialPillSide;
  imageUrl: string | null;
  source: {
    url: typeof PILL_SOURCE_URL;
    fetchedAt: string;
    changedAt: string | null;
    imageRegisteredAt: string | null;
  };
}

export interface OfficialPillPage {
  pageNo: number;
  numOfRows: number;
  totalCount: number;
  items: OfficialPillItem[];
}

const requestSchema = z.object({
  pageNo: z.number().int().min(1).max(100_000).default(1),
  numOfRows: z.number().int().min(1).max(100).default(100),
  itemSeq: z.string().regex(/^\d{9}$/).optional(),
}).strict();

export type OfficialPillPageRequest = z.input<typeof requestSchema>;
export type OfficialPillPageResult =
  | ({ status: "connected" } & OfficialPillPage)
  | { status: "not_configured" | "invalid_input"; items: []; sourceUrl: string }
  | { status: "unavailable"; reason: "access_denied" | "rate_limited" | "api_error"; items: []; sourceUrl: string };

function invalidResponse(): never {
  throw new OfficialApiResponseError("invalid_pill_response");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalidResponse();
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") return invalidResponse();
  const result = String(value).normalize("NFKC").trim();
  if (result.length > 4_000) return invalidResponse();
  return result || null;
}

function count(value: unknown, min: number) {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value))) return invalidResponse();
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min) return invalidResponse();
  return result;
}

function officialDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw || !/^(?:\d{8}|\d{14})$/.test(raw)) return null;
  const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date ? date : null;
}

function imageUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const officialHosts = ["nedrug.mfds.go.kr", "health.kr", "www.health.kr", "common.health.kr"];
    if (url.protocol !== "https:" || url.username || url.password || url.port || !officialHosts.includes(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

function scoreLine(value: unknown): PillScoreLine {
  const line = text(value);
  if (!line) return "unknown";
  if (line === "없음") return "none";
  if (line === "-") return "single";
  if (line === "+") return "cross";
  return "other";
}

function side(item: Record<string, unknown>, suffix: "FRONT" | "BACK"): OfficialPillSide {
  return {
    // An empty field may be missing data. It is not proof of an unmarked surface.
    imprint: text(item[`PRINT_${suffix}`]),
    scoreLine: scoreLine(item[`LINE_${suffix}`]),
    mark: text(item[`MARK_CODE_${suffix}_ANAL`]),
  };
}

function normalizeItem(raw: unknown, fetchedAt: string): OfficialPillItem {
  const item = record(raw);
  const itemSeq = text(item.ITEM_SEQ);
  const productName = text(item.ITEM_NAME);
  if (!itemSeq || !/^\d{9}$/.test(itemSeq) || !productName) return invalidResponse();
  const formName = text(item.FORM_CODE_NAME);
  const form: PillForm = formName?.includes("캡슐") ? "capsule"
    : formName && /(?:정|정제)$/.test(formName) ? "tablet" : "unknown";
  const colors = [...new Set([text(item.COLOR_CLASS1), text(item.COLOR_CLASS2)]
    .flatMap((color) => color?.split("|").map((part) => part.trim()).filter(Boolean) ?? []))].sort();
  return {
    itemSeq, productName, manufacturer: text(item.ENTP_NAME), form, formName,
    shape: text(item.DRUG_SHAPE), colors, front: side(item, "FRONT"), back: side(item, "BACK"),
    imageUrl: imageUrl(item.ITEM_IMAGE),
    source: { url: PILL_SOURCE_URL, fetchedAt, changedAt: officialDate(item.CHANGE_DATE), imageRegisteredAt: officialDate(item.IMG_REGIST_TS) },
  };
}

export function parseOfficialPillPage(payload: string, format: OfficialApiFormat, fetchedAt: string): OfficialPillPage {
  if (!Number.isFinite(Date.parse(fetchedAt))) return invalidResponse();
  const parsed = record(format === "json" ? JSON.parse(payload) : parseOfficialXml(payload));
  const envelope = record(parsed.response ?? parsed);
  const header = record(envelope.header);
  if (!["00", "0000"].includes(String(header.resultCode))) return invalidResponse();
  const body = record(envelope.body);
  const pageNo = count(body.pageNo, 1);
  const numOfRows = count(body.numOfRows, 1);
  const totalCount = count(body.totalCount, 0);
  const container = body.items;
  let rawItems: unknown[];
  if (container === null || container === undefined || container === "") rawItems = [];
  else if (Array.isArray(container)) rawItems = container;
  else {
    const nested = record(container);
    if (!("item" in nested)) return invalidResponse();
    rawItems = nested.item === null || nested.item === "" ? [] : Array.isArray(nested.item) ? nested.item : [nested.item];
  }
  const expected = Math.min(numOfRows, Math.max(0, totalCount - (pageNo - 1) * numOfRows));
  if (rawItems.length !== expected) return invalidResponse();
  // Do not collapse ITEM_SEQ: one product can have multiple official appearance records.
  return { pageNo, numOfRows, totalCount, items: rawItems.map((item) => normalizeItem(item, fetchedAt)) };
}

/** Server-only, bounded catalog-page reader. Not an appearance-search endpoint. */
export async function fetchOfficialPillPage(
  request: OfficialPillPageRequest = {},
  options: { apiKey?: string; fetcher?: typeof fetch; now?: Date } = {},
): Promise<OfficialPillPageResult> {
  const parsed = requestSchema.safeParse(request);
  if (!parsed.success) return { status: "invalid_input", items: [], sourceUrl: PILL_SOURCE_URL };
  const apiKey = (options.apiKey ?? (process.env.MFDS_PILL_API_KEY?.trim() || process.env.MFDS_MEDICATION_API_KEY))?.trim();
  if (!apiKey) return { status: "not_configured", items: [], sourceUrl: PILL_SOURCE_URL };
  const unavailable = (reason: "access_denied" | "rate_limited" | "api_error"): OfficialPillPageResult =>
    ({ status: "unavailable", reason, items: [], sourceUrl: PILL_SOURCE_URL });
  try {
    let decodedKey = apiKey;
    try { decodedKey = decodeURIComponent(apiKey); } catch { /* already a raw key */ }
    const endpoint = new URL(PILL_API_ENDPOINT);
    endpoint.searchParams.set("serviceKey", decodedKey);
    endpoint.searchParams.set("type", "json");
    endpoint.searchParams.set("pageNo", String(parsed.data.pageNo));
    endpoint.searchParams.set("numOfRows", String(parsed.data.numOfRows));
    if (parsed.data.itemSeq) endpoint.searchParams.set("item_seq", parsed.data.itemSeq);
    const response = await (options.fetcher ?? fetch)(endpoint, {
      headers: { Accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 401 || response.status === 403) return unavailable("access_denied");
    if (response.status === 429) return unavailable("rate_limited");
    if (!response.ok) return unavailable("api_error");
    const payload = await readOfficialApiResponse(response, "json");
    const page = parseOfficialPillPage(payload, "json", (options.now ?? new Date()).toISOString());
    if (page.pageNo !== parsed.data.pageNo || page.numOfRows !== parsed.data.numOfRows ||
        (parsed.data.itemSeq && page.items.some((item) => item.itemSeq !== parsed.data.itemSeq))) return unavailable("api_error");
    return { status: "connected", ...page };
  } catch {
    // URLs, reflected gateway errors and raw payloads can contain credentials. Never log them.
    return unavailable("api_error");
  }
}
