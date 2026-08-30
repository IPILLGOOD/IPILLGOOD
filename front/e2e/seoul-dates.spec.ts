import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { emulatorFixture } from "../../backend/test-support/emulator";
import { seedCareAccount } from "../../backend/test-support/care-fixtures";

test("document date stays in Seoul before and after hydration in different browser zones", async ({ browser }) => {
  const fixture = emulatorFixture("admin");
  const userId = `dates-${randomUUID()}`;
  const recipientId = `google-${userId}`;
  const token = await new SignJWT({ name: "날짜 검증", provider: "google" }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode(process.env.SESSION_SECRET));
  try {
    await seedCareAccount(fixture.firestore, recipientId, { consent: true });
    for (const timezoneId of ["UTC", "America/Los_Angeles", "Asia/Seoul"]) {
      const context = await browser.newContext({ baseURL: process.env.IPILLGOOD_TEST_BASE_URL, timezoneId });
      try {
        await context.addCookies([{ name: "care_atlas_session", value: token, url: process.env.IPILLGOOD_TEST_BASE_URL!, httpOnly: true, sameSite: "Lax" }]);
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto("/documents");
        await fixture.admin.collection("careReadModels").doc(recipientId).update({ documents: [{ id: "midnight-document", fileName: "날짜 검증 문서", documentType: "처방전", uploadedAt: "2026-08-23T18:26:00Z", status: "confirmed", redacted: true, sourceLabel: "Synthetic" }] });
        const response = await page.reload();
        expect(response?.status()).toBe(200);
        expect(await response!.text()).toContain("8월 24일");
        await expect(page.locator(".document-item small")).toContainText("8월 24일");
        expect(errors).toEqual([]);
      } finally { await context.close(); }
    }
  } finally {
    await fixture.admin.recursiveDelete(fixture.admin.collection("careRecipients").doc(recipientId));
    await fixture.admin.collection("careReadModels").doc(recipientId).delete();
    await fixture.cleanup();
  }
});
