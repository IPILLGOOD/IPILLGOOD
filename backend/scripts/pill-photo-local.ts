// Node-only personal photo testing. This is not an HTTP upload endpoint.
import { appendFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PILL_PHOTO_PROMPT_VERSION } from "../src/pill-photo-features.ts";
import { analyzePreparedPillPhotos, type PillPhotoComparison } from "../src/pill-photo-analysis.ts";
import { PILL_PHOTO_OCR_PROMPT_VERSION, PILL_PHOTO_FUSION_VERSION } from "../src/pill-photo-ocr.ts";
import { PILL_PHONE_PHOTO_PREPROCESSING_VERSION } from "../src/pill-photo-preprocessing.ts";
import {
  preparePhonePillPhotoRequests,
  type PhotoExtractionResult, type PillPhotoRequestTrace, type PillPhotoExecutionMode,
  type PillPhotoOcrImageCount,
} from "../src/pill-photo-pipeline.ts";
import { loadLocalPillPhotoCatalog } from "../test-support/pill-photo-local-catalog.ts";
import { readBoundedFixtureFile } from "../test-support/pill-photo-fixture.ts";

export const PILL_PHOTO_LOCAL_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const PILL_PHOTO_LOCAL_DIRECTORY = join(PILL_PHOTO_LOCAL_ROOT, "local-pill-photos");
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const DEFAULT_MODEL = "gpt-5.6-sol";

export const PILL_PHOTO_LOCAL_HELP = `IPILLGOOD 로컬 알약 사진 테스트 (Node.js 24)

프로젝트 루트에서:
  npm run pill:local                          파일/전처리 확인만, API 호출 없음
  npm run pill:local -- --live                 Vision + 앞뒤 OCR 세 요청 병렬 실행
  npm run pill:local -- --live --execution sequential   기존 순차 실행과 비교
  npm run pill:local -- --live --ocr-images 4   OCR 한 면당 4장 입력과 비교
  npm run pill:local -- --front local-pill-photos/input/a.jpg --back local-pill-photos/input/b.jpg --live

기본 사진: local-pill-photos/input/front.jpg, back.jpg
입력: 같은 온전한 알약의 앞면과 뒷면 JPG/JPEG 2장, 각각 최대 5MiB / 2,500만 화소.
알약을 사진 중앙에 두세요. 현재 전처리는 중앙 영역을 확대합니다.
상대 경로는 실행 위치와 관계없이 IPILLGOOD 루트를 기준으로 해석합니다.
--live는 지정한 두 사진의 가공본을 외부 AI API로 전송합니다.
OPENAI_API_KEY를 사용하며, 없으면 front/.env.local에서 읽습니다.
기본 Vision/OCR 모델은 ${DEFAULT_MODEL}, reasoning=low입니다.
선택 사항: --model <Vision 모델>, --ocr-model <OCR 모델>
OCR 입력: --ocr-images 8|4 (한 면당 장수, 기본값: 8)
4장은 컬러·대비 보정 각각 0도·180도입니다. 전처리는 유지하고 첨부 이미지만 줄입니다.
요청 방식: --execution parallel|sequential (로컬 명령 기본값: parallel)
병렬 실행은 세 요청을 모두 수집하며, 하나라도 실패하면 후보를 검색하지 않습니다.
OPENAI_MODEL / OPENAI_OCR_MODEL은 이 명령의 기본 모델을 바꾸지 않습니다.

결과는 local-pill-photos/results/run-*/result.json에 매번 새로 저장됩니다.
원본 사진은 보존됩니다. 사진과 결과 폴더는 Git에서 제외됩니다.
카탈로그는 날짜와 버전이 표시되는 고정 로컬 테스트 데이터입니다.
반환값은 후보 또는 보류/재촬영 결과이며 약의 정답을 확정하지 않습니다.
자동 재시도나 반복 호출은 없습니다. 반복 테스트할 때 명령을 다시 실행하세요.`;

export interface LocalPillPhotoOptions {
  front: string;
  back: string;
  live: boolean;
  model: string;
  ocrModel: string;
  executionMode?: PillPhotoExecutionMode;
  ocrImageCount?: PillPhotoOcrImageCount;
}

export function parseLocalPillPhotoArgs(args: string[]): LocalPillPhotoOptions {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!;
    if (!["--front", "--back", "--live", "--model", "--ocr-model", "--execution", "--ocr-images"].includes(flag) || flags.has(flag)) {
      throw new Error("local_invalid_arguments");
    }
    const value = flag === "--live" ? "true" : args[++index];
    if (!value || value.startsWith("--")) throw new Error("local_invalid_arguments");
    flags.set(flag, value);
  }
  const model = flags.get("--model") ?? DEFAULT_MODEL;
  const ocrModel = flags.get("--ocr-model") ?? DEFAULT_MODEL;
  const executionMode = flags.get("--execution") ?? "parallel";
  if (executionMode !== "parallel" && executionMode !== "sequential") throw new Error("local_invalid_arguments");
  const ocrImages = flags.get("--ocr-images") ?? "8";
  if (ocrImages !== "4" && ocrImages !== "8") throw new Error("local_invalid_arguments");
  if (![model, ocrModel].every((value) => /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,100}$/.test(value) && !/^sk-/i.test(value))) {
    throw new Error("local_invalid_model");
  }
  const paths = [flags.get("--front") ?? "local-pill-photos/input/front.jpg", flags.get("--back") ?? "local-pill-photos/input/back.jpg"];
  if (paths.some((path) => /^(?:https?|file|data):/i.test(path) || path.includes("\0"))) throw new Error("local_invalid_arguments");
  return {
    front: resolve(PILL_PHOTO_LOCAL_ROOT, paths[0]!), back: resolve(PILL_PHOTO_LOCAL_ROOT, paths[1]!),
    live: flags.has("--live"), model, ocrModel, executionMode, ocrImageCount: ocrImages === "4" ? 4 : 8,
  };
}

type Comparison = PillPhotoComparison;
type CatalogMetadata = Awaited<ReturnType<typeof loadLocalPillPhotoCatalog>>["metadata"];
type Preparation = Extract<Awaited<ReturnType<typeof preparePhonePillPhotoRequests>>, { ok: true }>;

export interface LocalPillPhotoReport {
  schemaVersion: "pill-photo-local.v2";
  status: "prepared" | "complete" | "failed";
  startedAt: string;
  elapsedMs: number;
  runtime: { node: string; platform: string; arch: string };
  inputs: { front: string; back: string; sha256: string[] };
  pipeline: { model: string; ocrModel: string; reasoning: "low"; preprocessing: string; visionPrompt: string; ocrPrompt: string; fusion: string;
    executionMode: PillPhotoExecutionMode; ocrImageCount: PillPhotoOcrImageCount };
  timings: { preprocessingMs: number; catalogMs: number; analysisWallMs: number; searchMs: number };
  catalog: CatalogMetadata;
  preprocessing: Preparation["preprocessing"];
  requestIntents: number;
  requestTrace: LocalPillPhotoTrace[];
  extraction: PhotoExtractionResult | null;
  comparison: Comparison | null;
  failureReason?: string;
}

export type LocalPillPhotoTrace = PillPhotoRequestTrace & { offsetMs: number };

/** Serialize writes only, not HTTP requests. A failed write blocks subsequent writes/transmission starts. */
export function createLocalPillPhotoTraceWriter(write: (event: LocalPillPhotoTrace) => Promise<void>) {
  let queue = Promise.resolve();
  return (event: LocalPillPhotoTrace) => {
    const snapshot = structuredClone(event);
    queue = queue.then(() => write(snapshot));
    return queue;
  };
}

const friendlyErrors: Record<string, string> = {
  local_invalid_arguments: "실행 인자를 확인해주세요. --help에서 사용 방법을 볼 수 있습니다.",
  local_invalid_model: "모델 이름을 확인해주세요.",
  local_input_unreadable: "사진 파일을 읽을 수 없습니다. 앞뒤 파일 경로를 확인해주세요.",
  local_input_changed: "비교 대상으로 고정한 사진과 파일 내용이 달라졌습니다. 사진을 확인해주세요.",
  local_input_too_large: "사진은 각각 5MiB 이하의 일반 파일이어야 합니다.",
  local_api_key_required: "OPENAI_API_KEY가 필요합니다. 환경 변수 또는 front/.env.local에 설정해주세요.",
  local_env_unreadable: "front/.env.local을 읽지 못했습니다. 파일 접근 권한을 확인해주세요.",
  local_catalog_unavailable: "고정 테스트 카탈로그를 읽거나 검증하지 못했습니다.",
  local_output_unavailable: "실행 결과 폴더에 기록하지 못했습니다.",
  local_execution_failed: "분석 실행 또는 결과 기록 중 오류가 발생했습니다. 저장된 요청 기록을 확인해주세요.",
  invalid_photo: "JPG/JPEG 사진인지 확인해주세요. 각각 5MiB / 2,500만 화소 이하의 앞뒤 사진이 필요합니다.",
  duplicate_photo: "앞면과 뒷면에 같은 사진을 지정했습니다. 서로 다른 두 사진이 필요합니다.",
  not_configured: "API 키 또는 모델 설정을 확인해주세요.",
  transfer_not_confirmed: "실제 분석을 실행하려면 --live를 지정해주세요.",
  access_denied: "AI API 인증 또는 모델 접근 권한을 확인해주세요.",
  rate_limited: "AI API 요청 한도에 도달했습니다. 잠시 후 다시 실행해주세요.",
  timeout: "AI API 응답 시간이 초과되었습니다. 자동 재시도는 하지 않았습니다.",
  network_error: "AI API에 연결하지 못했습니다. 인터넷 연결을 확인해주세요.",
  provider_unavailable: "AI API가 정상 응답하지 않았습니다.",
  refused: "AI가 사진 분석 요청을 처리하지 못했습니다.",
  incomplete_response: "AI 분석 응답이 완성되지 않았습니다.",
  invalid_response: "AI 분석 응답 형식이 올바르지 않습니다.",
  invalid_request: "AI API가 요청을 처리하지 못했습니다. 모델 설정을 확인해주세요.",
  ocr_failed: "각인 OCR 응답을 해석하지 못했습니다.",
  fusion_failed: "외형과 각인 분석 결과를 통합하지 못했습니다.",
};

export function localPillPhotoErrorMessage(reason: string): string {
  return friendlyErrors[reason] ?? "로컬 사진 테스트를 완료하지 못했습니다.";
}

async function readPhoto(path: string) {
  try { return await readBoundedFixtureFile(path, MAX_PHOTO_BYTES); }
  catch (error) {
    throw new Error(error instanceof Error && error.message === "fixture_size_exceeded" ? "local_input_too_large" : "local_input_unreadable");
  }
}

function resolveApiKey(): string {
  if (process.env.OPENAI_API_KEY?.trim()) return process.env.OPENAI_API_KEY.trim();
  try { loadEnvFile(join(PILL_PHOTO_LOCAL_ROOT, "front/.env.local")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("local_env_unreadable");
  }
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("local_api_key_required");
  return key;
}

/** Internal test/comparison dependencies, never accepted as CLI flags. */
export async function runLocalPillPhoto(options: LocalPillPhotoOptions, dependencies: {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  outputRoot?: string;
  onProgress?: (message: string) => void;
  expectedInputSha256?: readonly [string, string];
} = {}): Promise<{ directory: string; report: LocalPillPhotoReport }> {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  // Programmatic callers and existing reviewed tools retain the sequential default.
  const executionMode = options.executionMode ?? "sequential";
  if (executionMode !== "sequential" && executionMode !== "parallel") throw new Error("local_invalid_arguments");
  const ocrImageCount = options.ocrImageCount === undefined ? 8 : options.ocrImageCount;
  if (ocrImageCount !== 4 && ocrImageCount !== 8) throw new Error("local_invalid_arguments");
  // Select and read these two files once. Later path changes cannot change uploaded bytes.
  const photos = await Promise.all([readPhoto(options.front), readPhoto(options.back)]) as [Buffer, Buffer];
  dependencies.onProgress?.("사진 형식 확인 및 전처리 중…");
  const prepared = await preparePhonePillPhotoRequests(photos, { model: options.model, ocrModel: options.ocrModel, ocrImageCount });
  if (!prepared.ok) throw new Error(prepared.reason);
  if (dependencies.expectedInputSha256 && prepared.sourceSha256.some((hash, index) => hash !== dependencies.expectedInputSha256![index])) {
    throw new Error("local_input_changed");
  }
  const preprocessingMs = Math.round(performance.now() - started);
  const catalogStarted = performance.now();
  let loaded: Awaited<ReturnType<typeof loadLocalPillPhotoCatalog>>;
  try { loaded = await loadLocalPillPhotoCatalog(); }
  catch { throw new Error("local_catalog_unavailable"); }
  const catalogMs = Math.round(performance.now() - catalogStarted);
  // Validate both photos and the catalog before looking up credentials or making requests.
  const apiKey = options.live ? (dependencies.apiKey?.trim() || resolveApiKey()) : undefined;
  const outputRoot = dependencies.outputRoot ?? join(PILL_PHOTO_LOCAL_DIRECTORY, "results");
  let directory: string;
  try { await mkdir(outputRoot, { recursive: true }); directory = await mkdtemp(join(outputRoot, "run-")); }
  catch { throw new Error("local_output_unavailable"); }
  const report: LocalPillPhotoReport = {
    schemaVersion: "pill-photo-local.v2", status: "prepared", startedAt, elapsedMs: 0,
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    inputs: { front: options.front, back: options.back, sha256: prepared.sourceSha256 },
    pipeline: { model: options.model, ocrModel: options.ocrModel, reasoning: "low", preprocessing: PILL_PHONE_PHOTO_PREPROCESSING_VERSION,
      visionPrompt: PILL_PHOTO_PROMPT_VERSION, ocrPrompt: PILL_PHOTO_OCR_PROMPT_VERSION, fusion: PILL_PHOTO_FUSION_VERSION, executionMode, ocrImageCount },
    timings: { preprocessingMs, catalogMs, analysisWallMs: 0, searchMs: 0 },
    catalog: loaded.metadata, preprocessing: prepared.preprocessing, requestIntents: 0, requestTrace: [], extraction: null, comparison: null,
  };
  try {
    await writeFile(join(directory, "input.json"), `${JSON.stringify({ ...report, live: options.live }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    if (options.live) {
      const tracePath = join(directory, "requests.jsonl");
      // Establish output access before any transfer. Only redacted stage metadata is recorded.
      await writeFile(tracePath, "", { flag: "wx", mode: 0o600 });
      let completed = 0;
      const record = createLocalPillPhotoTraceWriter(async (event) => {
        await appendFile(tracePath, `${JSON.stringify(event)}\n`);
        report.requestTrace.push(event);
        const stage = { vision: "외형 분석", ocrFront: "앞면 각인 OCR", ocrBack: "뒷면 각인 OCR" }[event.stage];
        if (event.phase === "started") {
          report.requestIntents++;
          dependencies.onProgress?.(`${stage} 요청 시작 (${report.requestIntents}/3)`);
        } else {
          completed++;
          dependencies.onProgress?.(`${stage} 응답 종료 (${completed}/3) · ${(event.elapsedMs / 1000).toFixed(1)}초`);
        }
      });
      const analysis = await analyzePreparedPillPhotos(prepared, loaded.catalog, {
        allowExternalTransfer: true, apiKey, fetchImpl: dependencies.fetchImpl, executionMode,
        onRequestTrace: event => record({ ...event, offsetMs: Math.round(performance.now() - started) }),
      });
      report.extraction = analysis.extraction;
      report.comparison = analysis.comparison;
      report.timings.analysisWallMs = analysis.timings.analysisWallMs;
      report.timings.searchMs = analysis.timings.searchMs;
      if (analysis.ok) {
        report.status = "complete";
      } else {
        report.status = "failed";
        report.failureReason = analysis.reason === "analysis_failed" ? "local_execution_failed" : analysis.reason;
      }
    }
  } catch {
    // Never persist raw provider/FS errors, request bodies, API keys, or authorization headers.
    report.status = "failed";
    report.failureReason = "local_execution_failed";
  }
  report.elapsedMs = Math.round(performance.now() - started);
  try { await writeFile(join(directory, "result.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 }); }
  catch { throw new Error("local_output_unavailable"); }
  return { directory, report };
}

export function formatLocalPillPhotoResult(result: { directory: string; report: LocalPillPhotoReport }): string {
  const { report } = result;
  const lines = [
    `고정 테스트 카탈로그: ${report.catalog.verifiedAt.slice(0, 10)} / ${report.catalog.records.toLocaleString("ko-KR")}개 기록`,
    `모델: Vision ${report.pipeline.model} / OCR ${report.pipeline.ocrModel}`,
    `요청 방식: ${report.pipeline.executionMode === "parallel" ? "병렬 (동시 최대 3개)" : "순차"}`,
    `OCR 입력: 한 면당 ${report.pipeline.ocrImageCount}장 (컬러·대비 보정 각각 ${report.pipeline.ocrImageCount === 4 ? "0도·180도" : "0도·90도·180도·270도"})`,
  ];
  if (report.status === "prepared") lines.push("입력·전처리 확인 완료. API는 호출하지 않았습니다. 실제 분석은 --live로 실행하세요.");
  else if (report.status === "failed") lines.push(`분석 실패: ${localPillPhotoErrorMessage(report.failureReason ?? "")}`);
  else if (report.extraction?.ok) {
    const observation = report.extraction.features.observation;
    const imprints = (side: typeof observation.front) => !side ? "면 확인 불가"
      : side.noImprintObserved ? "각인 없음" : side.imprintCandidates.join(" / ") || "판독 불가";
    lines.push(`외형: ${observation.shape ?? "미상"} / ${observation.colors.join(", ") || "색상 미상"}`,
      `앞면 각인: ${imprints(observation.front)}`, `뒷면 각인: ${imprints(observation.back)}`);
    const search = report.comparison?.search;
    lines.push(`검색 상태: ${search?.status ?? report.comparison?.status} (${search?.reason ?? report.comparison?.reason})`);
    if (search) {
      lines.push(search.message);
      if (search.candidates.length) {
        lines.push(`상위 후보 ${Math.min(5, search.candidates.length)}개 (전체 반환 목록은 result.json):`);
        search.candidates.slice(0, 5).forEach((candidate, index) => {
          const item = candidate.variants[0]?.item;
          lines.push(`${index + 1}. ${item?.productName ?? candidate.itemSeq} / ${item?.manufacturer ?? "제조사 미상"} / 품목코드 ${candidate.itemSeq}`);
        });
      } else lines.push("일반 후보가 없습니다.");
      if (search.heldCandidates.length) lines.push(`별도 검토 대상 ${search.heldCandidates.length}개는 result.json의 heldCandidates에 기록했습니다.`);
      lines.push(search.notice);
    } else lines.push("같은 알약의 앞면과 뒷면이 선명하게 보이도록 다시 촬영해주세요.");
  }
  lines.push(`전처리 ${(report.timings.preprocessingMs / 1000).toFixed(1)}초 / 카탈로그 ${(report.timings.catalogMs / 1000).toFixed(1)}초 / 분석 구간 ${(report.timings.analysisWallMs / 1000).toFixed(1)}초 / 검색 ${(report.timings.searchMs / 1000).toFixed(1)}초`,
    `외부 요청 시도: ${report.requestIntents}회 / 소요 시간: ${(report.elapsedMs / 1000).toFixed(1)}초`,
    `결과: ${join(result.directory, "result.json")}`);
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.slice(2).length === 1 && process.argv[2] === "--help") console.log(PILL_PHOTO_LOCAL_HELP);
  else {
    Promise.resolve().then(() => parseLocalPillPhotoArgs(process.argv.slice(2)))
      .then((options) => runLocalPillPhoto(options, { onProgress: (message) => console.error(message) }))
      .then((result) => { console.log(formatLocalPillPhotoResult(result)); if (result.report.status === "failed") process.exitCode = 1; })
      .catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : "";
        console.error(localPillPhotoErrorMessage(reason));
        process.exitCode = 1;
      });
  }
}
