import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import {
  formatLocalPillPhotoResult, localPillPhotoErrorMessage, parseLocalPillPhotoArgs,
  PILL_PHOTO_LOCAL_ROOT, runLocalPillPhoto,
} from "../scripts/pill-photo-local.ts";
import { loadLocalPillPhotoCatalog } from "./pill-photo-local-catalog.ts";
import { PILL_PHOTO_OCR_SIDE_SCHEMA_VERSION } from "../src/pill-photo-ocr.ts";
import { type PillPhotoFeatures, pillPhotoFeaturesSchema } from "../src/pill-photo-features.ts";

async function inputs() {
  const directory = await mkdtemp(join(tmpdir(), "ipillgood-photo-local-test-"));
  const front = await sharp({ create: { width: 320, height: 240, channels: 3, background: "white" } }).jpeg().toBuffer();
  const back = await sharp({ create: { width: 320, height: 240, channels: 3, background: "gray" } }).jpeg().toBuffer();
  const paths = { front: join(directory, "front.jpg"), back: join(directory, "back.jpg") };
  await writeFile(paths.front, front);
  await writeFile(paths.back, back);
  return { directory, paths, front, back, options: { ...paths, live: false, model: "gpt-5.6-sol", ocrModel: "gpt-5.6-sol" } };
}

const envelope = (value: unknown) => Response.json({
  status: "completed", model: "mock-model", id: "resp_mock",
  output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(value) }] }],
  usage: { input_tokens: 10, output_tokens: 5 },
});

async function matchingFeatures(): Promise<{ features: PillPhotoFeatures; itemSeq: string }> {
  const { catalog } = await loadLocalPillPhotoCatalog();
  const item = catalog.items.find((row) => row.formName === "정제" && /^[A-Z0-9]{5,8}$/.test(row.front.imprint ?? "")
    && !row.front.imprintHasDescription && !row.back.imprintHasDescription && (row.back.imprint?.length ?? 0) < 10);
  assert.ok(item);
  const side = (imprint: string | null, scoreLine: typeof item.front.scoreLine) => ({
    imprintCandidates: imprint ? [imprint] : [], noImprintObserved: !imprint,
    imprintVisibility: "clear", scoreLine,
  });
  return { itemSeq: item.itemSeq, features: pillPhotoFeaturesSchema.parse({
    observation: { schemaVersion: "pill-observation.v2", form: "tablet", integrity: "intact", count: 1,
      overlapping: false, quality: "clear", shape: null, colors: [],
      front: side(item.front.imprint, item.front.scoreLine), back: side(item.back.imprint, item.back.scoreLine) },
    pairConsistency: "consistent", bothSidesVisible: true, imageArtifact: "none",
  }) };
}

test("local CLI resolves root-relative pairs, requires explicit live, keeps baseline models and rejects malformed flags", () => {
  const parsed = parseLocalPillPhotoArgs([]);
  assert.equal(parsed.front, join(PILL_PHOTO_LOCAL_ROOT, "local-pill-photos/input/front.jpg"));
  assert.equal(parsed.back, join(PILL_PHOTO_LOCAL_ROOT, "local-pill-photos/input/back.jpg"));
  assert.equal(parsed.live, false);
  assert.equal(parsed.model, "gpt-5.6-sol");
  assert.equal(parsed.ocrModel, "gpt-5.6-sol");
  const custom = parseLocalPillPhotoArgs(["--front", "사진/앞.jpg", "--back", "사진/뒤.jpg", "--live", "--model", "test-vision"]);
  assert.equal(custom.front, resolve(PILL_PHOTO_LOCAL_ROOT, "사진/앞.jpg"));
  assert.equal(custom.live, true);
  assert.equal(custom.model, "test-vision");
  assert.equal(custom.ocrModel, "gpt-5.6-sol");
  for (const args of [["--front"], ["--live", "--live"], ["--unknown"], ["--front", "https://example.com/a.jpg"],
    ["--model", "sk-fake-not-a-real-key"], ["--model", "bad model"], ["--back", "--live"]]) {
    assert.throws(() => parseLocalPillPhotoArgs(args));
  }
});

test("new JPEG pair preflight makes zero external requests and repeated runs preserve photos and previous results", async () => {
  const fixture = await inputs();
  try {
    let requests = 0;
    const dependencies = { outputRoot: join(fixture.directory, "results"), fetchImpl: (async () => { requests++; throw new Error("no network"); }) as typeof fetch };
    const first = await runLocalPillPhoto(fixture.options, dependencies);
    const second = await runLocalPillPhoto(fixture.options, dependencies);
    assert.equal(requests, 0);
    assert.notEqual(first.directory, second.directory);
    assert.equal(first.report.status, "prepared");
    assert.equal(first.report.requestIntents, 0);
    assert.equal(first.report.extraction, null);
    assert.equal(first.report.catalog.records, 25387);
    assert.equal(first.report.catalog.mode, "fixed_local_test_snapshot");
    assert.match(first.report.catalog.verifiedAt, /^2026-08-31T/);
    assert.deepEqual(await readFile(fixture.paths.front), fixture.front);
    assert.deepEqual(await readFile(fixture.paths.back), fixture.back);
    const saved = await readFile(join(first.directory, "result.json"), "utf8");
    assert.deepEqual(JSON.parse(saved), first.report);
    assert.ok(!saved.includes("data:image") && !saved.includes("Authorization"));
    assert.match(formatLocalPillPhotoResult(first), /API는 호출하지 않았습니다/);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

test("mocked live CLI runs actual preprocessing, Vision+both OCR, fusion and full catalog search, and records product candidates", async () => {
  const fixture = await inputs();
  try {
    const { features, itemSeq } = await matchingFeatures();
    const requests: { model: string; text: { format: { name: string } }; input: unknown }[] = [];
    const secret = "synthetic-test-key-never-real";
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      assert.ok(String(init?.body).includes("data:image/png;base64,"));
      if (requests.length === 1) return envelope(features);
      const observed = requests.length === 2 ? features.observation.front! : features.observation.back!;
      const { scoreLine: _scoreLine, ...side } = observed;
      void _scoreLine;
      return envelope({ schemaVersion: PILL_PHOTO_OCR_SIDE_SCHEMA_VERSION, side });
    };
    const result = await runLocalPillPhoto({ ...fixture.options, live: true }, {
      outputRoot: join(fixture.directory, "results"), apiKey: secret, fetchImpl,
    });
    assert.equal(result.report.status, "complete");
    assert.equal(requests.length, 3);
    assert.deepEqual(requests.map((body) => body.text.format.name), ["pill_visible_features", "pill_imprint_ocr_side", "pill_imprint_ocr_side"]);
    assert.equal(result.report.requestIntents, 3);
    assert.equal(result.report.requestTrace.length, 6);
    assert.equal(result.report.comparison?.search?.metrics.catalogRecords, 25387);
    assert.ok(result.report.comparison?.search?.candidates.some((candidate) => candidate.itemSeq === itemSeq));
    assert.ok(result.report.extraction?.ok && result.report.extraction.signals?.vision && result.report.extraction.signals?.ocr);
    assert.match(formatLocalPillPhotoResult(result), /상위 후보/);
    for (const file of await readdir(result.directory)) {
      const saved = await readFile(join(result.directory, file), "utf8");
      assert.ok(!saved.includes(secret) && !saved.includes("data:image") && !saved.includes("Authorization"));
    }
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

test("provider failure records a failed run, suppresses raw error body, and does not retry or search", async () => {
  const fixture = await inputs();
  try {
    let requests = 0;
    const result = await runLocalPillPhoto({ ...fixture.options, live: true }, {
      outputRoot: join(fixture.directory, "results"), apiKey: "synthetic-key", fetchImpl: async () => {
        requests++;
        return new Response("private upstream details never expose", { status: 429 });
      },
    });
    assert.equal(requests, 1);
    assert.equal(result.report.status, "failed");
    assert.equal(result.report.failureReason, "rate_limited");
    assert.equal(result.report.comparison, null);
    assert.match(formatLocalPillPhotoResult(result), /요청 한도/);
    assert.ok(!(await readFile(join(result.directory, "result.json"), "utf8")).includes("private upstream"));
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

test("missing, duplicate, disguised non-JPEG and oversized inputs fail before external requests", async () => {
  const fixture = await inputs();
  try {
    let requests = 0;
    const dependencies = { outputRoot: join(fixture.directory, "results"), apiKey: "synthetic-key",
      fetchImpl: (async () => { requests++; throw new Error("no network"); }) as typeof fetch };
    const base = { ...fixture.options, live: true };
    await assert.rejects(runLocalPillPhoto({ ...base, front: join(fixture.directory, "missing.jpg") }, dependencies), /local_input_unreadable/);
    await assert.rejects(runLocalPillPhoto({ ...base, back: base.front }, dependencies), /duplicate_photo/);
    await writeFile(fixture.paths.front, "not a jpeg; do not transmit");
    await assert.rejects(runLocalPillPhoto(base, dependencies), /invalid_photo/);
    await writeFile(fixture.paths.front, Buffer.alloc(5 * 1024 * 1024 + 1));
    await assert.rejects(runLocalPillPhoto(base, dependencies), /local_input_too_large/);
    assert.equal(requests, 0);
    assert.ok(!localPillPhotoErrorMessage("private secret path").includes("private secret path"));
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});
