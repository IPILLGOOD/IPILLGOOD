import { XMLParser } from "fast-xml-parser";

const DEFAULT_API_URL = "https://apis.data.go.kr/B551182/diseaseInfoService";
const SOURCE_URL = "https://www.data.go.kr/data/15119055/openapi.do";

type Fetcher = typeof fetch;

export interface OfficialDiseaseItem {
  code: string;
  koreanName: string;
  englishName: string;
}

export type OfficialDiseaseLookupResult =
  | {
      status: "matched";
      item: OfficialDiseaseItem;
      sourceUrl: string;
    }
  | {
      status: "not_configured" | "no_match" | "unavailable";
      sourceUrl: string;
      message: string;
    };

interface SearchOptions {
  apiKey?: string;
  apiUrl?: string;
  fetcher?: Fetcher;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function pick(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) return value;
  }
  return "";
}

export function parseOfficialDiseaseResponse(payload: string): OfficialDiseaseItem[] {
  const parsed = asRecord(
    new XMLParser({
      ignoreAttributes: true,
      parseTagValue: false,
      trimValues: true,
    }).parse(payload) as unknown,
  );
  const response = asRecord(parsed?.response) ?? parsed;
  const header = asRecord(response?.header);
  const resultCode = pick(header ?? {}, "resultCode", "resultcode");

  if (!header || !["00", "0000"].includes(resultCode)) {
    throw new Error(
      pick(header ?? {}, "resultMsg", "resultmsg") ||
        "공식 질병 정보 응답을 확인하지 못했어요.",
    );
  }

  const body = asRecord(response?.body);
  if (!body?.items) return [];
  const itemsContainer = asRecord(body.items);
  const rawItems = itemsContainer?.item ?? body.items;
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];

  return items.flatMap((value): OfficialDiseaseItem[] => {
    const item = asRecord(value);
    if (!item) return [];
    const code = pick(item, "sickCd", "sickcd", "SICK_CD");
    const koreanName = pick(item, "sickNm", "sicknm", "SICK_NM");
    if (!code || !koreanName) return [];

    return [
      {
        code,
        koreanName,
        englishName: pick(item, "sickEngNm", "sickengnm", "SICK_ENG_NM"),
      },
    ];
  });
}

function normalizeName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, "")
    .replace(/[()\[\]{}·,._\-/\s]/g, "");
}

function normalizeCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function selectOfficialDiseaseMatch(
  items: OfficialDiseaseItem[],
  query: string,
  code?: string,
): OfficialDiseaseItem | undefined {
  const expectedCode = normalizeCode(code ?? "");
  if (expectedCode) {
    const codeMatch = items.find((item) => normalizeCode(item.code) === expectedCode);
    if (codeMatch) return codeMatch;
  }

  const expectedName = normalizeName(query);
  if (expectedName.length < 2) return undefined;

  return items.find((item) => {
    const candidate = normalizeName(item.koreanName);
    return (
      candidate === expectedName ||
      (expectedName.length >= 3 &&
        (candidate.includes(expectedName) || expectedName.includes(candidate)))
    );
  });
}

export async function searchOfficialDiseaseInfo(
  query: string,
  code?: string,
  options: SearchOptions = {},
): Promise<OfficialDiseaseLookupResult> {
  const apiKey = options.apiKey ?? process.env.HIRA_DISEASE_API_KEY;
  if (!apiKey) {
    return {
      status: "not_configured",
      sourceUrl: SOURCE_URL,
      message: "건강보험심사평가원 질병정보 API 키가 설정되지 않았어요.",
    };
  }

  const trimmedQuery = query.trim().slice(0, 100);
  const trimmedCode = code?.trim().slice(0, 20);
  if (!trimmedQuery && !trimmedCode) {
    return {
      status: "no_match",
      sourceUrl: SOURCE_URL,
      message: "조회할 질병명이나 질병코드를 찾지 못했어요.",
    };
  }

  try {
    const apiUrl = options.apiUrl ?? process.env.HIRA_DISEASE_API_URL ?? DEFAULT_API_URL;
    const endpoint = new URL(`${apiUrl.replace(/\/$/, "")}/getDissNameCodeList`);
    endpoint.searchParams.set("serviceKey", apiKey);
    endpoint.searchParams.set("numOfRows", "20");
    endpoint.searchParams.set("pageNo", "1");
    endpoint.searchParams.set("sickType", "1");
    endpoint.searchParams.set("medTp", "2");
    endpoint.searchParams.set("diseaseType", trimmedCode ? "SICK_CD" : "SICK_NM");
    endpoint.searchParams.set("searchText", trimmedCode || trimmedQuery);

    const response = await (options.fetcher ?? fetch)(endpoint, {
      headers: { Accept: "application/xml, text/xml" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const items = parseOfficialDiseaseResponse(await response.text());
    const match = selectOfficialDiseaseMatch(items, trimmedQuery, trimmedCode);
    if (!match) {
      return {
        status: "no_match",
        sourceUrl: SOURCE_URL,
        message: "공식 질병정보 API에서 일치하는 질병을 찾지 못했어요.",
      };
    }

    return { status: "matched", item: match, sourceUrl: SOURCE_URL };
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    console.error("HIRA disease API unavailable", message);
    return {
      status: "unavailable",
      sourceUrl: SOURCE_URL,
      message: "공식 질병정보 API를 불러오지 못했어요.",
    };
  }
}
