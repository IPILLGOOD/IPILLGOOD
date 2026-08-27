import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { emulatorFixture } from "../../backend/test-support/emulator";

for (const path of ["/today", "/check-in"]) {
  test(`${path}: missing stored question preserves inputs and recovers without reload`, async ({ context, page }) => {
    const fixture = emulatorFixture("admin");
    const userId = `recovery-${randomUUID()}`;
    const recipientId = `google-${userId}`;
    const token = await new SignJWT({ name: "질문 복구 검증", provider: "google" }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode(process.env.SESSION_SECRET));
    await context.addCookies([{ name: "care_atlas_session", value: token, url: process.env.IPILLGOOD_TEST_BASE_URL!, httpOnly: true, sameSite: "Lax" }]);
    try {
      await page.goto(path);
      const form = page.getByRole("form", { name: path === "/today" ? "오늘의 안부 바로 기록" : "오늘의 복약과 안부 기록" });
      await form.getByLabel("보호자 메모").fill("새로고침 없이 보존할 메모");
      await form.getByLabel("두통", { exact: true }).check();
      await form.getByLabel("불편한 정도", { exact: true }).selectOption("7");
      if (path === "/today") await form.getByLabel("확인한 사람").selectOption("recipient");
      else await form.getByLabel("어르신이 직접 답했어요").check();
      const selects = form.locator('select[name^="question_"]');
      for (let index = 0; index < await selects.count(); index++) {
        await selects.nth(index).selectOption((await selects.nth(index).locator("option:not([disabled])").first().getAttribute("value"))!);
      }
      const radioNames = await form.locator('input[type="radio"][name^="question_"]').evaluateAll((inputs) => [...new Set(inputs.map((input) => input.getAttribute("name")!))]);
      for (const name of radioNames) await form.locator(`input[name="${name}"]`).first().check();
      const id = await form.locator('input[name="questionSetId"]').inputValue();
      const recipient = fixture.admin.collection("careRecipients").doc(recipientId);
      await recipient.collection("questionSets").doc(id).delete();
      await form.getByRole("button", { name: path === "/today" ? "안부 기록 저장" : "오늘의 답변 저장" }).click();
      await expect(form.getByRole("alert")).toContainText("입력은 유지돼요");
      await expect(form.getByLabel("보호자 메모")).toHaveValue("새로고침 없이 보존할 메모");
      await expect(form.getByLabel("두통", { exact: true })).toBeChecked();
      await expect(form.getByLabel("불편한 정도", { exact: true })).toHaveValue("7");
      await form.getByRole("button", { name: "질문 다시 준비하기" }).click();
      await expect(form.getByRole("status")).toContainText("질문을 다시 준비했어요");
      await expect(form.locator('input[name="questionSetId"]')).toHaveValue(id);
      await expect(form.getByLabel("보호자 메모")).toHaveValue("새로고침 없이 보존할 메모");
      await form.getByRole("button", { name: path === "/today" ? "안부 기록 저장" : "오늘의 답변 저장" }).click();
      await expect(page.getByText(path === "/today" ? "오늘의 몸 상태를 기록했어요." : "오늘의 복약과 몸 상태를 기록했어요.")).toBeVisible();
      const saved = await recipient.collection("dailyCheckIns").get();
      expect(saved.size).toBe(1);
      expect(saved.docs[0].data()).toMatchObject({ note: "새로고침 없이 보존할 메모", severity: 7, completedBy: "recipient", symptoms: ["두통"] });

      // A live generation lease with no published set renders only recovery, never a usable form.
      await page.goto(path);
      const nextId = await page.locator('input[name="questionSetId"]').inputValue();
      await recipient.collection("questionSets").doc(nextId).delete();
      await recipient.collection("questionGenerations").doc(nextId).set({ status: "running", owner: "another-request", attempts: 1, leaseUntil: new Date(Date.now() + 120_000).toISOString(), sourceDocumentIds: [] });
      await page.reload();
      await expect(page.locator('input[name="questionSetId"]')).toHaveCount(0);
      await expect(page.getByRole("button", { name: "질문 다시 준비하기" })).toBeVisible();
      await recipient.collection("questionGenerations").doc(nextId).update({ leaseUntil: "2020-01-01T00:00:00Z" });
      await page.getByRole("button", { name: "질문 다시 준비하기" }).click();
      await expect(page.locator('input[name="questionSetId"]')).toHaveValue(nextId);
    } finally {
      await fixture.admin.recursiveDelete(fixture.admin.collection("careRecipients").doc(recipientId));
      await fixture.admin.collection("careReadModels").doc(recipientId).delete();
      await fixture.cleanup();
    }
  });
}
