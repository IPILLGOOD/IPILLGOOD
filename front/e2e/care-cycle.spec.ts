import { test, expect } from "@playwright/test";
import { SignJWT, decodeJwt } from "jose";
import { randomUUID } from "node:crypto";
import { emulatorFixture } from "../../backend/test-support/emulator";
import { seedCareAccount } from "../../backend/test-support/care-fixtures";

const browserEvents = new WeakMap<object, string[]>();

async function syntheticGoogleToken(userId: string) {
  // Uses the normal session verifier with this run's random secret, never a production auth bypass.
  return new SignJWT({ name: "자동 검증 계정", provider: "google" }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode(process.env.SESSION_SECRET));
}

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
    await page.getByRole("button", { name: /둘러보기/ }).click();
    await expect(page).toHaveURL(/\/today$/);
    const cookie = (await context.cookies()).find((entry) => entry.name === "care_atlas_session")!;
    recipientId = decodeJwt(cookie.value).sub;
    await page.getByRole("link", { name: /확인 시작/ }).click();
    await expect(page).toHaveURL(/\/check-in$/);
    const form = page.getByRole("form", { name: "오늘의 복약과 안부 기록" });
    await form.getByLabel("어지러움", { exact: true }).check();
    await form.getByLabel("보호자 메모").fill("격리된 자동 검증 기록");
    const doseResponses = form.locator('input[name^="dose_"][value="completed"]');
    for (let index = 0; index < await doseResponses.count(); index++) {
      await doseResponses.nth(index).check();
    }
    const questions = form.locator(".dynamic-question");
    for (let index = 0; index < await questions.count(); index++) {
      await questions.nth(index).locator('input[type="radio"]').first().check();
    }
    await form.getByRole("button", { name: "오늘의 답변 저장" }).click();
    await expect(page.getByText("오늘의 복약과 몸 상태를 기록했어요.")).toBeVisible();
    await page.goto("/documents");
    const before = await page.locator(".document-item").count();
    const recipient = fixture.admin.collection("careRecipients").doc(recipientId!);
    const baselineMedicationCount = (await recipient.collection("medicationPlans").get()).size;
    const baselineDoseEventCount = (await recipient.collection("doseEvents").get()).size;
    for (const documentType of ["처방전", "진단서"]) {
      await page.getByRole("radio", { name: new RegExp(`^${documentType}`) }).check();
      await page.getByRole("button", { name: `비식별 샘플 ${documentType}으로 체험` }).click();
      if (documentType === "처방전") {
        await expect(page.getByRole("heading", { name: "기존 복약과 겹치는 항목이 있어요" })).toBeVisible();
        await page.getByRole("button", { name: "별도 처방으로 등록" }).click();
        await expect(page.getByText("복약 일정에는 아직 반영하지 않았어요.", { exact: false })).toBeVisible();
      } else {
        await expect(page.getByText("비식별 데모 분석을 마쳤어요.")).toBeVisible();
      }
      await expect(page.locator(".document-item")).toHaveCount(before + 1);
      if (documentType === "처방전") {
        expect((await recipient.collection("medicationPlans").get()).size).toBe(baselineMedicationCount);
        expect((await recipient.collection("doseEvents").get()).size).toBe(baselineDoseEventCount);
        const endDates = page.getByRole("region", { name: "원본과 비교해 약과 일정을 검토하세요" }).getByLabel("종료일");
        for (let index = 0; index < await endDates.count(); index++) {
          if (!await endDates.nth(index).inputValue()) await endDates.nth(index).fill("2027-12-31");
        }
        await page.getByRole("button", { name: "선택한 약 3개 확정" }).click();
        await expect(page.getByText("선택한 약 3개를 복약 일정에 반영했어요.")).toBeVisible();
        expect((await recipient.collection("medicationPlans").get()).size).toBe(baselineMedicationCount + 3);
      }
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: `“비식별_샘플_${documentType}.jpg” 문서 삭제` }).first().click();
      await expect(page.locator(".document-item")).toHaveCount(before);
      if (documentType === "처방전") {
        expect((await recipient.collection("medicationPlans").get()).size).toBe(baselineMedicationCount);
      }
    }
    await page.goto("/check-in");
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
  const token = await syntheticGoogleToken(userId);
  const recipientId = `google-${userId}`;
  let emulatorToken: string | undefined;
  try {
    expect((await request.get("/api/push/subscriptions?deviceId=test-device-000001")).status()).toBe(401);
    expect((await request.post("/api/push/dispatch")).status()).toBe(401);
    const authHeaders = { origin: process.env.IPILLGOOD_TEST_BASE_URL! };
    expect((await request.post("/api/auth/google", { headers: authHeaders, data: { idToken: "invalid".repeat(30) } })).status()).toBe(401);
    const authUrl = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts`;
    const signup = await request.post(`${authUrl}:signUp?key=synthetic`, { data: { email: `${userId}@example.test`, password: randomUUID(), returnSecureToken: true } });
    expect(signup.ok()).toBe(true);
    emulatorToken = (await signup.json()).idToken;
    // Even with an Auth emulator running, the production Google route must reject its unsigned token.
    expect((await request.post("/api/auth/google", { headers: authHeaders, data: { idToken: emulatorToken } })).status()).toBe(401);
    expect((await request.post("/api/auth/demo", { headers: { origin: "https://untrusted.invalid" } })).status()).toBe(403);
    await context.addCookies([{ name: "care_atlas_session", value: token, url: process.env.IPILLGOOD_TEST_BASE_URL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/today");
    await expect(page).toHaveURL(/\/profile\?onboarding=1$/);
    await expect(page.getByLabel("화면에 표시할 이름")).toHaveValue("");
    await expect(page.getByLabel("나이", { exact: false })).toHaveValue("");
    for (const path of ["/documents", "/check-in", "/dashboard", "/report"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/profile\?onboarding=1$/);
    }
    const initialRecipient = await fixture.admin.collection("careRecipients").doc(recipientId).get();
    expect(initialRecipient.data()).toMatchObject({ displayName: "", ageBand: "", consentConfirmed: false });
    const beforeProfileAnalysis = await context.request.post("/api/documents/analyze", {
      multipart: { documentType: "처방전", sample: "true" },
    });
    expect(beforeProfileAnalysis.status()).toBe(403);
    expect((await beforeProfileAnalysis.json()).message).toContain("돌봄 대상자 정보");
    await page.getByLabel("화면에 표시할 이름").fill("온보딩 검증 대상자");
    await page.getByLabel("나이", { exact: false }).fill("75");
    await page.getByRole("checkbox", { name: /건강정보 저장에 동의/ }).check();
    await page.getByRole("button", { name: "프로필 저장", exact: true }).click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByRole("heading", { name: "돌봄 기록을 시작해 볼까요" })).toBeVisible();
    await expect(page.getByRole("link", { name: "첫 문서 등록하기" })).toHaveAttribute("href", "/documents");
    await expect(page.getByRole("form", { name: "오늘의 안부 바로 기록" })).toHaveCount(0);
    for (const collection of ["careAnalyses", "questionSets", "agentRuns"]) {
      expect((await fixture.admin.collection("careRecipients").doc(recipientId).collection(collection).get()).empty).toBe(true);
    }
    const deniedSample = await context.request.post("/api/documents/analyze", {
      multipart: { documentType: "처방전", sample: "true" },
    });
    expect(deniedSample.status()).toBe(403);
    expect((await deniedSample.json()).message).toContain("샘플 문서 체험");
    const { sessionKey } = await (await context.request.get("/api/push/config")).json();
    const status = await context.request.get("/api/push/subscriptions?deviceId=test-device-000001", { headers: { "x-push-session": sessionKey } });
    expect(status.status()).toBe(200);
    expect((await status.json()).subscribed).toBe(false);
    const model = await fixture.admin.collection("careReadModels").doc(recipientId).get();
    expect(model.exists).toBe(true);
    expect(model.data()?.recipient).toMatchObject({ displayName: "온보딩 검증 대상자", ageBand: "75", consentConfirmed: true });
    expect(model.data()?.recipient.profileCompletedAt).toEqual(expect.any(String));
    expect(model.data()?.documents).toEqual([]);
    expect((await fixture.admin.collection("pushSubscriptions").where("recipientId", "==", recipientId).get()).size).toBe(0);
  } finally {
    if (emulatorToken) await request.post(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:delete?key=synthetic`, { data: { idToken: emulatorToken } });
    await fixture.admin.recursiveDelete(fixture.admin.collection("careRecipients").doc(recipientId));
    await fixture.admin.collection("careReadModels").doc(recipientId).delete();
    await fixture.cleanup();
  }
});

test("documents: samples stay demo-only across API requests, uploads and account switches", async ({ context, page, request }, info) => {
  const fixture = emulatorFixture("admin");
  const userId = `test-${randomUUID()}`;
  const recipientId = `google-${userId}`;
  const token = await syntheticGoogleToken(userId);
  const sessionCookie = { name: "care_atlas_session", value: token, url: process.env.IPILLGOOD_TEST_BASE_URL!, httpOnly: true, sameSite: "Lax" as const };
  // A valid file exercises upload validation without containing personal data or contacting an AI service.
  const upload = {
    name: "synthetic-prescription.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  };
  let demoRecipientId: string | undefined;
  try {
    expect((await request.post("/api/documents/analyze", { multipart: { documentType: "처방전", sample: "true" } })).status()).toBe(401);
    await seedCareAccount(fixture.firestore, recipientId, { consent: true });
    await context.addCookies([sessionCookie]);
    await page.goto("/documents");
    await expect(page.getByText("아직 등록한 문서가 없어요")).toBeVisible();
    await expect(page.getByText("처방전이나 진단서를 첨부하고 분석해보세요.")).toBeVisible();
    await expect(page.getByText("비식별 샘플로 안전하게 흐름을 체험할 수 있어요.")).toHaveCount(0);

    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator(".sample-button, .sample-divider")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "처방전 첨부하고 분석하기" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if (width === 320 || width === 1440) {
        await info.attach(`normal-account-documents-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
      }
    }
    for (const documentType of ["처방전", "진단서"]) {
      await page.getByRole("radio", { name: new RegExp(`^${documentType}`) }).check();
      await expect(page.getByRole("button", { name: /비식별 샘플 .*으로 체험/ })).toHaveCount(0);
      await expect(page.getByRole("button", { name: `${documentType} 첨부하고 분석하기` })).toBeEnabled();
      const forbidden = await context.request.post("/api/documents/analyze", { multipart: { documentType, sample: "true" } });
      expect(forbidden.status()).toBe(403);
      expect((await forbidden.json()).message).toBe("샘플 문서 체험은 데모 로그인에서만 이용할 수 있어요.");
    }
    const sampleWithFile = await context.request.post("/api/documents/analyze", {
      multipart: { documentType: "처방전", sample: "true", document: upload },
    });
    expect(sampleWithFile.status()).toBe(403);
    expect((await context.request.post("/api/documents/analyze", { multipart: { documentType: "처방전" } })).status()).toBe(400);

    await page.getByRole("radio", { name: /^처방전/ }).check();
    await page.locator('input[name="document"]').setInputFiles(upload);
    const analysisResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/documents/analyze" && response.request().method() === "POST");
    await page.getByRole("button", { name: "처방전 첨부하고 분석하기" }).click();
    // The isolated environment intentionally has no AI credentials: upload must reach the normal analysis path, not the demo policy denial.
    expect((await analysisResponse).status()).toBe(503);
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("문서 분석 서비스를 준비 중이에요. 잠시 후 다시 시도해주세요.");
    await expect(page.getByRole("button", { name: "처방전 첨부하고 분석하기" })).toBeEnabled();
    const model = await fixture.admin.collection("careReadModels").doc(recipientId).get();
    expect(model.data()?.documents).toEqual([]);
    expect(model.data()?.medications).toEqual([]);
    for (const collection of ["clinicalDocuments", "medicationPlans"]) {
      expect((await fixture.admin.collection("careRecipients").doc(recipientId).collection(collection).get()).empty).toBe(true);
    }
    expect((await fixture.admin.collection("medicationReminderSchedules").where("recipientId", "==", recipientId).get()).empty).toBe(true);
    await page.reload();
    await expect(page.getByText("아직 등록한 문서가 없어요")).toBeVisible();
    await expect(page.locator(".sample-button")).toHaveCount(0);

    await page.getByRole("button", { name: "로그아웃" }).click();
    await expect(page).toHaveURL(/\/$/);
    expect((await context.request.post("/api/documents/analyze", { multipart: { sample: "true" } })).status()).toBe(401);
    await page.goto("/login");
    await page.getByRole("button", { name: /둘러보기/ }).click();
    await expect(page).toHaveURL(/\/today$/);
    demoRecipientId = decodeJwt((await context.cookies()).find((entry) => entry.name === "care_atlas_session")!.value).sub;
    await page.goto("/documents");
    await expect(page.getByRole("button", { name: "비식별 샘플 처방전으로 체험" })).toBeVisible();
    await page.getByRole("button", { name: "로그아웃" }).click();
    await expect(page).toHaveURL(/\/$/);
    await context.addCookies([sessionCookie]);
    await page.goto("/documents");
    await expect(page.locator(".sample-button, .sample-divider")).toHaveCount(0);
    await expect(page.getByText("처방전이나 진단서를 첨부하고 분석해보세요.")).toBeVisible();
  } finally {
    for (const id of [recipientId, demoRecipientId].filter((id): id is string => Boolean(id))) {
      await fixture.admin.recursiveDelete(fixture.admin.collection("careRecipients").doc(id));
      await fixture.admin.collection("careReadModels").doc(id).delete();
    }
    if (demoRecipientId) await fixture.admin.collection("demoSessions").doc(demoRecipientId).delete();
    await fixture.cleanup();
  }
});
