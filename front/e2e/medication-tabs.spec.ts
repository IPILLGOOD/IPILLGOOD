import { test, expect, type Locator } from "@playwright/test";
import { dismissInstallPromptWhenShown } from "../test-support/browser-controls";

async function settled(rail: Locator) {
  await rail.evaluate(element => new Promise<void>((resolve, reject) => {
    let previous = element.scrollLeft, stable = 0, frames = 0;
    const check = () => {
      stable = Math.abs(element.scrollLeft - previous) < 0.1 ? stable + 1 : 0;
      previous = element.scrollLeft;
      if (stable >= 18) return resolve();
      if (++frames > 600) return reject(new Error("Medication rail did not settle"));
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }));
}

test("medication tabs retain explicit selection through scrolling and follow completed swipes", async ({ page }) => {
  await dismissInstallPromptWhenShown(page);
  // The public preview uses the real cabinet component with non-sensitive fixtures.
  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    await page.emulateMedia({ reducedMotion });
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/preview/medications");
      const rail = page.getByRole("tablist", { name: "복용약 선택" });
      const tabs = rail.getByRole("tab");
      const last = tabs.last();
      const lastProduct = await last.locator("strong").innerText();
      await last.click();
      await settled(rail);
      await expect(last, `${width}px, motion: ${reducedMotion}`).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tabpanel").getByRole("heading", { level: 3 })).toHaveText(lastProduct);
      await last.press("Home");
      await settled(rail);
      await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
      await expect(tabs.first()).toBeFocused();
      await tabs.first().press("End");
      await settled(rail);
      await expect(last).toHaveAttribute("aria-selected", "true");
      await expect(last).toBeFocused();
      if (await rail.evaluate(element => getComputedStyle(element).scrollSnapType !== "none" && element.scrollWidth > element.clientWidth)) {
        // Scrolling the viewport exercises the same event path as a completed swipe.
        await rail.evaluate(element => element.scrollTo({ left: 0, behavior: "instant" }));
        await settled(rail);
        await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
  }
});
