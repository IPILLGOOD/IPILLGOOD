import { PDFDocument } from "pdf-lib";

export const MAX_DOCUMENT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENT_PDF_PAGES = 20;
export const MAX_DOCUMENT_IMAGE_DIMENSION = 10_000;
export const MAX_DOCUMENT_IMAGE_PIXELS = 25_000_000;
const MAX_PDF_PAGE_POINTS = 14_400;

type SupportedDocumentFormat = "jpeg" | "png" | "webp" | "pdf";

export interface ValidatedDocumentFile {
  contentType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
  format: SupportedDocumentFormat;
  height?: number;
  pageCount?: number;
  width?: number;
}

export class DocumentUploadValidationError extends Error {
  readonly code: string;
  readonly userMessage: string;

  constructor(code: string, userMessage: string) {
    super(code);
    this.code = code;
    this.userMessage = userMessage;
    this.name = "DocumentUploadValidationError";
  }
}

const contentTypesByFormat = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
} as const;

const claimedContentTypes: Record<SupportedDocumentFormat, ReadonlySet<string>> = {
  jpeg: new Set(["image/jpeg", "image/jpg"]),
  png: new Set(["image/png"]),
  webp: new Set(["image/webp"]),
  pdf: new Set(["application/pdf"]),
};

function hasBytes(bytes: Uint8Array, offset: number, expected: readonly number[]) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function detectFormat(bytes: Uint8Array): SupportedDocumentFormat | undefined {
  if (hasBytes(bytes, 0, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  if (hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (hasBytes(bytes, 0, [0xff, 0xd8, 0xff])) return "jpeg";
  if (
    hasBytes(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
    hasBytes(bytes, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return "webp";
  }
  return undefined;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngDimensions(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let hasImageData = false;
  let hasEnd = false;

  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) throw new Error("truncated_png_chunk");
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = new TextDecoder("ascii", { fatal: true }).decode(typeBytes);
    const expectedCrc = view.getUint32(offset + 8 + length);
    const actualCrc = crc32(bytes.subarray(offset + 4, offset + 8 + length));
    if (actualCrc !== expectedCrc) throw new Error("invalid_png_crc");

    if (type === "IHDR") {
      if (offset !== 8 || length !== 13) throw new Error("invalid_png_header");
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
    } else if (type === "IDAT") {
      hasImageData = true;
    } else if (type === "IEND") {
      if (length !== 0 || chunkEnd !== bytes.length) throw new Error("invalid_png_end");
      hasEnd = true;
      break;
    }
    offset = chunkEnd;
  }

  if (!width || !height || !hasImageData || !hasEnd) throw new Error("incomplete_png");
  return { width, height };
}

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpegDimensions(bytes: Uint8Array) {
  if (!hasBytes(bytes, bytes.length - 2, [0xff, 0xd9])) throw new Error("missing_jpeg_end");
  let offset = 2;
  let width = 0;
  let height = 0;
  let hasScan = false;

  while (offset + 4 <= bytes.length) {
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) break;
    if (marker === 0xda) {
      hasScan = true;
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.length) throw new Error("truncated_jpeg_segment");
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) throw new Error("invalid_jpeg_segment");
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (length < 8) throw new Error("invalid_jpeg_frame");
      height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      width = (bytes[offset + 5] << 8) | bytes[offset + 6];
    }
    offset += length;
  }

  if (!width || !height || !hasScan) throw new Error("incomplete_jpeg");
  return { width, height };
}

function uint24LittleEndian(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function webpDimensions(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 30 || view.getUint32(4, true) + 8 !== bytes.length) {
    throw new Error("invalid_webp_container");
  }
  const chunk = new TextDecoder("ascii", { fatal: true }).decode(bytes.subarray(12, 16));
  if (chunk === "VP8X") {
    return {
      width: uint24LittleEndian(bytes, 24) + 1,
      height: uint24LittleEndian(bytes, 27) + 1,
    };
  }
  if (chunk === "VP8 ") {
    if (!hasBytes(bytes, 23, [0x9d, 0x01, 0x2a])) throw new Error("invalid_webp_vp8");
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) throw new Error("invalid_webp_vp8l");
    const dimensions = view.getUint32(21, true);
    return {
      width: (dimensions & 0x3fff) + 1,
      height: ((dimensions >>> 14) & 0x3fff) + 1,
    };
  }
  throw new Error("unsupported_webp_chunk");
}

function assertSafeImageDimensions(width: number, height: number) {
  if (
    width <= 0 ||
    height <= 0 ||
    width > MAX_DOCUMENT_IMAGE_DIMENSION ||
    height > MAX_DOCUMENT_IMAGE_DIMENSION ||
    width * height > MAX_DOCUMENT_IMAGE_PIXELS
  ) {
    throw new DocumentUploadValidationError(
      "image_dimensions_exceeded",
      "이미지 해상도가 너무 커요. 한 변 10,000px, 전체 2,500만 픽셀 이하로 줄여주세요.",
    );
  }
}

async function validatePdf(bytes: Uint8Array): Promise<ValidatedDocumentFile> {
  const tail = new TextDecoder("latin1").decode(bytes.subarray(Math.max(0, bytes.length - 2_048)));
  if (!tail.includes("%%EOF")) {
    throw new DocumentUploadValidationError(
      "corrupt_pdf",
      "PDF가 손상되었거나 완전히 업로드되지 않았어요.",
    );
  }
  const source = new TextDecoder("latin1").decode(bytes);
  if (/\/Encrypt\b/.test(source)) {
    throw new DocumentUploadValidationError(
      "encrypted_pdf",
      "암호로 보호된 PDF는 분석할 수 없어요. 암호 보호를 해제한 뒤 다시 올려주세요.",
    );
  }

  try {
    const document = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      throwOnInvalidObject: true,
      updateMetadata: false,
    });
    const pageCount = document.getPageCount();
    if (pageCount < 1 || pageCount > MAX_DOCUMENT_PDF_PAGES) {
      throw new DocumentUploadValidationError(
        "pdf_page_limit_exceeded",
        `PDF는 ${MAX_DOCUMENT_PDF_PAGES}페이지 이하로 올려주세요.`,
      );
    }
    for (const page of document.getPages()) {
      const { width, height } = page.getSize();
      if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0 ||
        width > MAX_PDF_PAGE_POINTS ||
        height > MAX_PDF_PAGE_POINTS
      ) {
        throw new DocumentUploadValidationError(
          "pdf_page_dimensions_exceeded",
          "PDF 페이지 크기가 너무 커요. 일반 문서 크기로 내보낸 뒤 다시 올려주세요.",
        );
      }
    }
    return { contentType: "application/pdf", format: "pdf", pageCount };
  } catch (error) {
    if (error instanceof DocumentUploadValidationError) throw error;
    throw new DocumentUploadValidationError(
      "corrupt_pdf",
      "PDF가 손상되었거나 지원하지 않는 형식이에요.",
    );
  }
}

export async function validateClinicalDocumentFile(
  bytes: Uint8Array,
  claimedContentType: string,
): Promise<ValidatedDocumentFile> {
  if (bytes.length === 0) {
    throw new DocumentUploadValidationError("empty_file", "빈 파일은 분석할 수 없어요.");
  }
  if (bytes.length > MAX_DOCUMENT_FILE_BYTES) {
    throw new DocumentUploadValidationError(
      "file_too_large",
      "문서는 5MB 이하로 올려주세요.",
    );
  }

  const format = detectFormat(bytes);
  if (!format) {
    throw new DocumentUploadValidationError(
      "unsupported_file_format",
      "실제 형식을 확인할 수 없어요. JPEG, PNG, WebP 또는 PDF 파일을 올려주세요.",
    );
  }
  if (
    claimedContentType &&
    !claimedContentTypes[format].has(claimedContentType.toLowerCase().split(";", 1)[0].trim())
  ) {
    throw new DocumentUploadValidationError(
      "content_type_mismatch",
      "파일의 실제 형식과 표시된 형식이 달라요. 원본 파일을 다시 선택해주세요.",
    );
  }

  if (format === "pdf") return validatePdf(bytes);

  try {
    const dimensions =
      format === "png"
        ? pngDimensions(bytes)
        : format === "jpeg"
          ? jpegDimensions(bytes)
          : webpDimensions(bytes);
    assertSafeImageDimensions(dimensions.width, dimensions.height);
    return { contentType: contentTypesByFormat[format], format, ...dimensions };
  } catch (error) {
    if (error instanceof DocumentUploadValidationError) throw error;
    throw new DocumentUploadValidationError(
      "corrupt_image",
      "이미지가 손상되었거나 완전히 업로드되지 않았어요.",
    );
  }
}
