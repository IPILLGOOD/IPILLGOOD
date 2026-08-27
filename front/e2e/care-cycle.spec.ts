import { test, expect } from "@playwright/test";
import { SignJWT, decodeJwt } from "jose";
import { randomUUID } from "node:crypto";
import { emulatorFixture } from "../../backend/test-support/emulator";

const browserEvents = new WeakMap<object, string[]>();
test.beforeEach(async ({ context, page }) => {
  const events: string[] = [];
  browserEvents.set(page, events);
  page.on("console", (message) => { if (message.type() === "error") events.push(`console: ${message.text().slice(0, 500)}`); });
  page.on("pageerror", (error) => events.push(`pageerror: ${error.message.slice(0, 500)}`));
  page.on("requestfailed", (request) => events.push(`requestfailed: ${new URL(request.url()).pathname} ${request.failure()?.errorText}`));
  page.on("response", (response) => { if (response.status() >= 400) events.push(`response: ${response.status()} ${new URL(response.url()).pathname}`); });
  await context.route("**/*", (route) => {
    const hostname = new URL(route.request().url()).hostname;
    if (!["127.0.0.1", "localhost"].includes(hostname)) return route.abort("blockedbyclient");
    return route.continue();
  });
});

test.afterEach(async ({ page }, testInfo) => {
  await testInfo.attach("browser-events", { body: JSON.stringify(browserEvents.get(page) ?? [], null, 2), contentType: "application/json" });
  expect((browserEvents.get(page) ?? []).filter((event) => event.startsWith("pageerror:"))).toEqual([]);
});

test("demo: check-in, document create/delete, reload, dashboard/report and logout cleanup", async ({ page, context }) => {
  const fixture = emulatorFixture("admin");
  let recipientId: string | undefined;
  try {
    await page.goto("/login");
    await page.getByRole("button", { name: /데모로 둘러보기/ }).click();
    await expect(page).toHaveURL(/\/today$/);
    const cookie = (await context.cookies()).find((entry) => entry.name === "care_atlas_session")!;
    recipientId = decodeJwt(cookie.value).sub;
    const form = page.getByRole("form", { name: "오늘의 안부 바로 기록" });
    await form.getByLabel("어지러움", { exact: true }).check();
    await form.getByLabel("보호자 메모").fill("격리된 자동 검증 기록");
    const questions = form.locator('select[name^="question_"]');
    for (let index = 0; index < await questions.count(); index++) {
      const question = questions.nth(index);
      await question.selectOption((await question.locator("option:not([disabled])").first().getAttribute("value"))!);
    }
    await form.getByRole("button", { name: "안부 기록 저장" }).click();
    await expect(page.getByText("오늘의 몸 상태를 기록했어요.")).toBeVisible();
    await page.goto("/documents");
    const before = await page.locator(".document-item").count();
    await page.getByRole("button", { name: "비식별 샘플 처방전으로 체험" }).click();
    await expect(page.getByText("비식별 데모 분석을 마쳤어요.")).toBeVisible();
    await expect(page.locator(".document-item")).toHaveCount(before + 1);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "“비식별_샘플_처방전.jpg” 문서 삭제" }).first().click();
    await expect(page.locator(".document-item")).toHaveCount(before);
    await page.goto("/today");
    await expect(page.getByLabel("보호자 메모")).toHaveValue("격리된 자동 검증 기록");
    await expect(page.getByLabel("어지러움", { exact: true })).toBeChecked();
    for (const path of ["/dashboard", "/report", "/medications"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.locator("main")).toBeVisible();
    }
    const subscriptions = await fixture.admin.collection("pushSubscriptions").where("recipientId", "==", recipientId).get();
    const schedules = await fixture.admin.collection("medicationReminderSchedules").where("recipientId", "==", recipientId).get();
    expect(subscriptions.size).toBe(0);
    expect(schedules.size).toBe(0);
    await page.getByRole("button", { name: "로그아웃" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect.poll(async () => (await fixture.admin.collection("careReadModels").doc(recipientId!).get()).exists).toBe(false);
  } finally {
    if (recipientId) {
      await fixture.admin.recursiveDelete(fixture.admin.collection("careRecipients").doc(recipientId));
      await fixture.admin.collection("careReadModels").doc(recipientId).delete();
      await fixture.admin.collection("demoSessions").doc(recipientId).delete();
    }
    await fixture.cleanup();
  }
});

test("synthetic account: isolated normal session, read-only Push status, forged auth rejected", async ({ context, page, request }) => {
  const fixture = emulatorFixture("admin");
  const userId = `test-${randomUUID()}`;
  // Uses the normal session verifier with this run's random secret, never a production auth bypass.
  const token = await new SignJWT({ name: "자동 검증 계정", provider: "google" }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode(process.env.SESSION_SECRET));
  const recipientId = `google-${userId}`;
  let emulatorToken: string | undefined;
  try {
    expect((await request.get("/api/push/subscriptions?deviceId=test-device-000001")).status()).toBe(401);
    expect((await request.post("/api/push/dispatch")).status()).toBe(401);
    expect((await request.post("/api/auth/google", { data: { idToken: "invalid".repeat(30) } })).status()).toBe(401);
    const authUrl = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts`;
    const signup = await request.post(`${authUrl}:signUp?key=synthetic`, { data: { email: `${userId}@example.test`, password: randomUUID(), returnSecureToken: true } });
    expect(signup.ok()).toBe(true);
    emulatorToken = (await signup.json()).idToken;
    // Even with an Auth emulator running, the production Google route must reject its unsigned token.
    expect((await request.post("/api/auth/google", { data: { idToken: emulatorToken } })).status()).toBe(401);
    expect((await request.post("/api/auth/demo", { headers: { origin: "https://untrusted.invalid" } })).status()).toBe(403);
    await context.addCookies([{ name: "care_atlas_session", value: token, url: process.env.IPILLGOOD_TEST_BASE_URL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/today");
    await expect(page).toHaveURL(/\/today$/);
    const status = await context.request.get("/api/push/subscriptions?deviceId=test-device-000001");
    expect(status.status()).toBe(200);
    expect((await status.json()).subscribed).toBe(false);
    const model = await fixture.admin.collection("careReadModels").doc(recipientId).get();
    expect(model.exists).toBe(true);
    expect(model.data()?.documents).toEqual([]);
    expect((await fixture.admin.collection("pushSubscriptions").where("recipientId", "==", recipientId).get()).size).toBe(0);
  } finally {
    if (emulatorToken) await request.post(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:delete?key=synthetic`, { data: { idToken: emulatorToken } });
    await fixture.admin.recursiveDelete(fixture.admin.collection("careRecipients").doc(recipientId));
    await fixture.admin.collection("careReadModels").doc(recipientId).delete();
    await fixture.cleanup();
  }
});
