import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { join, win32 } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// This JavaScript bootstrap deliberately also runs under the user's default Node.js 22.
const { findNode24, runPillPhotoLocal } = await import(new URL("../../scripts/run-pill-photo-local.mjs", import.meta.url).href);

test("현재 Node 24를 재사용하고 프로세스나 디렉터리를 조회하지 않는다", async () => {
  const result = await findNode24({
    nodeVersion: "24.20.0", execPath: "/current/node",
    readDirectory: () => { throw new Error("unexpected_scan"); },
    probeVersion: () => { throw new Error("unexpected_process"); },
  });
  assert.equal(result, "/current/node");
});

test("명시한 실행 파일은 절대 경로와 실제 Node 24 버전을 확인한다", async () => {
  const options = { nodeVersion: "22.19.0", platform: "win32", env: { IPILLGOOD_NODE24: "C:/Node 24/node.exe" } };
  assert.equal(await findNode24({ ...options, probeVersion: async () => "v24.20.0" }), "C:/Node 24/node.exe");
  await assert.rejects(findNode24({ ...options, probeVersion: async () => "v22.19.0" }), /node24_override_invalid/);
  await assert.rejects(findNode24({ ...options, env: { IPILLGOOD_NODE24: "node.exe" } }), /node24_override_invalid/);
});

test("Windows의 기존 설치 중 아키텍처와 실제 버전이 맞는 최신 Node 24를 선택한다", async () => {
  const probes: string[] = [];
  const names = ["node-v24.9.0-win-x64", "node-v24.20.0-win-x64", "node-v24.21.0-win-arm64", "node-v26.0.0-win-x64", "unrelated"];
  const selected = await findNode24({
    nodeVersion: "22.19.0", platform: "win32", arch: "x64", env: {},
    readDirectory: async () => names.map((name) => ({ name, isDirectory: () => true })),
    probeVersion: async (path: string) => { probes.push(path); return "v24.20.0"; },
  });
  assert.equal(selected, win32.join("C:/tools", names[1]!, "node.exe"));
  assert.deepEqual(probes, [selected]);
  await assert.rejects(findNode24({ nodeVersion: "22.19.0", platform: "linux", env: {} }), /node24_unavailable/);
});

test("사진 경로와 모든 인자를 셸 해석 없이 넘기며 환경 변수와 종료 코드를 유지한다", async () => {
  const args = ["--front", "local-pill-photos/input/앞 면 $(literal).jpg", "--back", "back.jpg", "--live"];
  const env = { OPENAI_API_KEY: "synthetic-test-key", IPILLGOOD_NODE24: "C:/node24/node.exe" };
  const signals = new EventEmitter();
  const child = Object.assign(new EventEmitter(), { kill: () => true });
  const exitCode = await runPillPhotoLocal(args, {
    env, signals, findExecutable: async () => env.IPILLGOOD_NODE24,
    spawnChild: (executable: string, actualArgs: string[], options: Record<string, unknown>) => {
      assert.equal(executable, env.IPILLGOOD_NODE24);
      const root = fileURLToPath(new URL("../../", import.meta.url));
      assert.deepEqual(actualArgs, ["--experimental-strip-types", join(root, "backend", "scripts", "pill-photo-local.ts"), ...args]);
      assert.equal(options.cwd, root);
      assert.equal(options.env, env);
      assert.equal(options.windowsHide, true);
      assert.equal(options.shell, false);
      assert.equal(options.stdio, "inherit");
      queueMicrotask(() => child.emit("exit", 17, null));
      return child;
    },
  });
  assert.equal(exitCode, 17);
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
});

test("하위 프로세스 실행 실패는 원본 오류를 노출하지 않고 전달하며 시그널 리스너를 정리한다", async () => {
  const signals = new EventEmitter();
  const child = Object.assign(new EventEmitter(), { kill: () => true });
  await assert.rejects(runPillPhotoLocal(["--help"], {
    signals, findExecutable: async () => "/node24",
    spawnChild: () => {
      queueMicrotask(() => child.emit("error", new Error("sensitive-underlying-error")));
      return child;
    },
  }), (error: unknown) => error instanceof Error && error.message === "local_launcher_failed");
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
});
