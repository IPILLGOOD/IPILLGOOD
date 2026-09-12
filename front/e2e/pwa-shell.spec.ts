import { test, expect, type Page } from "@playwright/test";
import axe from "axe-core";
import { mkdirSync } from "node:fs";

test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 },
  extraHTTPHeaders: { "x-forwarded-for": "192.0.2.149" } });

// DOM touch events exercise the same gesture lifecycle on Chromium and WebKit.
// Native device status bars/home indicators still need physical-device review.
async function touch(page: Page, selector: string, type: string, x: number, y: number, count = 1) {
  await page.locator(selector).first().evaluate((target, input) => {
    // WebKit doesn't expose a constructible Touch. Supply the touch lists on
    // a dispatched DOM event instead; this remains a synthetic gesture test.
    const points = Array.from({ length: input.count }, (_, index) => ({ identifier: index,
      target, clientX: input.x + index * 30, clientY: input.y }));
    const ended = input.type === "touchend" || input.type === "touchcancel";
    const event = new Event(input.type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      touches: { value: ended ? [] : points },
      targetTouches: { value: ended ? [] : points },
      changedTouches: { value: points },
    });
    target.dispatchEvent(event);
  }, { type, x, y, count });
}

test("PWA: centered navigation, system colors, safe areas and pull-to-refresh", async ({ page, context, browserName }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("ipillgood:pwa-install-prompt:hidden", "true");
    Object.defineProperty(navigator, "standalone", { configurable: true, get: () => true });
  });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.goto("/login");
  if (browserName === "webkit") {
    // The test server is HTTP; only this local context receives a non-Secure
    // copy of the real API-issued cookie. Production cookies remain unchanged.
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
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator(".medication-reminder-card")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "알림 상태 다시 확인" })).toHaveCount(0);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#FFFFFF");
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);
  const manifest = await (await context.request.get("/manifest.webmanifest")).json();
  expect(manifest.theme_color).toBe("#FFFFFF");
  expect(manifest.background_color).toBe("#FFFFFF");
  const nav = page.getByRole("navigation", { name: "주요 메뉴", exact: true });
  await expect(nav.getByRole("link")).toHaveText(["오늘 할 일", "복용약", "식사/영양", "프로필"]);
  await expect(page.locator('.mobile-header a[href="/profile"]')).toHaveCount(0);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (width < 960) {
      const bar = await nav.boundingBox();
      const center = await nav.getByRole("button", { name: "빠른 이동" }).boundingBox();
      expect(bar!.x).toBe(0);
      expect(bar!.width).toBe(width);
      expect(bar!.y + bar!.height).toBe(900);
      expect(Math.abs(center!.x + center!.width / 2 - width / 2)).toBeLessThan(1);
      for (const element of await nav.locator("a, button").all()) {
        const box = await element.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      for (const root of ["html", "body"]) {
        expect(await page.locator(root).evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
      }
      expect(await page.locator(".experience-shell").evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(247, 248, 250)");
      expect(await page.locator(".mobile-header").evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
      expect(await nav.evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
    } else {
      await expect(nav).toBeHidden();
      await expect(page.getByRole("navigation", { name: "서비스 메뉴" }).getByRole("link", { name: "프로필" })).toBeVisible();
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await nav.getByRole("link", { name: "프로필", exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.locator(".medication-reminder-card")).toBeVisible();
  await expect(nav.getByRole("link", { name: "프로필", exact: true })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("button", { name: "빠른 이동" }).click();
  const dialog = page.getByRole("dialog", { name: "어디로 이동할까요?" });
  await expect(dialog).toBeVisible();
  await touch(page, "main h1", "touchstart", 100, 150);
  await touch(page, "main h1", "touchmove", 100, 320);
  await touch(page, "main h1", "touchend", 100, 320);
  await expect(page.locator(".pull-to-refresh")).toBeEmpty();
  await page.keyboard.press("Escape");
  await expect(nav.getByRole("button", { name: "빠른 이동" })).toBeFocused();
  await page.goto("/today?refresh-check=1");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await nav.getByRole("button", { name: "빠른 이동" }).click();
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.scrollTo(0, 0));
  const indicator = page.locator(".pull-to-refresh");
  for (const [x, y, count, end] of [[100, 195, 1, "touchend"], [280, 165, 1, "touchend"],
    [100, 330, 2, "touchend"], [100, 330, 1, "touchcancel"]] as const) {
    await touch(page, "main h1", "touchstart", 100, 150);
    await touch(page, "main h1", "touchmove", x, y, count);
    await touch(page, "main h1", end, x, y, count);
    await expect(indicator).toBeEmpty();
  }
  // Starting below the top must scroll normally, even if the finger reaches it.
  await page.evaluate(() => window.scrollTo(0, 250));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await touch(page, "main h1", "touchstart", 100, 150);
  await touch(page, "main h1", "touchmove", 100, 330);
  await touch(page, "main h1", "touchend", 100, 330);
  await expect(indicator).toBeEmpty();
  await page.evaluate(() => window.scrollTo(0, 0));
  // A short pull can be cancelled without a reload; a full pull reloads once.
  await touch(page, "main h1", "touchstart", 100, 150);
  await touch(page, "main h1", "touchmove", 100, 330);
  await expect(indicator).toHaveText("놓으면 새로고침");
  await page.evaluate(axe.source);
  expect(await page.evaluate(async () => (await (window as unknown as { axe: typeof axe }).axe.run(
    ".pull-to-refresh, .mobile-nav, .mobile-header", { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } },
  )).violations)).toEqual([]);
  mkdirSync("verification-artifacts/pwa-shell", { recursive: true });
  await info.attach("ready-to-refresh", { body: await page.screenshot({ path: `verification-artifacts/pwa-shell/${browserName}-ready.png` }), contentType: "image/png" });
  let reloads = 0;
  page.on("request", request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) reloads++; });
  const reloaded = page.waitForEvent("load");
  await touch(page, "main h1", "touchend", 100, 330);
  await reloaded;
  await expect(page).toHaveURL(/\/today\?refresh-check=1$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(indicator).toBeEmpty();
  expect(reloads).toBe(1);
  expect(errors).toEqual([]);
});
