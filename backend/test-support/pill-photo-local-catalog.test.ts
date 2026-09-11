import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { PILL_PHOTO_FIXTURE_DIRECTORY, type PillPhotoFixtureManifest } from "./pill-photo-fixture.ts";
import { decodeLocalPillPhotoCatalog, loadLocalPillPhotoCatalog } from "./pill-photo-local-catalog.ts";

const manifest = JSON.parse(await readFile(join(PILL_PHOTO_FIXTURE_DIRECTORY, "manifest.json"), "utf8")) as PillPhotoFixtureManifest;
const bytes = await readFile(join(PILL_PHOTO_FIXTURE_DIRECTORY, "catalog.json.gz"));
const withCatalog = (changes: Partial<PillPhotoFixtureManifest["catalog"]>) => ({ ...manifest, catalog: { ...manifest.catalog, ...changes } });
const sha256 = (input: Buffer) => createHash("sha256").update(input).digest("hex");

test("새 사진의 로컬 검색도 전체 고정 카탈로그와 원래 검증 날짜를 네트워크 없이 사용한다", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("local_catalog_must_not_fetch"); };
  try {
    const result = await loadLocalPillPhotoCatalog();
    assert.equal(result.catalog.items.length, 25_387);
    assert.equal(result.catalog.totalCount, 25_387);
    assert.equal(result.catalog.completeness, "complete");
    assert.equal(new Set(result.catalog.items.map((item) => item.itemSeq)).size, 25_370);
    assert.deepEqual(result.metadata, {
      mode: "fixed_local_test_snapshot",
      verifiedAt: "2026-08-31T06:36:18.138Z",
      version: manifest.catalog.version,
      records: 25_387,
      sha256: manifest.catalog.sha256,
    });
    assert.equal(result.catalog.version, result.metadata.version);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("압축 파일의 길이·해시와 압축 해제된 길이·해시가 모두 일치해야 한다", () => {
  const changed = Buffer.from(bytes);
  changed[20] = changed[20]! ^ 1;
  assert.throws(() => decodeLocalPillPhotoCatalog(changed, manifest), /fixture_catalog_hash_mismatch/);
  assert.throws(() => decodeLocalPillPhotoCatalog(bytes.subarray(1), manifest), /fixture_catalog_hash_mismatch/);
  assert.throws(() => decodeLocalPillPhotoCatalog(bytes, withCatalog({ uncompressedBytes: manifest.catalog.uncompressedBytes - 1 })), /fixture_catalog_hash_mismatch/);
  assert.throws(() => decodeLocalPillPhotoCatalog(bytes, withCatalog({ uncompressedSha256: "0".repeat(64) })), /fixture_catalog_hash_mismatch/);
});

test("카탈로그 메타데이터의 경로·용도·크기 제한과 검증 시각을 확인한다", () => {
  for (const invalid of [
    null,
    { ...manifest, purpose: "production" },
    { ...manifest, catalog: { ...manifest.catalog, file: "../other.json.gz" } },
    withCatalog({ bytes: 4 * 1024 * 1024 + 1 }),
    withCatalog({ uncompressedBytes: 64 * 1024 * 1024 + 1 }),
    withCatalog({ verifiedAt: "not-a-date" }),
  ]) assert.throws(() => decodeLocalPillPhotoCatalog(bytes, invalid), /local_catalog_manifest_invalid/);
  assert.throws(() => decodeLocalPillPhotoCatalog(bytes, withCatalog({ records: 4 })), /fixture_catalog_invalid/);
});

test("외부 해시가 일치하더라도 내부 스냅샷 스키마가 잘못되면 거절한다", () => {
  const raw = Buffer.from(JSON.stringify({ schemaVersion: 999, items: [] }));
  const compressed = gzipSync(raw);
  const forged = withCatalog({ bytes: compressed.length, sha256: sha256(compressed), uncompressedBytes: raw.length, uncompressedSha256: sha256(raw) });
  assert.throws(() => decodeLocalPillPhotoCatalog(compressed, forged), /fixture_catalog_invalid/);
});
