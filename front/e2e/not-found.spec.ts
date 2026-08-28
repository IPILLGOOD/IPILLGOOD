import { test, expect } from "@playwright/test";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import axe from "axe-core";
import { emulatorFixture } from "../../backend/test-support/emulator";

test("unknown URLs return 404, remain accessible at all sizes, and recover without history", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const response = await page.goto("/missing-page-98");
    expect(response?.status()).toBe(404);
    await expect(page).toHaveURL(/\/404$/);
    await expect(page.getByRole("heading", { level: 1, name: "페이지를 찾을 수 없어요" })).toBeVisible();
    await expect(page.getByText("404 · 페이지 없음", { exact: true })).toHaveCount(0);
    await expect(page.locator(".sidebar, .mobile-nav, .mobile-header, .app-footer")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const home = page.getByRole("link", { name: "홈으로 돌아가기", exact: true });
    await expect(home).toHaveAttribute("href", "/");
    await home.focus();
    await expect(home).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect((await page.reload())?.status()).toBe(404);
  await page.getByRole("link", { name: "홈으로 돌아가기", exact: true }).press("Enter");
  await expect(page).toHaveURL(/\/$/);
  expect((await page.goto("/login"))?.status()).toBe(200);
  await page.goto("/documents/deleted-document");
  await expect(page).toHaveURL(/\/404$/);
  // Authentication remains authoritative for an existing protected route.
  await page.goto("/medications/missing-medication");
  await expect(page).toHaveURL(/\/login/);
  expect(errors).toEqual([]);
});

test("signed-in missing resources use the shared 404 and return to today", async ({ page, context }) => {
  const fixture = emulatorFixture("admin");
  const userId = `not-found-${randomUUID()}`;
  const recipientId = `google-${userId}`;
  const token = await new SignJWT({ name: "404 검증", provider: "google" }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode(process.env.SESSION_SECRET));
  await context.addCookies([{ name: "care_atlas_session", value: token, url: process.env.IPILLGOOD_TEST_BASE_URL!, httpOnly: true, sameSite: "Lax" }]);
  try {
    for (const path of ["/missing-page-98", "/medications/deleted-medication", "/documents/deleted-document"]) {
      expect((await page.goto(path))?.status()).toBe(404);
      await expect(page).toHaveURL(/\/404$/);
      await expect(page.getByRole("heading", { name: "페이지를 찾을 수 없어요" })).toBeVisible();
      await expect(page.locator(".sidebar, .mobile-nav, .mobile-header, .app-footer")).toHaveCount(0);
      await expect(page.getByRole("link", { name: "오늘 할 일로 돌아가기", exact: true })).toHaveAttribute("href", "/today");
    }
    await page.getByRole("link", { name: "오늘 할 일로 돌아가기", exact: true }).click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByRole("navigation", { name: "주요 메뉴" })).toBeVisible();
    expect((await page.goto("/medications"))?.status()).toBe(200);
    // A real render failure must remain a server error, not a missing-resource response.
    await fixture.admin.collection("careReadModels").doc(recipientId).delete();
    await fixture.admin.collection("careRecipients").doc(recipientId).delete();
    await fixture.admin.collection("careRecipients").doc(recipientId).collection("medicationPlans").doc("orphan").set({ id: "orphan" });
    expect((await page.goto("/medications/not-an-id"))?.status()).toBe(500);
    await expect(page.getByRole("heading", { name: "페이지를 찾을 수 없어요" })).toHaveCount(0);
  } finally {
    await fixture.admin.recursiveDelete(fixture.admin.collection("careRecipients").doc(recipientId));
    await fixture.admin.collection("careReadModels").doc(recipientId).delete();
    await fixture.cleanup();
  }
});

test("missing paths redirect once to the canonical URL, which remains an HTTP 404", async ({ request }) => {
  for (const path of ["/missing-page-98", "/some/missing/nested/page", "/없는-페이지?from=old-link", "/documents/deleted-document", "/profile/typo", "/medications/missing/extra"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe("/404");
  }
  const canonical = await request.get("/404", { maxRedirects: 0 });
  expect(canonical.status()).toBe(404);
  expect(canonical.headers().location).toBeUndefined();
  expect(await canonical.text()).toContain('name="robots" content="noindex"');
  expect((await request.get("/login")).status()).toBe(200);
});

test("the illustration keeps moving after a full loop without playback controls", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/404");
  await expect(page.locator(".not-found-art")).toHaveAttribute("data-ready", "true");
  await expect(page.locator(".not-found-art__animation svg")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /애니메이션/ })).toHaveCount(0);
  const animation = page.locator(".not-found-art__animation");
  await expect(animation).toHaveAttribute("data-state", "playing");
  const distinctFrames = await animation.evaluate(async (host) => {
    const frames = new Set<string>();
    const startedAt = performance.now();
    let paints = 0;
    while (performance.now() - startedAt < 750) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      paints++;
      frames.add(host.innerHTML);
    }
    return { distinct: frames.size, paints };
  });
  // Compare to actual paint opportunities rather than imposing a device frame
  // rate. Subframe interpolation must not repeat every other displayed frame.
  expect(distinctFrames.distinct).toBeGreaterThan(distinctFrames.paints * 0.8);
  // Inspect motion after the original 132-frame / 30-fps cycle has finished.
  const started = Date.now();
  await expect.poll(() => Date.now() - started, { timeout: 7_000 }).toBeGreaterThan(4_400);
  const afterFirstCycle = await animation.innerHTML();
  await expect.poll(() => animation.innerHTML()).not.toBe(afterFirstCycle);
  await expect(animation).toHaveAttribute("data-state", "playing");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".sidebar, .mobile-nav")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("refresh swaps the poster for a matching first frame without thinning outlines", async ({ page }, info) => {
  let release!: () => void;
  let pending: Promise<void>;
  await page.route("**/scene-404/lottie.json", async (route) => {
    const gate = pending;
    const response = await route.fetch();
    const animation = await response.json();
    // Freeze only this test's response at frame zero to compare the two renderers.
    // The separate loop test still exercises the unmodified animation.
    for (const layer of animation.layers) {
      for (const key of Object.keys(layer.ks)) {
        const property = layer.ks[key];
        if (property.a !== 1) continue;
        const value = property.k[0].s;
        layer.ks[key] = { a: 0, k: value.length === 1 ? value[0] : value };
      }
    }
    await gate;
    await route.fulfill({ response, json: animation });
  });

  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const reload of [false, true]) {
      pending = new Promise<void>((resolve) => { release = resolve; });
      if (reload) await page.reload();
      else await page.goto("/404");
      const art = page.locator(".not-found-art");
      const poster = page.locator(".not-found-art__poster");
      const animation = page.locator(".not-found-art__animation");
      await expect(poster).toBeVisible();
      await expect(animation).toBeHidden();
      const bounds = await art.boundingBox();
      await info.attach(`poster-${width}-${reload}`, { body: await art.screenshot(), contentType: "image/png" });
      release();
      await expect(art).toHaveAttribute("data-ready", "true");
      await expect(poster).toBeHidden();
      await expect(animation).toBeVisible();
      expect(await art.boundingBox()).toEqual(bounds);
      await info.attach(`first-frame-${width}-${reload}`, { body: await art.screenshot(), contentType: "image/png" });

      const comparison = await art.evaluate(async (element) => {
        const poster = element.querySelector<HTMLImageElement>("img")!;
        await poster.decode();
        const svg = element.querySelector("svg")!.cloneNode(true) as SVGSVGElement;
        svg.removeAttribute("style");
        const frame = new Image();
        frame.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
        await frame.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 480;
        canvas.height = 320;
        const context = canvas.getContext("2d", { willReadFrequently: true })!;
        const pixels = (image: HTMLImageElement) => {
          // Compare visible colors, not noisy RGB values at nearly transparent edges.
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, 480, 320);
          context.drawImage(image, 0, 0, 480, 320);
          return context.getImageData(0, 0, 480, 320).data;
        };
        const before = pixels(poster);
        const after = pixels(frame);
        let changed = 0;
        let difference = 0;
        for (let pixel = 0; pixel < before.length; pixel += 4) {
          let maximum = 0;
          for (let channel = 0; channel < 4; channel++) {
            const delta = Math.abs(before[pixel + channel] - after[pixel + channel]);
            difference += delta;
            maximum = Math.max(maximum, delta);
          }
          if (maximum > 32) changed++;
        }
        return { changedRatio: changed / (480 * 320), meanDifference: difference / before.length };
      });
      await info.attach(`render-comparison-${width}-${reload}`, { body: JSON.stringify(comparison), contentType: "application/json" });
      // Allow subpixel curve rasterization, but not a half-width stroke or pose jump.
      expect(comparison.changedRatio).toBeLessThan(0.002);
      expect(comparison.meanDifference).toBeLessThan(0.4);
    }
  }
});

test("404 passes accessibility checks and normal pages do not fetch its animation", async ({ page }, info) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/scene-404/")) requests.push(request.url());
  });
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  expect(requests).toEqual([]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/404");
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(axe.source);
    const violations = await page.evaluate(async () => (await (window as unknown as { axe: typeof axe }).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    })).violations);
    expect(violations.map((item) => item.id)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 320 || width === 1440) {
      await info.attach(`404-${width}`, { body: await page.screenshot({ path: `verification-artifacts/not-found/page-${width}.png` }), contentType: "image/png" });
    }
  }
});

test("reduced motion shows the static illustration without downloading animation data", async ({ page }) => {
  const animationRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/scene-404/lottie.json")) animationRequests.push(request.url());
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/404");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".not-found-art__poster")).toBeVisible();
  await expect(page.locator(".not-found-art__animation svg")).toHaveCount(0);
  expect(animationRequests).toEqual([]);
  // OS preference changes are respected without refreshing the page.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator(".not-found-art")).toHaveAttribute("data-ready", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".not-found-art__poster")).toBeVisible();
  await expect(page.locator(".not-found-art__animation")).toHaveAttribute("data-state", "paused");
});

test("an unavailable animation leaves the illustration and recovery link working", async ({ page }) => {
  let blocked = false;
  await page.route("**/scene-404/lottie.json", (route) => { blocked = true; return route.abort(); });
  await page.goto("/404");
  await expect.poll(() => blocked).toBe(true);
  await expect(page.locator(".not-found-art__poster")).toBeVisible();
  await page.getByRole("link", { name: "홈으로 돌아가기", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("redirect, standalone layout and recovery also work without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    expect((await page.goto(`${process.env.IPILLGOOD_TEST_BASE_URL}/missing-without-js`))?.status()).toBe(404);
    await expect(page).toHaveURL(/\/404$/);
    await expect(page.getByRole("heading", { name: "페이지를 찾을 수 없어요" })).toBeVisible();
    await expect(page.locator(".sidebar, .mobile-nav, .mobile-header")).toHaveCount(0);
    await expect(page.locator(".not-found-art__poster")).toBeVisible();
    await page.getByRole("link", { name: "홈으로 돌아가기", exact: true }).click();
    await expect(page).toHaveURL(`${process.env.IPILLGOOD_TEST_BASE_URL}/`);
  } finally {
    await context.close();
  }
});
