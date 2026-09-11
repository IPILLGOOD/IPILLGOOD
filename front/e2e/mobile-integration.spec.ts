import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dismissInstallPromptWhenShown } from "../test-support/browser-controls";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  // Keep this suite's demo logins separate from other suites sharing localhost.
  extraHTTPHeaders: { "x-forwarded-for": "192.0.2.146" },
});

test.beforeEach(async ({ page }) => {
  await dismissInstallPromptWhenShown(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("mobile: landing, all care pages, medication details, navigation and narrow reflow", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Dismiss through the UI before testing focus: a locator handler clicking
  // the install prompt during toBeFocused() would itself move the focus.
  const installClose = page.getByRole("button", { name: "PWA 설치 안내 닫기", exact: true });
  await page.removeLocatorHandler(installClose);
  mkdirSync("verification-artifacts/mobile", { recursive: true });
  for (const width of [320, 390, 428, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    if (width === 320) {
      await installClose.click();
      await expect(installClose).toBeHidden();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `verification-artifacts/mobile/landing-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByRole("button", { name: "둘러보기", exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
  for (const path of ["/today", "/dashboard", "/medications", "/nutrition", "/check-in", "/documents", "/profile", "/report"]) {
    await test.step(path, async () => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("main")).toBeVisible();
      for (const width of [320, 390, 428]) {
        await page.setViewportSize({ width, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path} at ${width}px`).toBe(true);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `verification-artifacts/mobile/${path.slice(1)}-390.png`, fullPage: true });
    });
  }
  await page.goto("/medications");
  await page.getByRole("link", { name: "상세 정보 보기", exact: true }).click();
  await expect(page).toHaveURL(/\/medications\/.+/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.screenshot({ path: "verification-artifacts/mobile/medication-detail-390.png", fullPage: true });
  for (const [name, path] of [["대시보드", "/dashboard"], ["안부 확인", "/check-in"], ["문서", "/documents"]]) {
    await page.getByRole("navigation", { name: "주요 메뉴", exact: true }).getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  }
  await info.attach("mobile-runtime-errors", { body: JSON.stringify(errors), contentType: "application/json" });
  expect(errors).toEqual([]);
});

test("mobile: calendar records and corrections persist; removing a medication updates Today", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "둘러보기", exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
  await page.goto("/dashboard");
  const dose = page.locator(".dose-quick-check").first();
  await expect(dose).toBeVisible();
  await dose.getByRole("button", { name: "복용 완료", exact: true }).click();
  await expect(dose).toHaveClass(/is-completed/);
  await page.reload();
  await expect(dose).toHaveClass(/is-completed/);
  await dose.getByRole("button", { name: "미복용", exact: true }).click();
  await expect(dose).toHaveClass(/is-skipped/);
  await page.reload();
  await expect(dose).toHaveClass(/is-skipped/);
  await page.getByRole("button", { name: "이전 달", exact: true }).click();
  await page.getByRole("button", { name: "다음 달", exact: true }).click();
  await page.goto("/medications");
  const tabs = page.getByRole("tablist", { name: "복용약 선택" }).getByRole("tab");
  const before = await tabs.count();
  await tabs.last().click();
  await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
  const product = await page.getByRole("tabpanel").getByRole("heading", { level: 3 }).innerText();
  await page.getByRole("button", { name: `${product} 복용약에서 빼기`, exact: true }).click();
  await expect(tabs).toHaveCount(before - 1);
  const selected = page.getByRole("tab", { selected: true });
  await expect(selected).toHaveCount(1);
  await expect(page.getByRole("tabpanel").getByRole("heading", { level: 3 })).toHaveText(await selected.locator("strong").innerText());
  await page.reload();
  await expect(tabs).toHaveCount(before - 1);
  await page.goto("/today");
  await expect(page.getByRole("list", { name: "오늘 복약 일정" }).getByText(product, { exact: true })).toHaveCount(0);
});

test("mobile: nutrition handles configuration, success, refresh failure and retry without losing results", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "둘러보기", exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
  await page.goto("/nutrition");
  await page.getByRole("button", { name: "관련 자료 찾기", exact: true }).click();
  await expect(page.locator(".nutrition-search-status")).toContainText("현재 자료 검색을 시작할 수 없어요");
  let call = 0;
  await page.route("**/api/nutrition/explore", async (route) => {
    call++;
    if (call === 2) return route.fulfill({ status: 429, headers: { "Retry-After": "1" }, json: { message: "잠시 후 다시 확인해주세요." } });
    return route.fulfill({ json: { retrievedAt: new Date().toISOString(), articles: [{ title: "검증용 식사 자료", summary: "브라우저 오류 복구 확인을 위한 합성 자료입니다.", publisher: "테스트 출처", url: "https://example.test/nutrition" }] } });
  });
  await page.getByRole("button", { name: "관련 자료 찾기", exact: true }).click();
  const result = page.getByRole("link", { name: "검증용 식사 자료", exact: true });
  await expect(result).toHaveAttribute("href", "https://example.test/nutrition");
  await page.getByRole("button", { name: "자료 다시 확인", exact: true }).click();
  await expect(page.locator(".nutrition-search-status")).toContainText("이전에 찾은 자료");
  await expect(result).toBeVisible();
  await expect(page.getByRole("button", { name: "자료 다시 확인", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "자료 다시 확인", exact: true }).click();
  await expect(page.locator(".nutrition-resource")).toHaveCount(1);
  await expect.poll(() => call).toBe(3);
});
