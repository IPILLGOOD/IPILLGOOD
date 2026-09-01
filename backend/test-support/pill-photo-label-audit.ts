import { createHash } from "node:crypto";
import { stableJson } from "../src/stable-json.ts";
import type { OfficialPillItem, PillForm } from "../src/official-pill-catalog.ts";

export const PILL_PHOTO_LABEL_AUDIT_VERSION = "pill-photo-official-label-audit-v1";

export interface ExpectedPillPhotoProduct {
  receipt: string;
  expectedItemSeq: string;
  mappingEvidenceUrl: string;
  expectedOfficialRecordSha256: string;
  expectedObservation: {
    form: Extract<PillForm, "tablet" | "capsule">;
    shape: string;
    colors: string[];
    frontImprint: string | null;
    backImprint: string | null;
  };
}

export type PillPhotoLabelAuditStatus =
  | "verified"
  | "missing"
  | "unexpected_record_count"
  | "appearance_mismatch"
  | "official_record_drift";

export interface PillPhotoLabelAuditRow {
  receipt: string;
  expectedItemSeq: string;
  mappingEvidenceUrl: string;
  status: PillPhotoLabelAuditStatus;
  officialRecordCount: number;
  appearanceMatchCount: number;
  expectedRecordDigestPresent: boolean;
  officialRecordDigests: string[];
}

export interface PillPhotoLabelAuditReport {
  auditVersion: typeof PILL_PHOTO_LABEL_AUDIT_VERSION;
  ok: boolean;
  products: PillPhotoLabelAuditRow[];
}

function sameUnorderedStrings(left: readonly string[], right: readonly string[]) {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length
    && sortedLeft.every((value, index) => value === sortedRight[index]);
}

/** Stable official-data fingerprint. Fetch time is deliberately excluded. */
export function officialPillRecordDigest(item: OfficialPillItem) {
  const source = {
    url: item.source.url,
    changedAt: item.source.changedAt,
    imageRegisteredAt: item.source.imageRegisteredAt,
  };
  const canonical = {
    itemSeq: item.itemSeq,
    productName: item.productName,
    manufacturer: item.manufacturer,
    form: item.form,
    formName: item.formName,
    shape: item.shape,
    colors: item.colors,
    front: item.front,
    back: item.back,
    imageUrl: item.imageUrl,
    source,
  };
  return createHash("sha256").update(stableJson(canonical)).digest("hex");
}

export function officialPillMatchesExpectedObservation(item: OfficialPillItem, product: ExpectedPillPhotoProduct) {
  const expected = product.expectedObservation;
  return item.itemSeq === product.expectedItemSeq
    && item.form === expected.form
    && item.shape === expected.shape
    && sameUnorderedStrings(item.colors, expected.colors)
    && item.front.imprint === expected.frontImprint
    && item.back.imprint === expected.backImprint;
}

/**
 * Audits only ground-truth linkage. This does not measure photo recognition accuracy.
 * Exactly one current official record is required so an appearance-history ambiguity
 * cannot silently become the evaluation answer.
 */
export function auditPillPhotoOfficialLabels(
  products: readonly ExpectedPillPhotoProduct[],
  officialItems: readonly OfficialPillItem[],
): PillPhotoLabelAuditReport {
  const rows = products.map((product): PillPhotoLabelAuditRow => {
    const matches = officialItems.filter((item) => item.itemSeq === product.expectedItemSeq);
    const digests = matches.map(officialPillRecordDigest).sort();
    const appearanceMatchCount = matches.filter((item) => officialPillMatchesExpectedObservation(item, product)).length;
    const expectedRecordDigestPresent = digests.includes(product.expectedOfficialRecordSha256);
    let status: PillPhotoLabelAuditStatus = "verified";
    if (matches.length === 0) status = "missing";
    else if (matches.length !== 1) status = "unexpected_record_count";
    else if (appearanceMatchCount !== 1) status = "appearance_mismatch";
    else if (!expectedRecordDigestPresent) status = "official_record_drift";
    return {
      receipt: product.receipt,
      expectedItemSeq: product.expectedItemSeq,
      mappingEvidenceUrl: product.mappingEvidenceUrl,
      status,
      officialRecordCount: matches.length,
      appearanceMatchCount,
      expectedRecordDigestPresent,
      officialRecordDigests: digests,
    };
  });
  return {
    auditVersion: PILL_PHOTO_LABEL_AUDIT_VERSION,
    ok: rows.every((row) => row.status === "verified"),
    products: rows,
  };
}
