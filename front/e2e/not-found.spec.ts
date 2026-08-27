import { test, expect } from "@playwright/test";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import { emulatorFixture } from "../../backend/test-support/emulator";

test("unknown URLs return 404, remain accessible at all sizes, and recover without history", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const response = await page.goto("/missing-page-98");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "페이지를 찾을 수 없어요" })).toBeVisible();
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
  await expect(page).toHaveURL(/\/login/);
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
      await expect(page.getByRole("heading", { name: "페이지를 찾을 수 없어요" })).toBeVisible();
      await expect(page.getByRole("link", { name: "오늘 할 일로 돌아가기", exact: true })).toHaveAttribute("href", "/today");
    }
    await page.getByRole("link", { name: "오늘 할 일로 돌아가기", exact: true }).click();
    await expect(page).toHaveURL(/\/today$/);
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
