import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import manifestFactory from "../src/app/manifest.ts";

const publicDirectory = new URL("../public/", import.meta.url);

test("신규 사용자 설치에 필요한 PWA manifest와 아이콘을 제공한다", async () => {
  const manifest = manifestFactory();
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/today");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.lang, "ko-KR");

  const requiredIcons = new Map([
    ["/icons/pwa-192.png", [192, 192]],
    ["/icons/pwa-512.png", [512, 512]],
    ["/icons/pwa-maskable-512.png", [512, 512]],
  ]);
  for (const icon of manifest.icons ?? []) {
    if (typeof icon.src !== "string" || !requiredIcons.has(icon.src)) continue;
    const image = await readFile(new URL(icon.src.replace(/^\//, ""), publicDirectory));
    assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.deepEqual(
      [image.readUInt32BE(16), image.readUInt32BE(20)],
      requiredIcons.get(icon.src),
    );
    requiredIcons.delete(icon.src);
  }
  assert.deepEqual([...requiredIcons.keys()], []);
});
