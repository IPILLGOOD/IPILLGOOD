import { test, expect } from "@playwright/test";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import axe from "axe-core";
import { emulatorFixture } from "../../backend/test-support/emulator";
import { processAccountDeletion, requestAccountDeletion, type AccountDeletion } from "../../backend/src/account-deletion";
import { getAccountDeletionPolicy } from "../../backend/src/account-deletion-policy";

async function session(uid: string) {
  return new SignJWT({ name: "탈퇴 검증 계정", provider: "google" }).setProtectedHeader({ alg: "HS256" }).setSubject(uid).setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode(process.env.SESSION_SECRET));
}
test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});

test("profile: three-month policy, responsive dialog, keyboard cancellation, demo and API authorization", async ({ page, context, request }, info) => {
  const f = emulatorFixture("admin");
  const uid = f.namespace;
  try {
    await context.addCookies([{ name: "care_atlas_session", value: await session(uid), url: process.env.IPILLGOOD_TEST_BASE_URL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/profile");
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const trigger = page.getByRole("button", { name: "회원 탈퇴", exact: true });
      await trigger.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "회원 탈퇴 전 확인해주세요" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Google로 본인 확인" })).toBeEnabled();
      await expect(dialog.getByText("Google 계정 자체는 삭제되지 않아요.")).toBeVisible();
      await expect(dialog.getByText(/로그인만으로 삭제 기한이 연장되지는 않아요/)).toBeVisible();
      await page.evaluate(axe.source);
      const violations = await page.evaluate(async () => (await (window as unknown as { axe: typeof axe }).axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
      })).violations);
      expect(violations.map((item) => item.id)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      if (width === 320 || width === 1440) await info.attach(`withdrawal-${width}`, { body: await page.screenshot({ path: `verification-artifacts/account-deletion/dialog-${width}.png` }), contentType: "image/png" });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    const headers = { origin: process.env.IPILLGOOD_TEST_BASE_URL! };
    const body = { action: "start", idToken: "invalid".repeat(30), confirmation: "회원 탈퇴", policyVersion: "not-approved" };
    expect((await request.post("/api/account/deletion", { headers, data: body })).status()).toBe(401);
    expect((await context.request.post("/api/account/deletion", { headers: { origin: "https://untrusted.invalid" }, data: body })).status()).toBe(403);
    expect((await context.request.post("/api/account/deletion", { headers, data: { ...body, userId: "other" } })).status()).toBe(400);
    expect((await context.request.post("/api/account/deletion", { headers, data: body })).status()).toBe(401);
    expect((await request.post("/api/account/deletion/cleanup")).status()).toBe(401);
    expect((await f.admin.collection("accountDeletions").doc(f.scope.recipientId).get()).exists).toBe(false);
    await page.getByRole("button", { name: "로그아웃", exact: true }).click();
    await page.goto("/login");
    await page.getByRole("button", { name: /데모로 둘러보기/ }).click();
    await expect(page).toHaveURL(/\/today$/);
    await page.goto("/profile");
    await expect(page.getByRole("button", { name: "회원 탈퇴", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  } finally { await f.cleanup(); }
});

for (const simulateNetworkFailure of [false, true]) test(`soft deletion (${simulateNetworkFailure ? "retry" : "normal"}): old sessions rejected, data retained and browser exits to login`, async ({ context, page, request }) => {
  const f = emulatorFixture("admin");
  const uid = f.namespace;
  const oldToken = await session(uid);
  const newUid = `test-${randomUUID()}`;
  try {
    await f.firestore.collection("careRecipients").doc(f.scope.recipientId).collection("unknown").doc("missing").collection("child").doc("secret").set({ synthetic: true });
    await requestAccountDeletion({ userId: uid, tokenUserId: uid, authTime: Math.floor(Date.now() / 1000), confirmation: "회원 탈퇴", policyVersion: getAccountDeletionPolicy().version }, {
      firestore: f.firestore,
    });
    await context.addCookies([{ name: "care_atlas_session", value: oldToken, url: process.env.IPILLGOOD_TEST_BASE_URL!, httpOnly: true, sameSite: "Lax" }]);
    expect((await context.request.get("/api/push/subscriptions?deviceId=test-device-000001")).status()).toBe(401);
    if (simulateNetworkFailure) await context.route("**/api/account/deletion", (route) => route.fulfill({ status: 503, json: { message: "연결을 확인한 뒤 다시 시도해주세요." } }), { times: 1 });
    await page.goto("/profile");
    if (simulateNetworkFailure) {
      await expect(page.getByRole("alert").filter({ hasText: "연결을 확인한 뒤 다시 시도해주세요." })).toBeVisible();
      await page.getByRole("button", { name: "처리 다시 시도" }).click();
    }
    await expect(page).toHaveURL(/\/login\?withdrawn=1$/, { timeout: 60_000 });
    await expect(page.getByRole("status")).toContainText("3개월 안에 같은 Google 계정으로 로그인하면 복구 절차를 안내해요");
    expect((await context.cookies()).some((cookie) => ["care_atlas_session", "ipillgood_push_device", "ipillgood_account_deletion"].includes(cookie.name))).toBe(false);
    expect((await f.admin.collection("careRecipients").doc(f.scope.recipientId).listCollections()).length).toBe(1);
    expect((await f.admin.collection("accountDeletions").doc(f.scope.recipientId).get()).data()?.status).toBe("soft_deleted");
    expect((await request.get("/api/push/subscriptions?deviceId=test-device-000001", { headers: { cookie: `care_atlas_session=${oldToken}` } })).status()).toBe(401);
    // A new Firebase UID gets a new empty scope, not an email-keyed restore.
    await context.addCookies([{ name: "care_atlas_session", value: await session(newUid), url: process.env.IPILLGOOD_TEST_BASE_URL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/documents");
    await expect(page.getByText("아직 등록한 문서가 없어요")).toBeVisible();
  } finally {
    await f.admin.recursiveDelete(f.admin.collection("careRecipients").doc(`google-${newUid}`));
    await f.admin.collection("careReadModels").doc(`google-${newUid}`).delete();
    await f.admin.collection("accountDeletions").doc(f.scope.recipientId).delete();
    await f.cleanup();
  }
});

async function recoveryToken(job: AccountDeletion, options: { requestId?: string; expired?: boolean } = {}) {
  const authTime = Math.floor(Date.now() / 1000) - (options.expired ? 301 : 0);
  return new SignJWT({ requestId: options.requestId ?? job.requestId, authTime, name: "복구 검증 계정", email: "synthetic@example.test" })
    .setProtectedHeader({ alg: "HS256" }).setSubject(job.userId).setAudience("account-recovery-only")
    .setIssuedAt().setExpirationTime(authTime + 300).sign(new TextEncoder().encode(process.env.SESSION_SECRET));
}

async function softDeletedFixture() {
  const f = emulatorFixture("admin");
  const uid = f.namespace;
  const now = new Date(Date.now() - 10_000);
  await f.firestore.collection("careRecipients").doc(f.scope.recipientId).collection("unknown").doc("preserved").set({ synthetic: "original" });
  const job = await requestAccountDeletion({ userId: uid, tokenUserId: uid, authTime: Math.floor(now.getTime() / 1000), confirmation: "회원 탈퇴", policyVersion: getAccountDeletionPolicy().version }, { firestore: f.firestore, now: () => now });
  await processAccountDeletion(uid, { firestore: f.firestore });
  return { f, uid, job };
}

test("recovery: accessible consent, cancellation, explicit restore and old-device session revocation", async ({ context, page, request }, info) => {
  const { f, uid, job } = await softDeletedFixture();
  const oldToken = await session(uid);
  const token = await recoveryToken(job);
  const cookie = { name: "ipillgood_account_recovery", value: token, url: process.env.IPILLGOOD_TEST_BASE_URL!, httpOnly: true, sameSite: "Strict" as const };
  try {
    await context.addCookies([cookie]);
    expect((await context.request.get("/api/push/subscriptions?deviceId=test-device-000001")).status()).toBe(401);
    await page.goto("/account/recovery");
    const restore = page.getByRole("button", { name: "확인하고 계정 복구" });
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.getByRole("heading", { name: "탈퇴한 계정을 복구할까요?" })).toBeVisible();
      await expect(restore).toBeDisabled();
      await page.evaluate(axe.source);
      const violations = await page.evaluate(async () => (await (window as unknown as { axe: typeof axe }).axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
      })).violations);
      expect(violations.map((item) => item.id)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if (width === 320 || width === 1440) await info.attach(`recovery-${width}`, { body: await page.screenshot({ path: `verification-artifacts/account-deletion/recovery-${width}.png`, fullPage: true }), contentType: "image/png" });
    }
    await page.getByRole("button", { name: "복구하지 않고 나가기" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await f.admin.collection("accountDeletions").doc(f.scope.recipientId).get()).data()?.deleteAfter).toBe(job.deleteAfter);
    expect((await context.cookies()).some((item) => item.name === "ipillgood_account_recovery")).toBe(false);
    await context.addCookies([cookie]);
    await page.goto("/account/recovery");
    await page.getByRole("checkbox").focus();
    await page.keyboard.press("Space");
    await expect(restore).toBeEnabled();
    await restore.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/profile\?restored=1$/);
    await expect(page.getByRole("status")).toContainText("계정과 돌봄 기록이 복구됐어요");
    expect((await f.admin.collection("accountDeletions").doc(f.scope.recipientId).get()).data()?.status).toBe("restored");
    expect((await f.firestore.collection("careRecipients").doc(f.scope.recipientId).collection("unknown").doc("preserved").get()).data()).toEqual({ synthetic: "original" });
    expect((await request.get("/api/push/subscriptions?deviceId=test-device-000001", { headers: { cookie: `care_atlas_session=${oldToken}` } })).status()).toBe(401);
    expect((await request.get("/api/push/subscriptions?deviceId=test-device-000001", { headers: { cookie: `care_atlas_session=${token}` } })).status()).toBe(401);
    expect((await context.cookies()).some((item) => item.name === "ipillgood_account_recovery")).toBe(false);
    await page.reload();
    await expect(page.getByRole("button", { name: "회원 탈퇴", exact: true })).toBeEnabled();
  } finally { await f.admin.collection("accountDeletions").doc(f.scope.recipientId).delete(); await f.cleanup(); }
});

test("recovery: fresh scoped authorization, strict confirmation and an expired retention window", async ({ context, page, request }) => {
  const { f, job } = await softDeletedFixture();
  const headers = { origin: process.env.IPILLGOOD_TEST_BASE_URL! };
  const data = { action: "restore", confirmation: true };
  try {
    expect((await request.post("/api/account/recovery", { headers, data })).status()).toBe(401);
    for (const token of [await recoveryToken(job, { expired: true }), await recoveryToken(job, { requestId: "wrong-request" })]) {
      expect((await request.post("/api/account/recovery", { headers: { ...headers, cookie: `ipillgood_account_recovery=${token}` }, data })).status()).toBe(401);
    }
    const token = await recoveryToken(job);
    await context.addCookies([{ name: "ipillgood_account_recovery", value: token, url: process.env.IPILLGOOD_TEST_BASE_URL!, httpOnly: true, sameSite: "Strict" }]);
    expect((await context.request.post("/api/account/recovery", { headers: { origin: "https://untrusted.invalid" }, data })).status()).toBe(403);
    expect((await context.request.post("/api/account/recovery", { headers, data: { ...data, confirmation: false } })).status()).toBe(400);
    expect((await context.request.post("/api/account/recovery", { headers, data: { ...data, userId: "other" } })).status()).toBe(400);
    await f.firestore.collection("accountDeletions").doc(f.scope.recipientId).set({ deleteAfter: new Date(Date.now() - 1000).toISOString() }, { merge: true });
    await page.goto("/account/recovery");
    await expect(page.getByRole("heading", { name: "계정 복구 기간이 지났어요" })).toBeVisible();
    await expect(page.getByRole("button", { name: "확인하고 계정 복구" })).toHaveCount(0);
    expect((await context.request.post("/api/account/recovery", { headers, data })).status()).toBe(410);
    expect((await f.admin.collection("accountDeletions").doc(f.scope.recipientId).get()).data()?.status).toBe("soft_deleted");
    await page.getByRole("button", { name: "로그인 화면으로" }).click();
    await expect(page).toHaveURL(/\/login$/);
  } finally { await f.admin.collection("accountDeletions").doc(f.scope.recipientId).delete(); await f.cleanup(); }
});
