import { test, expect } from "@playwright/test";
import sharp from "sharp";
import axe from "axe-core";
import { dismissInstallPromptWhenShown } from "../test-support/browser-controls";
import { PILL_WEB_PREPROCESSING_VERSION } from "../../backend/src/pill-photo-web-contract";
import { parsePillWebUpload } from "../../backend/src/pill-photo-web";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, extraHTTPHeaders: { "x-forwarded-for": "192.0.2.148" } });
test.beforeEach(async ({ page, context, browserName }) => {
  await dismissInstallPromptWhenShown(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  if (browserName === "webkit") {
    // The isolated runner serves HTTP. Unlike Chromium, WebKit will not send
    // production Secure cookies on loopback. Install the API-issued demo cookie
    // for this local test context only; deployed HTTPS/auth policy is unchanged.
    const origin = new URL(page.url()).origin;
    expect(["127.0.0.1", "localhost"]).toContain(new URL(origin).hostname);
    const response = await context.request.post("/api/auth/demo", { headers: { origin, accept: "application/json" } });
    expect(response.status()).toBe(201);
    const cookie = response.headersArray().find(header => header.name.toLowerCase() === "set-cookie"
      && header.value.startsWith("care_atlas_session="))?.value.match(/^care_atlas_session=([^;]+)/);
    expect(cookie).toBeTruthy();
    await context.addCookies([{ name: "care_atlas_session", value: cookie![1]!, url: origin,
      secure: false, httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/today");
  } else {
    await page.getByRole("button", { name: "둘러보기", exact: true }).click();
  }
  await expect(page).toHaveURL(/\/today$/);
});
async function photo(color: string) {
  return sharp({ create: { width: 1000, height: 800, channels: 3, background: color } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
}
test("pill photo: actual canvas preprocessing, consent, bounded upload, result, errors and mobile reflow", async ({ page, browserName }) => {
  let requests = 0;
  let mode: "result" | "error" | "retake" = "result";
  // WebKit's intercepted postDataBuffer is lossy for binary multipart data.
  // Serialize with the browser's native Request before providing mock results.
  await page.exposeFunction("mockPillAnalysis", async (bytes: number[], contentType: string) => {
    const send = (json: unknown, status = 200) => ({ json, status });
    requests++;
    const form = await new Response(new Uint8Array(bytes), { headers: { "content-type": contentType } }).formData();
    const images = await parsePillWebUpload(form);
    expect(Object.keys(images)).toHaveLength(18);
    const metadata = await sharp(images["front-context"]).metadata();
    expect(metadata.width).toBe(800); expect(metadata.height).toBe(1000);
    expect(metadata.exif).toBeUndefined();
    if (mode === "error") return send({ message: "사진 분석을 완료하지 못했어요. 잠시 후 다시 시도해주세요." }, 503);
    return send({ status: "completed", preprocessingVersion: PILL_WEB_PREPROCESSING_VERSION,
      catalog: { version: "synthetic-browser-test", verifiedAt: "2026-09-12T00:00:00Z", totalCount: 1 },
      comparison: { status: mode === "retake" ? "needs_retake" : "searched", observation: null,
        search: mode === "retake" ? null : { status: "candidates_found", message: "비교 후보예요. 약의 확정이 아닙니다.", notice: "약 봉투와 약사 안내로 확인해주세요.", heldCandidates: [], metrics: { candidateCount: 1, heldCandidateCount: 0 },
          candidates: [{ itemSeq: "209900001", grade: "possible", variants: [{ item: { productName: "테스트 전용 정제 A", manufacturer: "가상 제조사", front: { rawImprint: "TEST" }, back: { rawImprint: "10" }, imageUrl: null }, conflicts: [], reviewReasons: [] }] }] } } });
  });
  await page.route("**/api/pills/analyze", route => route.fulfill({ json: { ready: true } }));
  await page.getByRole("button", { name: "빠른 이동", exact: true }).click();
  await page.getByRole("dialog").getByRole("link", { name: "사진으로 약 검색", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("앞뒤 사진으로 비교 후보 찾기");
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    const mock = (window as unknown as { mockPillAnalysis: (bytes: number[], contentType: string) => Promise<{ json: unknown; status: number }> }).mockPillAnalysis;
    window.fetch = async (input, init) => {
      if (input !== "/api/pills/analyze" || init?.method !== "POST") return originalFetch(input, init);
      const request = new Request(new URL(input, location.href), init);
      const result = await mock(Array.from(new Uint8Array(await request.arrayBuffer())), request.headers.get("content-type")!);
      return new Response(JSON.stringify(result.json), { status: result.status, headers: { "Content-Type": "application/json" } });
    };
  });
  const analyze = page.getByRole("button", { name: "사진으로 후보 찾기" });
  await expect(analyze).toBeDisabled();
  for (const [side, color] of [["앞면", "white"], ["뒷면", "gray"]]) {
    await expect(page.getByLabel(`${side} 사진 선택`, { exact: true })).toBeEnabled();
    await page.getByLabel(`${side} 사진 선택`, { exact: true }).setInputFiles({ name: "private-name.jpg", mimeType: "image/jpeg", buffer: await photo(color!) });
    await expect(page.getByAltText(`${side} 선택 사진`)).toBeVisible();
    await expect(page.getByText(`${side} 사진을 준비하고 있어요.`, { exact: true })).toBeHidden();
  }
  await expect(analyze).toBeDisabled();
  await page.getByRole("checkbox").check();
  await expect(analyze).toBeEnabled();
  await analyze.click();
  await expect(page.getByRole("heading", { name: "사진 비교 결과" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "테스트 전용 정제 A" })).toBeVisible();
  expect(requests).toBe(1);
  await page.evaluate(axe.source);
  const violations = await page.evaluate(async () => (window as unknown as { axe: typeof axe }).axe.run(document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
  }).then(result => result.violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) }))));
  expect(violations).toEqual([]);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `verification-artifacts/pill-photo-${browserName}-390.png`, fullPage: true });
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px`).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `verification-artifacts/pill-photo-${browserName}-320-large-text.png`, fullPage: true });
  await page.evaluate(() => document.documentElement.style.fontSize = "");
  mode = "retake"; await analyze.click();
  await expect(page.getByRole("heading", { name: "앞뒤 사진을 다시 확인해주세요" })).toBeVisible();
  await expect(page.getByText("테스트 전용 정제 A")).toHaveCount(0);
  mode = "error"; await analyze.click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("사진 분석을 완료하지 못했어요");
  await page.getByRole("button", { name: "사진 지우기" }).click();
  await expect(page.getByAltText("앞면 선택 사진")).toHaveCount(0);
  await expect(analyze).toBeDisabled();
  await page.getByLabel("앞면 사진 선택", { exact: true }).setInputFiles({ name: "bad.jpg", mimeType: "image/jpeg", buffer: Buffer.from("invalid image") });
  await expect(page.getByRole("main").getByRole("alert")).toContainText("사진을 열 수 없어요");
});
test("pill photo: unavailable catalog blocks upload, and real API enforces origin/session", async ({ page, request, browserName }) => {
  const crossOrigin = await request.post("/api/pills/analyze", { headers: { origin: "https://example.org" } });
  expect(crossOrigin.status()).toBe(403);
  const anonymous = await request.get("/api/pills/analyze"); expect(anonymous.status()).toBe(401);
  await page.goto("/medications/photo");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("공식 낱알 목록");
  await expect(page.getByLabel("앞면 사진 선택", { exact: true })).toBeDisabled();
  await page.screenshot({ path: `verification-artifacts/pill-photo-${browserName}-unavailable.png`, fullPage: true });
});
