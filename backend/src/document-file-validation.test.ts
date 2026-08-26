import assert from "node:assert/strict";
import test from "node:test";

import { PDFDocument } from "pdf-lib";

import {
  DocumentUploadValidationError,
  MAX_DOCUMENT_FILE_BYTES,
  validateClinicalDocumentFile,
} from "./document-file-validation.ts";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function pdfWithPages(pageCount: number, size: [number, number] = [595, 842]) {
  const document = await PDFDocument.create();
  for (let page = 0; page < pageCount; page += 1) document.addPage(size);
  return document.save();
}

test("정상 PNG와 PDF의 실제 형식·크기·페이지 수를 반환한다", async () => {
  const image = await validateClinicalDocumentFile(onePixelPng, "image/png");
  assert.deepEqual(image, {
    contentType: "image/png",
    format: "png",
    height: 1,
    width: 1,
  });

  const pdf = await validateClinicalDocumentFile(await pdfWithPages(2), "application/pdf");
  assert.equal(pdf.format, "pdf");
  assert.equal(pdf.pageCount, 2);
});

test("실행 파일 위장과 클라이언트 MIME 불일치를 거부한다", async () => {
  await assert.rejects(
    validateClinicalDocumentFile(new TextEncoder().encode("MZ executable"), "application/pdf"),
    (error) =>
      error instanceof DocumentUploadValidationError && error.code === "unsupported_file_format",
  );
  await assert.rejects(
    validateClinicalDocumentFile(onePixelPng, "application/pdf"),
    (error) =>
      error instanceof DocumentUploadValidationError && error.code === "content_type_mismatch",
  );
});

test("손상 이미지와 손상·암호화 PDF를 AI 전송 전에 거부한다", async () => {
  await assert.rejects(
    validateClinicalDocumentFile(onePixelPng.subarray(0, 24), "image/png"),
    (error) => error instanceof DocumentUploadValidationError && error.code === "corrupt_image",
  );
  await assert.rejects(
    validateClinicalDocumentFile(new TextEncoder().encode("%PDF-1.7\ntruncated"), "application/pdf"),
    (error) => error instanceof DocumentUploadValidationError && error.code === "corrupt_pdf",
  );
  await assert.rejects(
    validateClinicalDocumentFile(
      new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Encrypt 2 0 R >> endobj\n%%EOF"),
      "application/pdf",
    ),
    (error) => error instanceof DocumentUploadValidationError && error.code === "encrypted_pdf",
  );
});

test("파일 크기·PDF 페이지 수·페이지 크기 제한을 적용한다", async () => {
  await assert.rejects(
    validateClinicalDocumentFile(new Uint8Array(MAX_DOCUMENT_FILE_BYTES + 1), "image/png"),
    (error) => error instanceof DocumentUploadValidationError && error.code === "file_too_large",
  );
  await assert.rejects(
    validateClinicalDocumentFile(await pdfWithPages(21), "application/pdf"),
    (error) =>
      error instanceof DocumentUploadValidationError && error.code === "pdf_page_limit_exceeded",
  );
  await assert.rejects(
    validateClinicalDocumentFile(await pdfWithPages(1, [15_000, 842]), "application/pdf"),
    (error) =>
      error instanceof DocumentUploadValidationError &&
      error.code === "pdf_page_dimensions_exceeded",
  );
});

test("거부 오류에는 파일 내용 없이 안전한 사용자 안내만 포함한다", async () => {
  const secretPayload = "MZ 주민번호-테스트";
  await assert.rejects(
    validateClinicalDocumentFile(new TextEncoder().encode(secretPayload), "application/pdf"),
    (error) => {
      assert.ok(error instanceof DocumentUploadValidationError);
      assert.equal(error.userMessage.includes(secretPayload), false);
      return true;
    },
  );
});
