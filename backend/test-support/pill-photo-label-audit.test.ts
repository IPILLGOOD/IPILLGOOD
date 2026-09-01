import assert from "node:assert/strict";
import test from "node:test";
import type { OfficialPillItem } from "../src/official-pill-catalog.ts";
import { loadPillPhotoEvaluationFixture } from "./pill-photo-evaluation.ts";
import { loadFrozenPillPhotoFixture } from "./pill-photo-fixture.ts";
import {
  auditPillPhotoOfficialLabels,
  officialPillRecordDigest,
  PILL_PHOTO_LABEL_AUDIT_VERSION,
} from "./pill-photo-label-audit.ts";

async function fixture() {
  const [{ manifest }, frozen] = await Promise.all([
    loadPillPhotoEvaluationFixture(),
    loadFrozenPillPhotoFixture(),
  ]);
  return { products: manifest.products, items: frozen.snapshot.items };
}

test("접수번호 근거와 품목코드가 고정 식약처 레코드 하나에 결정적으로 연결된다", async () => {
  const { products, items } = await fixture();
  const report = auditPillPhotoOfficialLabels(products, items);
  assert.equal(report.auditVersion, PILL_PHOTO_LABEL_AUDIT_VERSION);
  assert.equal(report.ok, true);
  assert.equal(report.products.length, 4);
  assert.deepEqual(new Set(report.products.map((row) => row.status)), new Set(["verified"]));
  assert.equal(report.products.every((row) => row.officialRecordCount === 1
    && row.appearanceMatchCount === 1 && row.expectedRecordDigestPresent), true);
  for (const product of products) {
    const official = items.find((item) => item.itemSeq === product.expectedItemSeq);
    assert.ok(official);
    assert.equal(officialPillRecordDigest(official), product.expectedOfficialRecordSha256);
  }
});

test("공식 레코드 누락·복수 외형·외형 변경·메타데이터 변경을 검증 성공으로 숨기지 않는다", async () => {
  const { products, items } = await fixture();
  const target = items.find((item) => item.itemSeq === products[0]!.expectedItemSeq)!;
  const withoutTarget = items.filter((item) => item !== target);
  assert.equal(auditPillPhotoOfficialLabels(products, withoutTarget).products[0]!.status, "missing");

  const duplicate = structuredClone(target);
  duplicate.source.fetchedAt = "2026-09-02T00:00:00.000Z";
  assert.equal(auditPillPhotoOfficialLabels(products, [...items, duplicate]).products[0]!.status, "unexpected_record_count");

  const changedAppearance: OfficialPillItem = structuredClone(target);
  changedAppearance.colors = ["하양"];
  assert.equal(auditPillPhotoOfficialLabels(products, [changedAppearance, ...withoutTarget]).products[0]!.status, "appearance_mismatch");

  const changedMetadata: OfficialPillItem = structuredClone(target);
  changedMetadata.productName = `${changedMetadata.productName} 변경`;
  assert.equal(auditPillPhotoOfficialLabels(products, [changedMetadata, ...withoutTarget]).products[0]!.status, "official_record_drift");
});
