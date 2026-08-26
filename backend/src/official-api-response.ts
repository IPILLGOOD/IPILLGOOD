import { XMLParser } from "fast-xml-parser";

export type OfficialApiFormat = "json" | "xml";

export const OFFICIAL_API_MAX_RESPONSE_BYTES = 1024 * 1024;
export const OFFICIAL_API_RESPONSE_TIMEOUT_MS = 8_000;

const MAX_XML_ENTITY_REFERENCES = 1_000;

export class OfficialApiResponseError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "OfficialApiResponseError";
  }
}

function mediaType(contentType: string | null) {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function hasExpectedContentType(contentType: string | null, format: OfficialApiFormat) {
  const type = mediaType(contentType);
  if (format === "json") return type === "application/json" || type.endsWith("+json");
  return type === "application/xml" || type === "text/xml" || type.endsWith("+xml");
}

function assertExpectedPayloadShape(payload: string, format: OfficialApiFormat) {
  const start = payload.trimStart().slice(0, 20);
  if (format === "json" && !start.startsWith("{") && !start.startsWith("[")) {
    throw new OfficialApiResponseError("unexpected_json_shape");
  }
  if (format === "xml" && !start.startsWith("<")) {
    throw new OfficialApiResponseError("unexpected_xml_shape");
  }
}

function assertSafeXml(payload: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(payload)) {
    throw new OfficialApiResponseError("xml_dtd_not_allowed");
  }

  const entityReferences = payload.match(/&(?:#\d{1,7}|#x[\da-f]{1,6}|amp|apos|gt|lt|quot);/gi);
  if ((entityReferences?.length ?? 0) > MAX_XML_ENTITY_REFERENCES) {
    throw new OfficialApiResponseError("xml_entity_limit_exceeded");
  }
}

async function readBodyWithLimit(response: Response, maxBytes: number, timeoutMs: number) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new OfficialApiResponseError("response_too_large");
  }

  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const deadline = Date.now() + timeoutMs;
  let totalBytes = 0;
  let payload = "";

  try {
    while (true) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new OfficialApiResponseError("response_timeout");
      const { done, value } = await new Promise<ReadableStreamReadResult<Uint8Array>>(
        (resolve, reject) => {
          const timeout = setTimeout(() => {
            void reader.cancel().catch(() => undefined);
            reject(new OfficialApiResponseError("response_timeout"));
          }, remainingMs);
          reader.read().then(
            (result) => {
              clearTimeout(timeout);
              resolve(result);
            },
            (error) => {
              clearTimeout(timeout);
              reject(error);
            },
          );
        },
      );
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new OfficialApiResponseError("response_too_large");
      }
      payload += decoder.decode(value, { stream: true });
    }
    return payload + decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof TypeError) {
      throw new OfficialApiResponseError("response_not_utf8");
    }
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // 취소 처리 중인 reader는 잠금 해제가 지연될 수 있습니다.
    }
  }
}

export async function readOfficialApiResponse(
  response: Response,
  format: OfficialApiFormat,
  options: { maxBytes?: number; timeoutMs?: number } = {},
) {
  if (!hasExpectedContentType(response.headers.get("content-type"), format)) {
    throw new OfficialApiResponseError("unexpected_content_type");
  }

  const maxBytes = options.maxBytes ?? OFFICIAL_API_MAX_RESPONSE_BYTES;
  const timeoutMs = options.timeoutMs ?? OFFICIAL_API_RESPONSE_TIMEOUT_MS;
  const payload = await readBodyWithLimit(response, maxBytes, timeoutMs);
  assertExpectedPayloadShape(payload, format);
  if (format === "xml") assertSafeXml(payload);
  return payload;
}

export function parseOfficialXml(payload: string): unknown {
  assertExpectedPayloadShape(payload, "xml");
  assertSafeXml(payload);
  return new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    trimValues: true,
    htmlEntities: false,
    processEntities: {
      enabled: true,
      maxEntityCount: 100,
      maxEntitySize: 1_024,
      maxExpandedLength: 64 * 1_024,
      maxTotalExpansions: MAX_XML_ENTITY_REFERENCES,
    },
  }).parse(payload) as unknown;
}

export function safeOfficialApiErrorCode(error: unknown) {
  if (error instanceof OfficialApiResponseError) return error.code;
  if (error instanceof Error && /^HTTP \d{3}$/.test(error.message)) return error.message;
  return "unexpected_official_api_error";
}
