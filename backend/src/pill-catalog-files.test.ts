import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { officialFeatureExamples, pillSearchMarkdown, pillSnapshotSummary, readBoundedJson, savePillSnapshot } from "../scripts/pill-catalog.ts";
import { collectPillCatalogSnapshot, snapshotSearchCatalog, validatePillCatalogSnapshot } from "./pill-catalog-snapshot.ts";
import { parseOfficialPillPage } from "./official-pill-catalog.ts";
import { pillObservationSchema, searchPillCandidates } from "./pill-identification.ts";
import { pillEnvelope, pillObservation, pillRecord } from "../test-support/pill-fixtures.ts";

const cli = fileURLToPath(new URL("../scripts/pill-catalog.ts", import.meta.url));
const repo = fileURLToPath(new URL("../../", import.meta.url));
async function fixture(data = [pillRecord()]) {
  const now = new Date();
  const result = await collectPillCatalogSnapshot({ now: () => now, readPage: async () => ({ status: "connected", ...parseOfficialPillPage(pillEnvelope(data), "json", now.toISOString()) }) });
  assert.equal(result.status, "collected");
  return result.snapshot;
}
async function temporary(context: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), "ipillgood-pill-"));
  context.after(async () => {
    // Only remove the exact directory created by this test, never a caller-supplied path.
    const parent = resolve(tmpdir());
    assert.equal(dirname(resolve(directory)), parent);
    assert.ok(relative(parent, directory).startsWith("ipillgood-pill-"));
    await rm(directory, { recursive: true });
  });
  return directory;
}

test("검증된 로컬 파일을 다시 읽어 같은 후보를 검색하고 기존 실행 파일은 덮어쓰지 않는다", async (context) => {
  const parent = await temporary(context);
  const snapshot = await fixture();
  const first = await savePillSnapshot(snapshot, parent, {});
  const bytes = await readFile(first.catalogPath, "utf8");
  const loaded = validatePillCatalogSnapshot(await readBoundedJson(first.catalogPath, 1024 * 1024));
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  const ready = snapshotSearchCatalog(loaded.snapshot, { now: new Date(), maxAgeHours: 24 });
  assert.equal(ready.ok, true);
  if (!ready.ok) return;
  const observation = await readBoundedJson(first.examples[0]!.observationPath, 16 * 1024);
  const result = searchPillCandidates(observation, ready.catalog);
  assert.equal(result.candidates[0]!.itemSeq, "209900001");
  assert.equal(result.candidates[0]!.variants[0]!.item.imageUrl, snapshot.items[0]!.imageUrl);
  const second = await savePillSnapshot(snapshot, parent, {});
  assert.notEqual(first.catalogPath, second.catalogPath);
  assert.equal(await readFile(first.catalogPath, "utf8"), bytes);
  assert.equal((await readdir(dirname(first.catalogPath))).includes("catalog.pending"), false);
});

test("미완성·변조 카탈로그와 API 키 반사 데이터는 디스크 저장 전에 거절한다", async (context) => {
  const parent = await temporary(context);
  const snapshot = await fixture();
  const altered = structuredClone(snapshot);
  altered.totalCount++;
  await assert.rejects(savePillSnapshot(altered, parent, {}));
  const reflected = await fixture([pillRecord({ ITEM_NAME: "reflected api+key=token" })]);
  await assert.rejects(savePillSnapshot(reflected, parent, { MFDS_PILL_API_KEY: "api%2Bkey%3Dtoken" }), /reflected_secret_rejected/);
  assert.deepEqual(await readdir(parent), []);
});

test("로컬 JSON 읽기는 잘린 파일·크기 초과·잘못된 인코딩·디렉터리를 거절한다", async (context) => {
  const parent = await temporary(context);
  const path = join(parent, "input.json");
  await writeFile(path, '{"incomplete":');
  await assert.rejects(readBoundedJson(path, 100));
  await writeFile(path, JSON.stringify({ large: "x".repeat(200) }));
  await assert.rejects(readBoundedJson(path, 100), /invalid_file_size/);
  await writeFile(path, Buffer.from([0x22, 0xff, 0x22]));
  await assert.rejects(readBoundedJson(path, 100));
  await assert.rejects(readBoundedJson(parent, 100));
  await assert.rejects(readBoundedJson(path, NaN), /invalid_file_size_limit/);
});

test("공식 특징 예제는 정제·캡슐·설명 포함 사례를 분리하고 사진 정확도라고 표시하지 않는다", async () => {
  const snapshot = await fixture([
    pillRecord(), pillRecord({ ITEM_SEQ: "209900002", FORM_CODE_NAME: "경질캡슐제" }),
    pillRecord({ ITEM_SEQ: "209900003", PRINT_FRONT: "A분할선B" }),
    pillRecord({ ITEM_SEQ: "209900004", FORM_CODE_NAME: "__proto__" }),
  ]);
  const examples = officialFeatureExamples(snapshot);
  assert.equal(examples.length, 3);
  for (const example of examples) {
    assert.equal(example.origin, "official_record_self_consistency_only");
    assert.equal(pillObservationSchema.safeParse(example.observation).success, true);
  }
  assert.equal(examples[1]!.observation.form, "capsule");
  const summary = pillSnapshotSummary(snapshot);
  assert.equal(summary.uniqueItemSeqs, 4);
  assert.equal(summary.unknownForms["__proto__"], 1);
  assert.equal(summary.imagesDownloaded, 0);
});

test("기존 v1 스냅샷을 바꾸지 않고 현재 제형 정책으로 예제·집계를 만든다", async () => {
  const snapshot = await fixture([
    pillRecord({ ITEM_SEQ: "209900001", FORM_CODE_NAME: "질정", PRINT_FRONT: "A분할선B" }),
    pillRecord({ ITEM_SEQ: "209900002", FORM_CODE_NAME: "장용정" }),
    pillRecord({ ITEM_SEQ: "209900003", FORM_CODE_NAME: "경질캡슐제, 공캡슐" }),
    pillRecord({ ITEM_SEQ: "209900004", FORM_CODE_NAME: "젤라틴코팅성경질캡슐제" }),
    pillRecord({ ITEM_SEQ: "209900005", FORM_CODE_NAME: "스팬슐" }),
  ]);
  const before = JSON.stringify(snapshot);
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.normalizationVersion, "mfds-pill-2026-08-31-v1");
  const examples = officialFeatureExamples(snapshot);
  assert.deepEqual(examples.map((entry) => entry.itemSeq), ["209900002", "209900004"]);
  assert.deepEqual(examples.map((entry) => entry.observation.form), ["tablet", "capsule"]);
  const summary = pillSnapshotSummary(snapshot);
  assert.deepEqual(summary.forms, { unknown: 4, capsule: 1 }, "기존 정규화 값은 그대로 보존한다");
  assert.deepEqual(summary.searchFormPolicy.counts, { tablet: 1, capsule: 1, unsupported: 2, unknown: 1 });
  const ready = snapshotSearchCatalog(snapshot, { now: new Date(), maxAgeHours: 24 });
  assert.equal(ready.ok, true);
  if (!ready.ok) return;
  const result = searchPillCandidates(examples[0]!.observation, ready.catalog);
  assert.equal(result.candidates[0]!.itemSeq, "209900002");
  assert.equal(result.metrics.unsupportedCatalogRecords, 2);
  assert.equal(validatePillCatalogSnapshot(snapshot).ok, true);
  assert.equal(JSON.stringify(snapshot), before);
});

test("보류 결과 문서는 후보 영역과 분리하고 이유·건수·정책 버전을 표시한다", async () => {
  const snapshot = await fixture([
    pillRecord({ ITEM_SEQ: "209900001", ITEM_NAME: "[보류](javascript:bad)", PRINT_FRONT: "", PRINT_BACK: "" }),
    pillRecord({ ITEM_SEQ: "209900002", FORM_CODE_NAME: "스팬슐" }),
  ]);
  const ready = snapshotSearchCatalog(snapshot, { now: new Date(), maxAgeHours: 24 });
  assert.equal(ready.ok, true);
  if (!ready.ok) return;
  const result = searchPillCandidates(pillObservation(), ready.catalog, { limit: 1 });
  const report = pillSearchMarkdown(result, snapshot);
  assert.equal(result.status, "needs_review");
  assert.match(report, /비교 후보 0개 중 0개/);
  assert.match(report, /보류 항목 2개 중 1개/);
  assert.match(report, /나머지 보류 항목 있음/);
  assert.match(report, /보류 항목 — 약을 찾았다는 의미가 아님/);
  assert.match(report, /no_imprint_evidence|unknown_official_form/);
  assert.match(report, /pill-form-policy-v1/);
  const heldStart = report.indexOf("## 보류 항목");
  assert.equal(report.slice(0, heldStart).includes("### "), false);
  assert.equal(report.includes("[보류](javascript:bad)"), false);
});

test("결과 문서는 공식 이미지 링크·근거·한계를 보여주고 제품 문구를 마크다운으로 실행하지 않는다", async () => {
  const snapshot = await fixture([pillRecord({ ITEM_NAME: "[링크](javascript:bad) <script>bad</script>" })]);
  const example = officialFeatureExamples(snapshot)[0]!;
  const ready = snapshotSearchCatalog(snapshot, { now: new Date(), maxAgeHours: 24 });
  assert.equal(ready.ok, true);
  if (!ready.ok) return;
  const report = pillSearchMarkdown(searchPillCandidates(example.observation, ready.catalog), snapshot);
  assert.match(report, /공식 이미지 열기/);
  assert.match(report, /https:\/\/nedrug.mfds.go.kr/);
  assert.match(report, /사진 인식·복용 가능 판정이 아니며/);
  assert.equal(report.includes("[링크](javascript:bad)"), false);
  assert.equal(report.includes("<script>"), false);
});

test("수집 CLI는 --live 없는 실행과 잘못된 옵션을 네트워크 호출 전에 거절한다", () => {
  for (const args of [[], ["collect"], ["collect", "--live", "--live"], ["collect", "--live", "--unknown"], ["search"]]) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", cli, ...args], { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Raw errors are suppressed/);
  }
  const help = spawnSync(process.execPath, ["--experimental-strip-types", cli, "--help"], { encoding: "utf8", timeout: 10_000 });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Search is offline/);
});

test("실제 CLI에서 파일 입력→오프라인 후보 검색→JSON·읽기용 결과 파일이 연결된다", async (context) => {
  const parent = await temporary(context);
  const snapshot = await fixture();
  const saved = await savePillSnapshot(snapshot, parent, {});
  const networkGuard = "data:text/javascript," + encodeURIComponent("globalThis.fetch = () => { throw new Error('Network must not be used by offline search'); };");
  const result = spawnSync(process.execPath, ["--import", networkGuard, "--experimental-strip-types", cli, "search", "--catalog", saved.catalogPath,
    "--observation", saved.examples[0]!.observationPath, "--max-age-hours", "24"], {
    encoding: "utf8", timeout: 10_000, cwd: parent,
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  const expectedParent = resolve(repo, "verification-artifacts/pill-catalog");
  const reportDirectory = dirname(resolve(output.reportPath));
  // Validate the exact generated directory before cleanup; never trust arbitrary CLI output as a delete target.
  assert.equal(dirname(reportDirectory), expectedParent);
  assert.ok(relative(expectedParent, reportDirectory).startsWith("search-"));
  assert.equal(relative(expectedParent, reportDirectory).includes(sep), false);
  context.after(() => rm(reportDirectory, { recursive: true }));
  assert.equal(output.status, "candidates_found");
  assert.equal(output.candidateCount, 1);
  assert.equal((await stat(output.reportPath)).isFile(), true);
  assert.match(await readFile(output.reportPath, "utf8"), /209900001/);
  const payload = JSON.parse(await readFile(output.jsonPath, "utf8"));
  assert.equal(payload.candidates[0].itemSeq, "209900001");
});

test("오프라인 CLI는 각인 부족·제형 미상 보류를 정상 결과로 반환하고 비지원은 제외한다", async (context) => {
  const parent = await temporary(context);
  const snapshot = await fixture([
    pillRecord({ PRINT_FRONT: "", PRINT_BACK: "" }),
    pillRecord({ ITEM_SEQ: "209900002", FORM_CODE_NAME: "스팬슐" }),
    pillRecord({ ITEM_SEQ: "209900003", FORM_CODE_NAME: "질정" }),
  ]);
  const saved = await savePillSnapshot(snapshot, parent, {});
  const observationPath = join(parent, "observation.json");
  await writeFile(observationPath, JSON.stringify(pillObservation()));
  const networkGuard = "data:text/javascript," + encodeURIComponent("globalThis.fetch = () => { throw new Error('No network'); };");
  const result = spawnSync(process.execPath, ["--import", networkGuard, "--experimental-strip-types", cli, "search", "--catalog", saved.catalogPath,
    "--observation", observationPath, "--max-age-hours", "24", "--limit", "1"], { encoding: "utf8", timeout: 10_000, cwd: parent });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  const expectedParent = resolve(repo, "verification-artifacts/pill-catalog");
  const reportDirectory = dirname(resolve(output.reportPath));
  assert.equal(dirname(reportDirectory), expectedParent);
  assert.ok(relative(expectedParent, reportDirectory).startsWith("search-"));
  assert.equal(relative(expectedParent, reportDirectory).includes(sep), false);
  context.after(() => rm(reportDirectory, { recursive: true }));
  assert.equal(output.status, "needs_review");
  assert.equal(output.candidateCount, 0);
  assert.equal(output.heldCandidateCount, 2);
  assert.equal(output.heldTruncated, true);
  assert.equal(output.unsupportedCatalogRecords, 1);
  const payload = JSON.parse(await readFile(output.jsonPath, "utf8"));
  assert.deepEqual(payload.candidates, []);
  assert.equal(payload.heldCandidates.length, 1);
  assert.equal(payload.formPolicyVersion, "pill-form-policy-v1");
  assert.equal(payload.searchRulesVersion, "pill-structured-v3-evidence-gate");
  assert.match(await readFile(output.reportPath, "utf8"), /보류 이유/);
});
