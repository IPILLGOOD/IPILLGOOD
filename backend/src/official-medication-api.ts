import { XMLParser } from "fast-xml-parser";

const DEFAULT_API_URL = "https://apis.data.go.kr/1471000/ParmgenService";
const SOURCE_URL = "https://www.data.go.kr/data/15102548/openapi.do";

type DataFormat = "json" | "xml";
type Fetcher = typeof fetch;

interface ApiEnvelope {
  header?: unknown;
  body?: unknown;
}

export interface PharmacogenomicInfo {
  koreanName: string;
  englishName: string;
  pharmacogenomicInfo: string;
  generalInfo: string;
  productInfo: string;
}

export type PharmacogenomicLookupResult =
  | {
      status: "connected";
      items: PharmacogenomicInfo[];
      totalCount: number;
      sourceUrl: string;
    }
  | {
      status: "not_configured" | "unavailable";
      items: [];
      totalCount: 0;
      sourceUrl: string;
      message: string;
    };

interface SearchOptions {
  apiKey?: string;
  apiUrl?: string;
  fetcher?: Fetcher;
  format?: DataFormat;
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

function parsePayload(payload: string, format: DataFormat): unknown {
  if (format === "json") {
    try {
      return JSON.parse(payload) as unknown;
    } catch {
      // 인증 오류처럼 XML로 반환되는 게이트웨이 응답도 처리합니다.
    }
  }

  return new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    trimValues: true,
  }).parse(payload) as unknown;
}

export function parsePharmacogenomicResponse(
  payload: string,
  format: DataFormat,
): Omit<Extract<PharmacogenomicLookupResult, { status: "connected" }>, "sourceUrl"> {
  const parsed = asRecord(parsePayload(payload, format));
  const response = asRecord(parsed?.response) ?? parsed;
  const envelope = (response ?? {}) as ApiEnvelope;
  const header = asRecord(envelope.header);
  const body = asRecord(envelope.body);
  const resultCode = asString(header?.resultCode);

  if (!header || !body || !["00", "0000"].includes(resultCode)) {
    const resultMessage = asString(header?.resultMsg) || "공식 약물 정보 응답을 확인하지 못했어요.";
    throw new Error(resultMessage);
  }

  const itemContainers = Array.isArray(body.items) ? body.items : [body.items];
  const rawItems = itemContainers.flatMap((container) => {
    const item = asRecord(container)?.item ?? container;
    if (!item) return [];
    return Array.isArray(item) ? item : [item];
  });
  const items = rawItems.flatMap((value): PharmacogenomicInfo[] => {
    const item = asRecord(value);
    if (!item) return [];

    return [
      {
        koreanName: asString(item.DRFSTF_KOR_NM),
        englishName: asString(item.DRFSTF_ENG_NM),
        pharmacogenomicInfo: asString(item.BASC_INFO),
        generalInfo: asString(item.GNRL_INFO),
        productInfo: asString(item.PRDLST_NM),
      },
    ];
  });

  return {
    status: "connected",
    items,
    totalCount: asNumber(body.totalCount),
  };
}

export async function searchPharmacogenomicInfo(
  medicationName: string,
  options: SearchOptions = {},
): Promise<PharmacogenomicLookupResult> {
  const apiKey = options.apiKey ?? process.env.MFDS_PARMGEN_API_KEY;
  if (!apiKey) {
    return {
      status: "not_configured",
      items: [],
      totalCount: 0,
      sourceUrl: SOURCE_URL,
      message: "공식 약물 정보 API 키가 설정되지 않았어요.",
    };
  }

  const query = medicationName.trim().slice(0, 100);
  if (!query) {
    return {
      status: "connected",
      items: [],
      totalCount: 0,
      sourceUrl: SOURCE_URL,
    };
  }

  const format = options.format ?? "json";
  const apiUrl = options.apiUrl ?? process.env.MFDS_PARMGEN_API_URL ?? DEFAULT_API_URL;

  try {
    const endpoint = new URL(`${apiUrl.replace(/\/$/, "")}/getParmgen`);
    endpoint.searchParams.set("serviceKey", apiKey);
    endpoint.searchParams.set("pageNo", "1");
    endpoint.searchParams.set("numOfRows", "20");
    endpoint.searchParams.set("type", format);
    endpoint.searchParams.set(
      /[가-힣]/.test(query) ? "DRFSTF_KOR_NM" : "DRFSTF_ENG_NM",
      query,
    );

    const response = await (options.fetcher ?? fetch)(endpoint, {
      headers: {
        Accept: format === "json" ? "application/json" : "application/xml, text/xml",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const parsed = parsePharmacogenomicResponse(await response.text(), format);
    return { ...parsed, sourceUrl: SOURCE_URL };
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    console.error("MFDS pharmacogenomic API unavailable", message);
    return {
      status: "unavailable",
      items: [],
      totalCount: 0,
      sourceUrl: SOURCE_URL,
      message: "식약처 공식 정보를 불러오지 못했어요. 잠시 후 다시 검색해주세요.",
    };
  }
}
