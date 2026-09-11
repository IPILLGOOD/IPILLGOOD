import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readBoundedFixtureFile } from "../test-support/pill-photo-fixture.ts";
import { comparePillPhotoTrialRuns } from "../test-support/pill-photo-trial-comparison.ts";
import { serializePillProfile } from "./profile-pill-catalog.ts";

const OUTPUT = fileURLToPath(new URL("../../verification-artifacts/pill-photo-trials/", import.meta.url));
const HELP = `Offline comparison of TWO complete controlled validation trials:
  --baseline <baseline-run-directory> --candidate <structured-observation-run-directory>

No API key, photo loading or network requests. Checks saved conditions and recomputes metrics.
Writes NEW comparison.json and comparison.html under ignored verification-artifacts/pill-photo-trials/.
Exit 0 means report generation succeeded, not that the candidate improved or is ready for users.`;

export function parsePillPhotoTrialCompareArgs(args: string[]) {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!, value = args[++index];
    if (!["--baseline", "--candidate"].includes(flag) || flags.has(flag) || !value || value.startsWith("--")) {
      throw new Error("trial_comparison_invalid_arguments");
    }
    flags.set(flag, value);
  }
  if (flags.size !== 2) throw new Error("trial_comparison_invalid_arguments");
  const baseline = resolve(flags.get("--baseline")!), candidate = resolve(flags.get("--candidate")!);
  if (baseline === candidate) throw new Error("trial_comparison_same_directory");
  return { baseline, candidate };
}

async function readRun(directory: string) {
  const read = async (name: string, maximum: number) => JSON.parse(new TextDecoder("utf-8", { fatal: true })
    .decode(await readBoundedFixtureFile(join(directory, name), maximum))) as unknown;
  return { condition: await read("condition.json", 2 * 1024 * 1024), summary: await read("summary.json", 512 * 1024) };
}

function escapeHtml(value: unknown) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function renderPillPhotoTrialComparison(report: ReturnType<typeof comparePillPhotoTrialRuns>) {
  const recallRows = report.recall.map(({ k, before, after }) => `<tr><th>recall@${k}</th><td>${before.hitsByRepetition.join(" / ")}</td><td>${after.hitsByRepetition.join(" / ")}</td><td>${before.totalHits} → ${after.totalHits} / 18</td></tr>`).join("");
  const ranks = (values: (number | null)[]) => values.map((value) => value ?? "후보 없음").join(" / ");
  const caseRows = report.rows.map((row) => `<tr><th>${escapeHtml(row.id)}</th><td>${escapeHtml(ranks(row.beforeRanks))}</td><td>${escapeHtml(ranks(row.afterRanks))}</td><td>${row.beforeVaried} → ${row.afterVaried}</td></tr>`).join("");
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>알약 관찰 프롬프트 비교</title><style>body{font:16px/1.6 system-ui;max-width:1080px;margin:40px auto;padding:0 24px;color:#193330;background:#f7faf9}table{border-collapse:collapse;width:100%;background:white}th,td{border:1px solid #ccd8d4;padding:10px;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef3f1;padding:16px}small{color:#45635a}</style><h1>알약 관찰 프롬프트 비교</h1><p>판정: <strong>${escapeHtml(report.decision)}</strong></p><p>동일한 validation 6제품 × 조건별 3회. 18개의 새로운 제품이 아닙니다. 운영 준비도·일반화 주장은 없습니다.</p><h2>회차별 정답 후보 포함 수 (각 6제품)</h2><table><tr><th>지표</th><th>기존 1 / 2 / 3회</th><th>후보 1 / 2 / 3회</th><th>반복 합계</th></tr>${recallRows}</table><h2>사례별 정답 순위</h2><table><tr><th>사례</th><th>기존 순위</th><th>후보 순위</th><th>반복 결과 변화</th></tr>${caseRows}</table><h2>안전·채택 기준</h2><pre>${escapeHtml(JSON.stringify({ checks: report.checks, safety: report.safety }, null, 2))}</pre><h2>조건과 한계</h2><pre>${escapeHtml(JSON.stringify({ metadata: report.metadata, limits: report.limits }, null, 2))}</pre><small>저장 기록의 일관성 검사이며 외부 서비스의 결정성이나 실제 요청 발생에 대한 독립 증명은 아닙니다. 비교 도구의 외부 요청: 0회.</small></html>`;
}

export async function runPillPhotoTrialComparison(args: string[]) {
  const paths = parsePillPhotoTrialCompareArgs(args);
  const report = comparePillPhotoTrialRuns(await readRun(paths.baseline), await readRun(paths.candidate));
  // Apply the existing secret redactor before either output format is written.
  const json = serializePillProfile(report), safe = JSON.parse(json) as typeof report;
  await mkdir(OUTPUT, { recursive: true });
  const directory = await mkdtemp(join(OUTPUT, "comparison-"));
  await writeFile(join(directory, "comparison.json"), json, { flag: "wx", mode: 0o600 });
  await writeFile(join(directory, "comparison.html"), renderPillPhotoTrialComparison(safe), { flag: "wx", mode: 0o600 });
  return { directory, report: safe };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length === 3 && process.argv[2] === "--help") console.log(HELP);
  else runPillPhotoTrialComparison(process.argv.slice(2)).then(({ directory, report }) => {
    console.log(serializePillProfile({ directory, decision: report.decision, externalRequests: 0, recall: report.recall, safety: report.safety }));
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    console.error(JSON.stringify({ status: "unavailable", reason: /^trial_comparison_[a-z_]+$/.test(message) ? message : "local_input_missing_or_invalid" }));
    process.exitCode = 1;
  });
}
