import { execFile, spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { isAbsolute, join, resolve, win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const entrypoint = join(root, "backend", "scripts", "pill-photo-local.ts");

function probeNodeVersion(executable, env) {
  return new Promise((done) => {
    execFile(executable, ["--version"], {
      env, windowsHide: true, timeout: 5_000, maxBuffer: 1_024, encoding: "utf8",
    }, (error, stdout) => done(error ? null : stdout.trim()));
  });
}

/** Read local installations only. Importing this module neither probes nor launches a process. */
export async function findNode24({
  execPath = process.execPath, nodeVersion = process.versions.node,
  platform = process.platform, arch = process.arch, env = process.env,
  readDirectory = readdir, probeVersion = probeNodeVersion,
} = {}) {
  if (/^24\./.test(nodeVersion)) return execPath;
  const override = env.IPILLGOOD_NODE24;
  if (override !== undefined) {
    const absolute = platform === "win32" ? win32.isAbsolute(override) : isAbsolute(override);
    if (!absolute || !/^v24\.\d+\.\d+$/.test(await probeVersion(override, env) ?? "")) {
      throw new Error("node24_override_invalid");
    }
    return override;
  }
  if (platform === "win32") {
    let entries;
    try { entries = await readDirectory("C:/tools", { withFileTypes: true }); }
    catch { entries = []; }
    const candidates = entries.filter((entry) => entry.isDirectory()).map((entry) => {
      const match = /^node-v24\.(\d+)\.(\d+)-win-(x64|arm64|ia32)$/.exec(entry.name);
      return match && match[3] === arch ? { name: entry.name, minor: Number(match[1]), patch: Number(match[2]) } : null;
    }).filter(Boolean).sort((left, right) => right.minor - left.minor || right.patch - left.patch);
    for (const candidate of candidates) {
      const executable = win32.join("C:/tools", candidate.name, "node.exe");
      if (/^v24\.\d+\.\d+$/.test(await probeVersion(executable, env) ?? "")) return executable;
    }
  }
  throw new Error("node24_unavailable");
}

export async function runPillPhotoLocal(args, {
  findExecutable = findNode24, spawnChild = spawn, env = process.env, signals = process,
} = {}) {
  const executable = await findExecutable({ env });
  return new Promise((done, fail) => {
    const child = spawnChild(executable, ["--experimental-strip-types", entrypoint, ...args], {
      cwd: root, env, stdio: "inherit", windowsHide: true, shell: false,
    });
    const onInterrupt = () => child.kill("SIGINT");
    const onTerminate = () => child.kill("SIGTERM");
    signals.once("SIGINT", onInterrupt);
    signals.once("SIGTERM", onTerminate);
    const cleanup = () => {
      signals.removeListener("SIGINT", onInterrupt);
      signals.removeListener("SIGTERM", onTerminate);
    };
    child.once("error", () => { cleanup(); fail(new Error("local_launcher_failed")); });
    child.once("exit", (code, signal) => { cleanup(); done(signal ? 1 : (code ?? 1)); });
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = await runPillPhotoLocal(process.argv.slice(2)); }
  catch (error) {
    const message = error instanceof Error && error.message.startsWith("node24_")
      ? "Node.js 24 실행 파일이 필요합니다. Node.js 24를 활성화하거나 IPILLGOOD_NODE24에 Node.js 24 실행 파일의 절대 경로를 설정해주세요."
      : "로컬 알약 사진 명령을 시작하지 못했습니다. Node.js 24 실행 파일의 접근 권한을 확인해주세요.";
    console.error(message);
    process.exitCode = 1;
  }
}
