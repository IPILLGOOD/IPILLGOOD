import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { decodeFrozenPillCatalog, loadFrozenPillPhotoFixture, PILL_PHOTO_FIXTURE_DIRECTORY, readBoundedFixtureFile } from "./pill-photo-fixture.ts";
import { parsePillPhotoArgs, runPillPhotoExperiment, scorePillPhotoCase } from "../scripts/pill-photo.ts";
import { snapshotSearchCatalog } from "../src/pill-catalog-snapshot.ts";
import { comparePillPhotoFeatures } from "../src/pill-photo-features.ts";
import { PILL_PHOTO_EXPECTED_REJECTIONS } from "./pill-photo-review.ts";

test("공유 데이터는 전체 25387행과 기록된 6건을 해시·버전으로 검증한다", async () => {
  const data = await loadFrozenPillPhotoFixture();
  assert.equal(data.snapshot.totalCount, 25387);
  assert.equal(data.catalog.items.length, 25387);
  assert.equal(new Set(data.catalog.items.map((item) => item.itemSeq)).size, 25370);
  assert.equal(data.manifest.purpose, "historical_offline_replay_only");
  assert.equal(data.baseline.rows.length, 6);
  assert.equal(data.baseline.rows.filter((row) => row.expectedItemSeq !== null).length, 4);
});

test("압축 데이터 손상·압축 해제 해시 불일치·행 수 불일치는 정상 카탈로그가 되지 않는다", async () => {
  const { manifest } = await loadFrozenPillPhotoFixture();
  const bytes = await readBoundedFixtureFile(join(PILL_PHOTO_FIXTURE_DIRECTORY, "catalog.json.gz"), manifest.catalog.bytes);
  const changed = Buffer.from(bytes); changed[20] = changed[20]! ^ 1;
  assert.throws(() => decodeFrozenPillCatalog(changed, manifest.catalog), /fixture_catalog_hash_mismatch/);
  assert.throws(() => decodeFrozenPillCatalog(bytes, { ...manifest.catalog, uncompressedSha256: "0".repeat(64) }), /fixture_catalog_hash_mismatch/);
  assert.throws(() => decodeFrozenPillCatalog(bytes, { ...manifest.catalog, records: 4 }), /fixture_catalog_invalid/);
  await assert.rejects(readBoundedFixtureFile(join(PILL_PHOTO_FIXTURE_DIRECTORY, "catalog.json.gz"), 1), /fixture_size_exceeded/);
});

test("고정 자료의 과거 시각은 유지하고 일반 실행의 미래 시점 최신성 검사는 계속 거절한다", async () => {
  const { manifest, snapshot } = await loadFrozenPillPhotoFixture();
  assert.equal(snapshot.verifiedAt, manifest.catalog.verifiedAt);
  assert.deepEqual(snapshotSearchCatalog(snapshot, { now: new Date("2035-01-01T00:00:00Z"), maxAgeHours: 168 }), { ok: false, reason: "snapshot_expired_or_future" });
  assert.equal(parsePillPhotoArgs(["replay"]).maxAgeHours, null);
  for (const flag of [["--live"], ["--confirm-public-transfer"], ["--catalog", "elsewhere.json"], ["--max-age-hours", "168"]]) {
    assert.throws(() => parsePillPhotoArgs(["replay", ...flag]), /replay_is_frozen_and_offline/);
  }
  assert.throws(() => parsePillPhotoArgs(["evaluate", "--fixture"]), /invalid_arguments/);
});

test("저장된 특징 재생은 네트워크 없이 현재 검색기로 비교하고 사진이 연결된 새 보고서를 만든다", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("offline_replay_must_not_fetch"); };
  try {
    const { baseline, catalog } = await loadFrozenPillPhotoFixture();
    const { directory, report, failedExecution } = await runPillPhotoExperiment(["replay"]);
    assert.equal(calls, 0);
    assert.equal(failedExecution, false);
    assert.equal(report.requests, 0);
    assert.equal(report.model, null);
    assert.equal(report.maxAgeHours, null);
    assert.equal(report.replay?.recordedRequests, 6);
    assert.equal(report.replay?.recordedAt, baseline.createdAt);
    assert.deepEqual(report.rows.map((row) => row.extraction), baseline.rows.map((row) => row.extraction));
    // Keep the historical AI observations fixed, but allow genuine search improvements.
    // Replaying must recompute current results, not copy the baseline's old search/evaluation.
    for (const [index, saved] of baseline.rows.entries()) {
      const currentComparison = comparePillPhotoFeatures(saved.extraction.features, catalog);
      assert.deepEqual(report.rows[index]!.comparison, currentComparison);
      assert.deepEqual(report.rows[index]!.evaluation,
        scorePillPhotoCase(saved.expectedItemSeq, currentComparison, PILL_PHOTO_EXPECTED_REJECTIONS[saved.id]));
    }
    for (let index = 0; index < 9; index++) assert.ok((await readFile(join(directory, `photo-${index}.png`))).length > 0);
    const rendered = await readFile(join(directory, "report.html"), "utf8");
    assert.ok(rendered.includes("오프라인 재생"));
    assert.ok(rendered.includes("과거에 저장된 사진 특징"));
    assert.ok(!/<img[^>]+src="https?:/i.test(rendered));
  } finally { globalThis.fetch = originalFetch; }
});

test("공유 폴더에는 선정 자료·출처만 있고 키·로그·원본 압축파일·중복 보고서는 없다", async () => {
  const files = await readdir(PILL_PHOTO_FIXTURE_DIRECTORY, { recursive: true, withFileTypes: true });
  const names = files.filter((entry) => entry.isFile()).map((entry) => entry.name);
  assert.equal(names.filter((name) => name.endsWith(".png")).length, 9);
  assert.deepEqual(names.filter((name) => !name.endsWith(".png")).sort(), ["README.md", "SOURCES.md", "baseline.json", "catalog.json.gz", "manifest.json"]);
});
