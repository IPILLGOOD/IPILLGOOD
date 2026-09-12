import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { configurable: true, get: () => true });
  });
});

test("PWA: stalled login becomes retryable and a fresh document clears redirect state", async ({ page }) => {
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.clock.install();
  // Hold the lazy Firebase SDK, without contacting an actual Google account.
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/_next/static/chunks/*.js", async route => {
    await held;
    await route.abort();
  });
  await page.getByRole("button", { name: "Google로 계속하기", exact: true }).click();
  await expect(page.getByRole("button", { name: "Google 로그인으로 이동 중" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "로그인 화면 새로고침" })).toBeEnabled();
  await page.clock.fastForward(30_100);
  await expect(page.locator(".login-provider-error[role=alert]")).toContainText("다시 시도");
  const retry = page.getByRole("button", { name: "Google 로그인 다시 시도", exact: true });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(page.getByRole("button", { name: "Google 로그인으로 이동 중" })).toBeDisabled();
  // A restored Safari page must not retain the disabled pre-redirect state.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect(retry).toBeEnabled();
  release();
  await page.unrouteAll({ behavior: "wait" });
  await page.evaluate(() => {
    localStorage.setItem("ipillgood:google-redirect-pending", String(Date.now()));
    history.replaceState(history.state, "", "/login?google_redirect=1&from=pwa");
  });
  await page.getByRole("button", { name: "로그인 화면 새로고침" }).click();
  await expect(page).toHaveURL(/\/login\?from=pwa$/);
  await expect(page.getByRole("button", { name: "Google로 계속하기", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem("ipillgood:google-redirect-pending"))).toBeNull();
});

test("PWA: missing redirect result offers another login attempt", async ({ page }) => {
  await page.goto("/login?google_redirect=1");
  await expect(page.getByRole("button", { name: "Google 로그인 다시 시도", exact: true })).toBeEnabled({ timeout: 40_000 });
  await expect(page.locator(".login-provider-error[role=alert]")).toContainText("다시 시도");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "로그인 화면 새로고침" })).toBeEnabled();
});
