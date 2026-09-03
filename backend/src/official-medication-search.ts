import {
  parseOfficialXml,
  readOfficialApiResponse,
  safeOfficialApiErrorCode,
  type OfficialApiFormat,
} from "./official-api-response.ts";
import { parsePharmacogenomicResponse } from "./official-medication-api.ts";

const DEFAULT_PRODUCT_API_URL =
  "https://apis.data.go.kr/1471000/DrugPrdtPrmsnInfoService07";
const DEFAULT_EASY_DRUG_API_URL =
  "https://apis.data.go.kr/1471000/DrbEasyDrugInfoService";
const DEFAULT_PHARMACOGENOMIC_API_URL =
  "https://apis.data.go.kr/1471000/ParmgenService";

export const PRODUCT_SOURCE_URL = "https://www.data.go.kr/data/15095677/openapi.do";
export const EASY_DRUG_SOURCE_URL = "https://www.data.go.kr/data/15075057/openapi.do";
export const PHARMACOGENOMIC_SOURCE_URL =
  "https://www.data.go.kr/data/15102548/openapi.do";

type DataFormat = OfficialApiFormat;
type Fetcher = typeof fetch;
type MatchType = "product_name" | "ingredient";
type EnrichmentStatus = "complete" | "no_match" | "unavailable";
type ConsumerInformationStatus = EnrichmentStatus | "partial";
type PlainLanguageStatus = "complete" | "partial" | "not_configured" | "unavailable" | "no_source";

export interface SearchOptions {
  apiKey?: string;
  pharmacogenomicApiKey?: string;
  productApiUrl?: string;
  easyDrugApiUrl?: string;
  pharmacogenomicApiUrl?: string;
  openAiApiKey?: string;
  openAiModel?: string;
  simplifier?: MedicationSearchSimplifier;
  fetcher?: Fetcher;
  format?: DataFormat;
}

interface ParsedProductResponse {
  items: OfficialMedicationSearchItem[];
  totalCount: number;
}

interface EasyDrugInformation {
  itemSeq: string;
  productName: string;
  manufacturer: string;
  efficacy: string;
  usage: string;
  warning: string;
  precautions: string;
  interactions: string;
  adverseEffects: string;
  storage: string;
  imageUrl?: string;
  openedAt: string;
  updatedAt: string;
}

interface ProductPermitDetailInformation {
  itemSeq: string;
  efficacy: string;
  usage: string;
  precautions: string;
  storage: string;
}

type MedicationSearchSimplifier = (
  items: OfficialMedicationSearchItem[],
  options?: { apiKey?: string; model?: string },
) => Promise<OfficialMedicationSearchItem[]>;

export interface OfficialMedicationSource {
  kind: "product_permit" | "easy_drug" | "pharmacogenomic";
  label: string;
  url: string;
}

export interface OfficialMedicationConsumerInfo {
  source: "easy_drug" | "product_permit";
  efficacy: string;
  usage: string;
  warning: string;
  precautions: string;
  interactions: string;
  adverseEffects: string;
  storage: string;
  openedAt: string;
  updatedAt: string;
}

export interface OfficialMedicationPlainExplanation {
  categoryPlain: string;
  overview: string;
  usagePlain: string;
  safetyPlain: string;
  genePlain: string;
  caregiverNote: string;
}

export interface OfficialMedicationPharmacogenomicInfo {
  koreanName: string;
  englishName: string;
  generalInfo: string;
  geneInfo: string;
  productInfo: string;
}

export interface OfficialMedicationSearchItem {
  itemSeq: string;
  productName: string;
  englishName: string;
  ingredientName: string;
  manufacturer: string;
  classification: string;
  productType: string;
  matchType: MatchType;
  imageUrl?: string;
  consumerInfo?: OfficialMedicationConsumerInfo;
  pharmacogenomicInfo?: OfficialMedicationPharmacogenomicInfo;
  plainExplanation?: OfficialMedicationPlainExplanation;
  sources: OfficialMedicationSource[];
}

export type OfficialMedicationLookupResult =
  | {
      status: "connected";
      items: OfficialMedicationSearchItem[];
      totalCount: number;
      sourceUrl: string;
      productQueryStatus: "complete" | "partial";
      easyDrugStatus: EnrichmentStatus;
      consumerInformationStatus: ConsumerInformationStatus;
      pharmacogenomicStatus: EnrichmentStatus;
      plainLanguageStatus: PlainLanguageStatus;
    }
  | {
      status: "not_configured";
      items: [];
      totalCount: 0;
      sourceUrl: string;
      message: string;
    }
  | {
      status: "unavailable";
      items: [];
      totalCount: 0;
      sourceUrl: string;
      message: string;
      reason: "api_error" | "rate_limited";
    };

export type OfficialMedicationCodeVerification =
  | { status: "matched"; item: OfficialMedicationSearchItem; sourceUrl: string }
  | { status: "not_found" | "not_configured" | "unavailable"; sourceUrl: string };

const productSource: OfficialMedicationSource = {
  kind: "product_permit",
  label: "식약처 의약품 제품 허가정보",
  url: PRODUCT_SOURCE_URL,
};

const easyDrugSource: OfficialMedicationSource = {
  kind: "easy_drug",
  label: "식약처 의약품개요정보(e약은요)",
  url: EASY_DRUG_SOURCE_URL,
};

const pharmacogenomicSource: OfficialMedicationSource = {
  kind: "pharmacogenomic",
  label: "식약처 약물 유전 정보",
  url: PHARMACOGENOMIC_SOURCE_URL,
};

async function defaultMedicationSearchSimplifier(
  items: OfficialMedicationSearchItem[],
  options?: { apiKey?: string; model?: string },
) {
  const { simplifyOfficialMedicationSearchItemsWithOpenAI } = await import(
    "./ai/openai-medical.ts"
  );
  return simplifyOfficialMedicationSearchItemsWithOpenAI(items, options);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function plainOfficialText(value: unknown): string {
  return asString(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function plainPermitDocument(value: unknown): string {
  return plainOfficialText(
    asString(value)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(
        /<(?:DOC|SECTION|ARTICLE)\b[^>]*\btitle=(?:"([^"]*)"|'([^']*)')[^>]*>/gi,
        (_match, doubleQuoted: string | undefined, singleQuoted: string | undefined) =>
          `\n${doubleQuoted ?? singleQuoted ?? ""}\n`,
      )
      .replace(/<PARAGRAPH\b[^>]*>/gi, "\n")
      .replace(/<BR\b[^>]*\/?\s*>/gi, "\n"),
  );
}

function safeHttpUrl(value: unknown): string | undefined {
  const candidate = asString(value);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function normalizedServiceKey(value: string): string {
  const key = value.trim();
  if (!/%[\da-f]{2}/i.test(key)) return key;
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

function parsePayload(payload: string, format: DataFormat): unknown {
  if (format === "json") return JSON.parse(payload) as unknown;
  return parseOfficialXml(payload);
}

function responseBody(payload: string, format: DataFormat): Record<string, unknown> {
  const parsed = asRecord(parsePayload(payload, format));
  const response = asRecord(parsed?.response) ?? parsed;
  const header = asRecord(response?.header);
  const body = asRecord(response?.body);
  const resultCode = asString(header?.resultCode);

  if (!header || !body || !["00", "0000"].includes(resultCode)) {
    throw new Error(asString(header?.resultMsg) || "공식 의약품 응답을 확인하지 못했습니다.");
  }
  return body;
}

function responseItems(body: Record<string, unknown>): Record<string, unknown>[] {
  const containers = Array.isArray(body.items) ? body.items : [body.items];
  return containers.flatMap((container) => {
    const item = asRecord(container)?.item ?? container;
    const values = Array.isArray(item) ? item : [item];
    return values.flatMap((value) => {
      const record = asRecord(value);
      return record ? [record] : [];
    });
  });
}

export function parseProductPermitResponse(
  payload: string,
  format: DataFormat,
  matchType: MatchType,
): ParsedProductResponse {
  const body = responseBody(payload, format);
  const items = responseItems(body).flatMap((item): OfficialMedicationSearchItem[] => {
    const itemSeq = asString(item.ITEM_SEQ);
    const productName = plainOfficialText(item.ITEM_NAME);
    if (!itemSeq || !productName) return [];
    const imageUrl = safeHttpUrl(item.BIG_PRDT_IMG_URL);

    return [{
      itemSeq,
      productName,
      englishName: plainOfficialText(item.ITEM_ENG_NAME),
      ingredientName: plainOfficialText(item.ITEM_INGR_NAME),
      manufacturer: plainOfficialText(item.ENTP_NAME),
      classification: plainOfficialText(item.SPCLTY_PBLC),
      productType: plainOfficialText(item.PRDUCT_TYPE),
      matchType,
      ...(imageUrl ? { imageUrl } : {}),
      sources: [productSource],
    }];
  });

  return { items, totalCount: asNumber(body.totalCount) };
}

export function parseEasyDrugResponse(payload: string, format: DataFormat) {
  const body = responseBody(payload, format);
  const items = responseItems(body).flatMap((item): EasyDrugInformation[] => {
    const itemSeq = asString(item.itemSeq);
    const productName = plainOfficialText(item.itemName);
    if (!itemSeq || !productName) return [];
    const imageUrl = safeHttpUrl(item.itemImage);

    return [{
      itemSeq,
      productName,
      manufacturer: plainOfficialText(item.entpName),
      efficacy: plainOfficialText(item.efcyQesitm),
      usage: plainOfficialText(item.useMethodQesitm),
      warning: plainOfficialText(item.atpnWarnQesitm),
      precautions: plainOfficialText(item.atpnQesitm),
      interactions: plainOfficialText(item.intrcQesitm),
      adverseEffects: plainOfficialText(item.seQesitm),
      storage: plainOfficialText(item.depositMethodQesitm),
      ...(imageUrl ? { imageUrl } : {}),
      openedAt: asString(item.openDe),
      updatedAt: asString(item.updateDe),
    }];
  });
  return { items, totalCount: asNumber(body.totalCount) };
}

export function parseProductPermitDetailResponse(payload: string, format: DataFormat) {
  const body = responseBody(payload, format);
  const items = responseItems(body).flatMap((item): ProductPermitDetailInformation[] => {
    const itemSeq = asString(item.ITEM_SEQ);
    if (!itemSeq) return [];
    const detail = {
      itemSeq,
      efficacy: plainPermitDocument(item.EE_DOC_DATA),
      usage: plainPermitDocument(item.UD_DOC_DATA),
      precautions: plainPermitDocument(item.NB_DOC_DATA),
      storage: plainOfficialText(item.STORAGE_METHOD),
    };
    return detail.efficacy || detail.usage || detail.precautions || detail.storage ? [detail] : [];
  });
  return { items, totalCount: asNumber(body.totalCount) };
}

async function fetchOfficialPayload(
  endpoint: URL,
  format: DataFormat,
  fetcher: Fetcher,
) {
  const response = await fetcher(endpoint, {
    headers: {
      Accept: format === "json" ? "application/json" : "application/xml, text/xml",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return readOfficialApiResponse(response, format);
}

async function fetchProductMatches(
  query: string,
  matchType: MatchType,
  options: Required<Pick<SearchOptions, "apiKey" | "productApiUrl" | "fetcher" | "format">>,
) {
  const endpoint = new URL(
    `${options.productApiUrl.replace(/\/$/, "")}/getDrugPrdtPrmsnInq07`,
  );
  endpoint.searchParams.set("serviceKey", options.apiKey);
  endpoint.searchParams.set("pageNo", "1");
  endpoint.searchParams.set("numOfRows", "10");
  endpoint.searchParams.set("type", options.format);
  endpoint.searchParams.set(matchType === "product_name" ? "item_name" : "item_ingr_name", query);
  const payload = await fetchOfficialPayload(endpoint, options.format, options.fetcher);
  return parseProductPermitResponse(payload, options.format, matchType);
}

export async function verifyOfficialMedicationCode(
  itemCode: string,
  options: SearchOptions = {},
): Promise<OfficialMedicationCodeVerification> {
  const normalizedCode = itemCode.trim();
  if (!/^\d{6,12}$/.test(normalizedCode)) {
    return { status: "not_found", sourceUrl: PRODUCT_SOURCE_URL };
  }
  const apiKey = options.apiKey ?? process.env.MFDS_MEDICATION_API_KEY ?? process.env.MFDS_PARMGEN_API_KEY;
  if (!apiKey) return { status: "not_configured", sourceUrl: PRODUCT_SOURCE_URL };

  const endpoint = new URL(
    `${(options.productApiUrl ?? process.env.MFDS_PRODUCT_API_URL ?? DEFAULT_PRODUCT_API_URL).replace(/\/$/, "")}/getDrugPrdtPrmsnInq07`,
  );
  endpoint.searchParams.set("serviceKey", normalizedServiceKey(apiKey));
  endpoint.searchParams.set("pageNo", "1");
  endpoint.searchParams.set("numOfRows", "1");
  endpoint.searchParams.set("type", options.format ?? "json");
  endpoint.searchParams.set("item_seq", normalizedCode);

  try {
    const format = options.format ?? "json";
    const payload = await fetchOfficialPayload(endpoint, format, options.fetcher ?? fetch);
    const parsed = parseProductPermitResponse(payload, format, "product_name");
    const item = parsed.items.find((candidate) => candidate.itemSeq === normalizedCode);
    return item
      ? { status: "matched", item, sourceUrl: PRODUCT_SOURCE_URL }
      : { status: "not_found", sourceUrl: PRODUCT_SOURCE_URL };
  } catch (error) {
    console.error("MFDS item-code verification unavailable", safeOfficialApiErrorCode(error));
    return { status: "unavailable", sourceUrl: PRODUCT_SOURCE_URL };
  }
}

async function fetchProductPermitDetail(
  itemSeq: string,
  options: Required<Pick<SearchOptions, "apiKey" | "productApiUrl" | "fetcher" | "format">>,
) {
  const endpoint = new URL(
    `${options.productApiUrl.replace(/\/$/, "")}/getDrugPrdtPrmsnDtlInq06`,
  );
  endpoint.searchParams.set("serviceKey", options.apiKey);
  endpoint.searchParams.set("pageNo", "1");
  endpoint.searchParams.set("numOfRows", "1");
  endpoint.searchParams.set("type", options.format);
  endpoint.searchParams.set("item_seq", itemSeq);
  const payload = await fetchOfficialPayload(endpoint, options.format, options.fetcher);
  return parseProductPermitDetailResponse(payload, options.format);
}

async function fetchEasyDrugMatches(
  query: string,
  options: Required<Pick<SearchOptions, "apiKey" | "easyDrugApiUrl" | "fetcher" | "format">>,
) {
  const endpoint = new URL(
    `${options.easyDrugApiUrl.replace(/\/$/, "")}/getDrbEasyDrugList`,
  );
  endpoint.searchParams.set("ServiceKey", options.apiKey);
  endpoint.searchParams.set("pageNo", "1");
  endpoint.searchParams.set("numOfRows", "10");
  endpoint.searchParams.set("type", options.format);
  endpoint.searchParams.set("itemName", query);
  const payload = await fetchOfficialPayload(endpoint, options.format, options.fetcher);
  return parseEasyDrugResponse(payload, options.format);
}

async function fetchPharmacogenomicMatches(
  query: string,
  options: Required<
    Pick<SearchOptions, "pharmacogenomicApiKey" | "pharmacogenomicApiUrl" | "fetcher" | "format">
  >,
) {
  const endpoint = new URL(
    `${options.pharmacogenomicApiUrl.replace(/\/$/, "")}/getParmgen`,
  );
  endpoint.searchParams.set("serviceKey", options.pharmacogenomicApiKey);
  endpoint.searchParams.set("pageNo", "1");
  endpoint.searchParams.set("numOfRows", "10");
  endpoint.searchParams.set("type", options.format);
  endpoint.searchParams.set(/[가-힣]/.test(query) ? "DRFSTF_KOR_NM" : "DRFSTF_ENG_NM", query);
  const payload = await fetchOfficialPayload(endpoint, options.format, options.fetcher);
  return parsePharmacogenomicResponse(payload, options.format);
}

function normalizedMedicationName(value: string) {
  return value.toLocaleLowerCase("ko-KR").replace(/[^0-9a-z가-힣]/g, "");
}

function namesOverlap(first: string, second: string) {
  const normalizedFirst = normalizedMedicationName(first);
  const normalizedSecond = normalizedMedicationName(second);
  return Boolean(
    normalizedFirst &&
    normalizedSecond &&
    (normalizedFirst.includes(normalizedSecond) || normalizedSecond.includes(normalizedFirst)),
  );
}

function matchesIngredientContext(query: string, item: OfficialMedicationSearchItem) {
  if (namesOverlap(query, item.ingredientName)) return true;
  return [...item.productName.matchAll(/[（(]([^()（）]+)[)）]/g)]
    .some((match) => namesOverlap(query, match[1] ?? ""));
}

function mergeProductMatches(
  query: string,
  productMatches: OfficialMedicationSearchItem[],
  ingredientMatches: OfficialMedicationSearchItem[],
) {
  const merged = new Map<string, OfficialMedicationSearchItem>();
  for (const rawItem of [...ingredientMatches, ...productMatches]) {
    const item = rawItem.matchType === "ingredient" || matchesIngredientContext(query, rawItem)
      ? { ...rawItem, matchType: "ingredient" as const }
      : rawItem;
    const current = merged.get(item.itemSeq);
    if (!current) {
      merged.set(item.itemSeq, item);
      continue;
    }
    merged.set(item.itemSeq, {
      ...current,
      matchType: item.matchType === "ingredient" ? "ingredient" : current.matchType,
      englishName: current.englishName || item.englishName,
      ingredientName: current.ingredientName || item.ingredientName,
      manufacturer: current.manufacturer || item.manufacturer,
      classification: current.classification || item.classification,
      productType: current.productType || item.productType,
      imageUrl: current.imageUrl || item.imageUrl,
    });
  }
  return [...merged.values()].slice(0, 10);
}

function logOfficialFailure(label: string, result: PromiseSettledResult<unknown>) {
  if (result.status === "rejected") {
    console.error(label, safeOfficialApiErrorCode(result.reason));
  }
}

export async function searchOfficialMedicationInfo(
  medicationName: string,
  options: SearchOptions = {},
): Promise<OfficialMedicationLookupResult> {
  const query = medicationName.trim().slice(0, 100);
  const apiKey = options.apiKey ??
    process.env.MFDS_MEDICATION_API_KEY ??
    process.env.MFDS_PARMGEN_API_KEY;
  if (!query) {
    return {
      status: "connected",
      items: [],
      totalCount: 0,
      sourceUrl: PRODUCT_SOURCE_URL,
      productQueryStatus: "complete",
      easyDrugStatus: "no_match",
      consumerInformationStatus: "no_match",
      pharmacogenomicStatus: "no_match",
      plainLanguageStatus: "no_source",
    };
  }

  if (!apiKey) {
    return {
      status: "not_configured",
      items: [],
      totalCount: 0,
      sourceUrl: PRODUCT_SOURCE_URL,
      message: "식약처 의약품 검색을 위한 API 키가 설정되지 않았어요.",
    };
  }

  const pharmacogenomicApiKey = options.pharmacogenomicApiKey ??
    options.apiKey ??
    process.env.MFDS_PARMGEN_API_KEY ??
    apiKey;

  const searchOptions = {
    apiKey: normalizedServiceKey(apiKey),
    pharmacogenomicApiKey: normalizedServiceKey(pharmacogenomicApiKey),
    productApiUrl: options.productApiUrl ??
      process.env.MFDS_PRODUCT_API_URL ?? DEFAULT_PRODUCT_API_URL,
    easyDrugApiUrl: options.easyDrugApiUrl ??
      process.env.MFDS_EASY_DRUG_API_URL ?? DEFAULT_EASY_DRUG_API_URL,
    pharmacogenomicApiUrl: options.pharmacogenomicApiUrl ??
      process.env.MFDS_PARMGEN_API_URL ?? DEFAULT_PHARMACOGENOMIC_API_URL,
    fetcher: options.fetcher ?? fetch,
    format: options.format ?? "json" as const,
  };

  const [productNameResult, ingredientResult, easyDrugResult, pharmacogenomicResult] =
    await Promise.allSettled([
      fetchProductMatches(query, "product_name", searchOptions),
      fetchProductMatches(query, "ingredient", searchOptions),
      fetchEasyDrugMatches(query, searchOptions),
      fetchPharmacogenomicMatches(query, searchOptions),
    ]);

  logOfficialFailure("MFDS product-name search unavailable", productNameResult);
  logOfficialFailure("MFDS ingredient search unavailable", ingredientResult);
  logOfficialFailure("MFDS easy-drug enrichment unavailable", easyDrugResult);
  logOfficialFailure("MFDS pharmacogenomic enrichment unavailable", pharmacogenomicResult);

  if (productNameResult.status === "rejected" && ingredientResult.status === "rejected") {
    return {
      status: "unavailable",
      items: [],
      totalCount: 0,
      sourceUrl: PRODUCT_SOURCE_URL,
      message: "식약처 제품·성분 검색을 불러오지 못했어요. 잠시 후 다시 검색해주세요.",
      reason: "api_error",
    };
  }

  const products = mergeProductMatches(
    query,
    productNameResult.status === "fulfilled" ? productNameResult.value.items : [],
    ingredientResult.status === "fulfilled" ? ingredientResult.value.items : [],
  );
  const easyItems = easyDrugResult.status === "fulfilled" ? easyDrugResult.value.items : [];
  const easyByItemSeq = new Map(easyItems.map((item) => [item.itemSeq, item]));
  const pharmacogenomicItems = pharmacogenomicResult.status === "fulfilled"
    ? pharmacogenomicResult.value.items
    : [];

  const productsNeedingPermitDetail = products.filter((product) => !easyByItemSeq.has(product.itemSeq));
  const permitDetailResults: PromiseSettledResult<Awaited<ReturnType<typeof fetchProductPermitDetail>>>[] = [];
  for (let index = 0; index < productsNeedingPermitDetail.length; index += 3) {
    const batch = productsNeedingPermitDetail.slice(index, index + 3);
    permitDetailResults.push(...await Promise.allSettled(
      batch.map((product) => fetchProductPermitDetail(product.itemSeq, searchOptions)),
    ));
  }
  const permitDetailByItemSeq = new Map<string, ProductPermitDetailInformation>();
  permitDetailResults.forEach((result) => {
    if (result.status === "rejected") {
      console.error("MFDS product permit detail unavailable", safeOfficialApiErrorCode(result.reason));
      return;
    }
    result.value.items.forEach((item) => permitDetailByItemSeq.set(item.itemSeq, item));
  });

  const items = products.map((product) => {
    const easy = easyByItemSeq.get(product.itemSeq);
    const permitDetail = permitDetailByItemSeq.get(product.itemSeq);
    const pharmacogenomic = pharmacogenomicItems.find((item) =>
      namesOverlap(product.ingredientName, item.koreanName) ||
      namesOverlap(product.ingredientName, item.englishName)
    );
    const imageUrl = product.imageUrl || easy?.imageUrl;
    return {
      ...product,
      ...(imageUrl ? { imageUrl } : {}),
      ...(easy ? {
        consumerInfo: {
          source: "easy_drug" as const,
          efficacy: easy.efficacy,
          usage: easy.usage,
          warning: easy.warning,
          precautions: easy.precautions,
          interactions: easy.interactions,
          adverseEffects: easy.adverseEffects,
          storage: easy.storage,
          openedAt: easy.openedAt,
          updatedAt: easy.updatedAt,
        },
      } : permitDetail ? {
        consumerInfo: {
          source: "product_permit" as const,
          efficacy: permitDetail.efficacy,
          usage: permitDetail.usage,
          warning: "",
          precautions: permitDetail.precautions,
          interactions: "",
          adverseEffects: "",
          storage: permitDetail.storage,
          openedAt: "",
          updatedAt: "",
        },
      } : {}),
      ...(pharmacogenomic ? {
        pharmacogenomicInfo: {
          koreanName: pharmacogenomic.koreanName,
          englishName: pharmacogenomic.englishName,
          generalInfo: pharmacogenomic.generalInfo,
          geneInfo: pharmacogenomic.pharmacogenomicInfo,
          productInfo: pharmacogenomic.productInfo,
        },
      } : {}),
      sources: [
        ...product.sources,
        ...(easy ? [easyDrugSource] : []),
        ...(pharmacogenomic ? [pharmacogenomicSource] : []),
      ],
    } satisfies OfficialMedicationSearchItem;
  });
  const hasEasyDrugInformation = items.some((item) => item.consumerInfo?.source === "easy_drug");
  const hasPharmacogenomicInformation = items.some((item) => item.pharmacogenomicInfo);
  const consumerInformationCount = items.filter((item) => item.consumerInfo).length;
  const permitDetailFailed = permitDetailResults.some((result) => result.status === "rejected");

  const openAiApiKey = options.openAiApiKey ?? process.env.OPENAI_API_KEY;
  const explainableCount = items.filter(
    (item) => item.consumerInfo || item.pharmacogenomicInfo,
  ).length;
  let enrichedItems = items;
  let plainLanguageStatus: PlainLanguageStatus = !openAiApiKey
    ? "not_configured"
    : explainableCount === 0 ? "no_source" : "unavailable";
  if (openAiApiKey && explainableCount > 0) {
    try {
      enrichedItems = await (options.simplifier ?? defaultMedicationSearchSimplifier)(items, {
        apiKey: openAiApiKey,
        model: options.openAiModel,
      });
      const explainedCount = enrichedItems.filter((item) => item.plainExplanation).length;
      plainLanguageStatus = explainedCount >= explainableCount ? "complete" : "partial";
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      console.error("OpenAI medication search simplification unavailable", message);
      plainLanguageStatus = "unavailable";
    }
  }

  return {
    status: "connected",
    items: enrichedItems,
    totalCount: enrichedItems.length,
    sourceUrl: PRODUCT_SOURCE_URL,
    productQueryStatus:
      productNameResult.status === "fulfilled" && ingredientResult.status === "fulfilled"
        ? "complete"
        : "partial",
    easyDrugStatus:
      easyDrugResult.status === "rejected"
        ? "unavailable"
        : hasEasyDrugInformation ? "complete" : "no_match",
    consumerInformationStatus:
      consumerInformationCount === items.length && items.length > 0
        ? "complete"
        : consumerInformationCount > 0
          ? "partial"
          : easyDrugResult.status === "rejected" || permitDetailFailed
            ? "unavailable"
            : "no_match",
    pharmacogenomicStatus:
      pharmacogenomicResult.status === "rejected"
        ? "unavailable"
        : hasPharmacogenomicInformation ? "complete" : "no_match",
    plainLanguageStatus,
  };
}
