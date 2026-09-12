import { test, expect } from "@playwright/test";
import axe from "axe-core";
import { mkdirSync } from "node:fs";

test("a delayed page response shows loading immediately and keeps navigation usable", async ({ page }, info) => {
  mkdirSync("verification-artifacts/navigation", { recursive: true });
  await page.addInitScript(() => localStorage.setItem("ipillgood:pwa-install-prompt:hidden", "true"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByRole("button", { name: "둘러보기", exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  let release!: () => void;
  let started!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const requested = new Promise<void>((resolve) => { started = resolve; });
  await page.route("**/dashboard?**", async (route) => {
    if (route.request().headers()["rsc"] === "1" && !route.request().headers()["next-router-prefetch"]) {
      started();
      await held;
    }
    await route.continue();
  });

  try {
    await page.getByRole("button", { name: "빠른 이동", exact: true }).click();
    await page.getByRole("dialog").getByRole("link", { name: "복용 여부 기록", exact: true }).click();
    await requested;
    const loading = page.getByRole("status", { name: "화면 불러오는 중" });
    await expect(loading).toBeVisible({ timeout: 1500 });
    await expect(page.getByRole("navigation", { name: "주요 메뉴", exact: true })).toBeVisible();
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await info.attach(`loading-${width}`, { body: await page.screenshot({ path: `verification-artifacts/navigation/loading-${width}.png` }), contentType: "image/png" });
    }
    await page.evaluate(axe.source);
    const violations = await page.evaluate(async () => {
      const engine = (window as unknown as { axe: typeof axe }).axe;
      return (await engine.run(".route-loading", { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations;
    });
    expect(violations).toEqual([]);
  } finally {
    release();
  }
  await expect(page.getByRole("heading", { level: 1 })).toContainText("돌봄 다이어리");
  await expect(page.getByRole("status", { name: "화면 불러오는 중" })).toBeHidden();
});
