import { test, expect, type BrowserContext } from "@playwright/test";
import { importPKCS8, SignJWT, decodeJwt } from "jose";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { emulatorFixture } from "../../backend/test-support/emulator";
import { seedCareAccount, syntheticMedication } from "../../backend/test-support/care-fixtures";
import { createFirebaseAccountAdmin } from "../../backend/src/firebase-account-admin";
import { accountDeletionDeadline, getAccountDeletionPolicy } from "../../backend/src/account-deletion-policy";
import { verifyRecipientHealthDataDeleted } from "../../backend/src/health-data-deletion";
import type { AccountDeletion } from "../../backend/src/account-deletion";

// Only the Google/JWKS boundary is synthetic. Cookies, token verification, routes, Firestore,
// Firebase account management, recovery UI and the cleanup endpoint are the production code.
test("issued sessions: sign in → connect care → withdraw → cancel recovery → restore → rewithdraw → expiry → same-Google rejoin", async ({ browser, context, page, request }, info) => {
  const baseURL = process.env.IPILLGOOD_TEST_BASE_URL!;
  const projectId = process.env.FIREBASE_PROJECT_ID!;
  const clockPath = process.env.IPILLGOOD_TEST_CLOCK_PATH!;
  // The local Cloudflare rate-limit binding can outlive an app process. Keep one synthetic
  // client throughout this flow, isolated from other tests without disabling its rate limit.
  const addressParts = randomUUID().replaceAll("-", "").slice(0, 16).match(/.{4}/g)!;
  const clientAddress = `2001:db8:${addressParts.join(":")}::1`;
  const headers = { origin: baseURL, "cf-connecting-ip": clientAddress };
  const key = await importPKCS8(readFileSync(process.env.IPILLGOOD_TEST_IDENTITY_KEY_PATH!, "utf8"), "RS256");
  const f = emulatorFixture("admin");
  const auth = createFirebaseAccountAdmin({ projectId, emulatorHost: process.env.FIREBASE_AUTH_EMULATOR_HOST, accessToken: async () => "owner" });
  const googleSub = `synthetic-${randomUUID()}`;
  const email = `${googleSub}@example.test`;
  const createdUsers = new Set<string>();
  const evidence: Array<{ step: string; [key: string]: unknown }> = [];
  const pageErrors: string[] = [];
  let connectedContext: BrowserContext | undefined;
  let connectionCodeHash: string | undefined;
  mkdirSync("verification-artifacts/account-deletion", { recursive: true });
  let offset = 0;
  const now = () => Date.now() + offset;
  function advance(milliseconds: number) {
    offset += milliseconds;
    writeFileSync(clockPath, String(offset));
  }
  const recipient = (uid: string) => f.admin.collection("careRecipients").doc(`google-${uid}`);
  const job = async (uid: string) => (await f.admin.collection("accountDeletions").doc(`google-${uid}`).get()).data() as AccountDeletion | undefined;
  async function browserRequest(path: string, data?: unknown) {
    // Playwright's API client does not send Secure cookies over loopback HTTP. Chromium does,
    // so exercise the actual browser fetch path without weakening server cookie security.
    const result = await page.evaluate(async ({ path, data }) => {
      const response = await fetch(path, data === undefined ? { cache: "no-store" } : {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      });
      return { status: response.status, body: await response.text() };
    }, { path, data });
    return { status: () => result.status, text: async () => result.body, json: async () => JSON.parse(result.body) };
  }
  async function identity(sub = googleSub, identityEmail = email) {
    const response = await request.post(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=synthetic`, {
      data: { requestUri: baseURL, returnSecureToken: true, postBody: new URLSearchParams({ providerId: "google.com", id_token: JSON.stringify({ sub, email: identityEmail, email_verified: true, name: "풀사이클 검증 계정" }) }).toString() },
    });
    expect(response.status()).toBe(200);
    const result = await response.json() as { localId: string; idToken: string };
    createdUsers.add(result.localId);
    return result;
  }
  async function token(uid: string, options: { age?: number; audience?: string; provider?: string } = {}) {
    const seconds = Math.floor(now() / 1000);
    return new SignJWT({ email, email_verified: true, name: "풀사이클 검증 계정", auth_time: seconds - (options.age ?? 0), firebase: { sign_in_provider: options.provider ?? "google.com" } })
      .setProtectedHeader({ alg: "RS256", kid: "isolated-verification" }).setSubject(uid)
      .setIssuer(`https://securetoken.google.com/${projectId}`).setAudience(options.audience ?? projectId)
      .setIssuedAt(seconds).setExpirationTime(seconds + 3600).sign(key);
  }
  async function login(uid: string, redirect: "/today" | "/profile?onboarding=1" | "/account/recovery") {
    const idToken = await token(uid);
    const response = await context.request.post("/api/auth/google", { headers, data: { idToken } });
    expect(response.status(), await response.text()).toBe(200);
    expect((await response.json()).redirectTo).toBe(redirect);
    const names = (await context.cookies()).map((cookie) => cookie.name);
    expect(names.includes("care_atlas_session")).toBe(redirect !== "/account/recovery");
    expect(names.includes("ipillgood_account_recovery")).toBe(redirect === "/account/recovery");
    return idToken;
  }
  async function start(uid: string, idToken: string) {
    const response = await browserRequest("/api/account/deletion", {
      action: "start", idToken, confirmation: "회원 탈퇴", policyVersion: getAccountDeletionPolicy().version,
    });
    if (response.status() !== 202) evidence.push({ step: "start-failure", response: await response.json(), committedJob: Boolean(await job(uid)) });
    expect(response.status(), await response.text()).toBe(202);
    const result = (await response.json()) as AccountDeletion;
    expect(result.deleteAfter).toBe(accountDeletionDeadline(new Date(result.requestedAt)));
    expect((await job(uid))?.status).toBe("pending");
    expect((await context.cookies()).some((cookie) => cookie.name === "care_atlas_session")).toBe(false);
    return result;
  }
  async function finishSuspension(uid: string) {
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/login\?withdrawn=1$/, { timeout: 60_000 });
    await expect(page.getByRole("status")).toContainText("3개월 안에 같은 Google 계정으로 로그인하면 복구 절차를 안내해요");
    expect((await job(uid))?.status).toBe("soft_deleted");
    expect((await context.cookies()).some((cookie) => ["care_atlas_session", "ipillgood_account_deletion", "ipillgood_push_device"].includes(cookie.name))).toBe(false);
  }
  async function notificationsEmpty(uid: string) {
    for (const name of ["pushSubscriptions", "medicationReminderSchedules", "medicationReminderSync", "pushDeliveries"]) {
      expect((await f.admin.collection(name).where("recipientId", "==", `google-${uid}`).get()).size).toBe(0);
    }
  }
  const protectedStatus = (cookie?: string) => request.get("/api/push/subscriptions?deviceId=test-device-000001", { headers: cookie ? { cookie } : {} });
  async function cleanupCron() {
    const response = await request.post("/api/account/deletion/cleanup", { headers: { "x-ipillgood-cron-secret": process.env.PUSH_CRON_SECRET! } });
    expect(response.status(), await response.text()).toBe(200);
    expect((await response.json()).failed).toBe(0);
    return response.json();
  }
  await context.setExtraHTTPHeaders({ "cf-connecting-ip": clientAddress });
  await context.route("**/*", (route) => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    const original = await identity();
    const uid = original.localId;
    const rid = `google-${uid}`;
    const other = await identity(`other-${googleSub}`, `other-${email}`);
    await seedCareAccount(f.firestore, rid, { consent: true, medications: [syntheticMedication] });
    await seedCareAccount(f.firestore, `google-${other.localId}`, { consent: true });
    const preserved = { synthetic: "preserve-until-expiry", scope: "own-account-only" };
    const secret = recipient(uid).collection("unknown").doc("missing-parent").collection("nested").doc("preserved");
    await secret.set(preserved);
    const otherRecord = recipient(other.localId).collection("unknown").doc("untouched");
    await otherRecord.set({ synthetic: "other-account-control" });
    const bulk = f.admin.batch();
    for (let index = 0; index < 205; index++) bulk.set(recipient(uid).collection("verificationRecords").doc(String(index).padStart(3, "0")), { synthetic: index });
    for (const name of ["pushSubscriptions", "medicationReminderSchedules", "medicationReminderSync", "pushDeliveries"]) {
      bulk.set(f.admin.collection(name).doc(`${rid}-full-cycle`), { recipientId: rid, synthetic: true });
    }
    await bulk.commit();

    // Positive login and negative crypto/provider cases use the real verifier, not a fixture session.
    for (const idToken of [original.idToken, await token(uid, { audience: "wrong-project" }), await token(uid, { provider: "password" })]) {
      expect((await request.post("/api/auth/google", { headers, data: { idToken } })).status()).toBe(401);
    }
    const originalIdToken = await login(uid, "/today");
    const originalCookie = (await context.cookies()).find((cookie) => cookie.name === "care_atlas_session")!;
    const oldCookie = `care_atlas_session=${originalCookie.value}`;
    expect(decodeJwt(originalCookie.value).sub).toBe(uid);

    // Shared-care connection is now part of main. Exercise its real owner UI, code redemption,
    // connected session and account-deletion boundary instead of only seeding collection rows.
    await page.goto("/profile");
    await page.getByRole("button", { name: "연결 코드 만들기", exact: true }).click();
    const connectionCode = (await page.locator(".connection-code__value").innerText()).trim();
    expect(connectionCode).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    connectedContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
    await connectedContext.setExtraHTTPHeaders({ "cf-connecting-ip": `2001:db8:${addressParts.slice().reverse().join(":")}::2` });
    await connectedContext.route("**/*", (route) => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    const connectedPage = await connectedContext.newPage();
    connectedPage.on("pageerror", (error) => pageErrors.push(`connected: ${error.message}`));
    await connectedPage.goto("/login");
    await connectedPage.getByRole("tab", { name: "연결 코드" }).click();
    await connectedPage.getByLabel("연결 코드").fill(connectionCode);
    await connectedPage.getByRole("button", { name: /연결하기/ }).click();
    await expect(connectedPage).toHaveURL(/\/today$/);
    await expect(connectedPage.getByText(syntheticMedication.productName, { exact: true }).first()).toBeVisible();
    const connectedCookie = (await connectedContext.cookies()).find((cookie) => cookie.name === "care_atlas_session")!;
    expect(decodeJwt(connectedCookie.value)).toMatchObject({ provider: "connected", recipientId: rid, ownerUserId: uid });
    const activeConnection = (await f.admin.collection("careConnections").doc(rid).get()).data() as { status?: string; loginCodeHash?: string; connectedUserId?: string };
    expect(activeConnection.status).toBe("active");
    expect(activeConnection.loginCodeHash).toBeTruthy();
    connectionCodeHash = activeConnection.loginCodeHash;
    evidence.push({ step: "shared-care-connection", realCodeRedemption: true, connectedSessionIssued: true, sharedMedicationVisible: true });

    await page.getByRole("button", { name: "회원 탈퇴", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: "Google로 본인 확인" })).toBeEnabled();
    await page.keyboard.press("Escape");
    expect(await job(uid)).toBeUndefined();

    const startBody = { action: "start", idToken: originalIdToken, confirmation: "회원 탈퇴", policyVersion: getAccountDeletionPolicy().version };
    expect((await context.request.post("/api/account/deletion", { headers: { origin: "https://untrusted.invalid" }, data: startBody })).status()).toBe(403);
    expect((await browserRequest("/api/account/deletion", { ...startBody, confirmation: "틀린 확인" })).status()).toBe(400);
    expect((await browserRequest("/api/account/deletion", { ...startBody, policyVersion: "outdated" })).status()).toBe(409);
    // Auth emulator accounts start with validSince=creation. Advance time to distinguish stale
    // recent-auth (5 minutes) from a token revoked before account creation.
    advance(360_000);
    expect((await browserRequest("/api/account/deletion", { ...startBody, idToken: await token(uid, { age: 301 }) })).status()).toBe(401);
    expect((await browserRequest("/api/account/deletion", { ...startBody, idToken: await token(other.localId) })).status()).toBe(403);
    expect(await job(uid)).toBeUndefined();
    evidence.push({ step: "auth-and-reauth-guards", unsignedToken: 401, wrongAudience: 401, nonGoogle: 401, staleReauth: 401, otherAccount: 403 });

    const first = await start(uid, await token(uid));
    // Old tabs lose service access immediately, before the asynchronous suspension finishes.
    expect((await protectedStatus(oldCookie)).status()).toBe(401);
    expect((await request.post("/api/documents/analyze", { headers: { cookie: oldCookie }, multipart: { documentType: "처방전", sample: "true" } })).status()).toBe(401);
    const revokedConnection = (await f.admin.collection("careConnections").doc(rid).get()).data() as { status?: string; revokeReason?: string };
    expect(revokedConnection).toMatchObject({ status: "revoked", revokeReason: "account_deletion" });
    expect((await f.admin.collection("connectionCodes").doc(connectionCodeHash!).get()).data()?.status).toBe("revoked");
    await connectedPage.goto("/today");
    await expect(connectedPage).toHaveURL(/\/login$/);
    expect((await connectedContext.request.get("/api/push/subscriptions?deviceId=test-device-000001")).status()).toBe(401);
    evidence.push({ step: "shared-care-withdrawal-boundary", connectionRevoked: true, codeRevoked: true, connectedSessionRejected: true });
    await finishSuspension(uid);
    expect((await secret.get()).data()).toEqual(preserved);
    expect((await recipient(uid).collection("verificationRecords").get()).size).toBe(205);
    expect((await recipient(uid).collection("medicationPlans").doc(syntheticMedication.id).get()).data()).toEqual(syntheticMedication);
    const suspendedAuth = await auth.lookup(uid);
    expect(suspendedAuth).not.toBeNull();
    expect(suspendedAuth?.disabled).not.toBe(true);
    expect(Number(suspendedAuth?.validSince)).toBeGreaterThan(0);
    await notificationsEmpty(uid);
    expect((await request.post("/api/auth/google", { headers, data: { idToken: originalIdToken } })).status()).toBe(401);
    evidence.push({ step: "soft-delete", status: (await job(uid))?.status, authRetained: true, healthRetained: true, pushRemoved: true, oldSessionsRejected: true });

    advance(60_000);
    expect((await identity()).localId).toBe(uid);
    await login(uid, "/account/recovery");
    expect((await browserRequest("/api/push/subscriptions?deviceId=test-device-000001")).status()).toBe(401);
    await page.goto("/account/recovery");
    await expect(page.getByRole("heading", { name: "탈퇴한 계정을 복구할까요?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "확인하고 계정 복구" })).toBeDisabled();
    await info.attach("server-issued-recovery", { body: await page.screenshot({ path: "verification-artifacts/account-deletion/full-cycle-recovery.png", fullPage: true }), contentType: "image/png" });
    await page.getByRole("button", { name: "복구하지 않고 나가기" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await job(uid))?.deleteAfter).toBe(first.deleteAfter);
    expect((await job(uid))?.status).toBe("soft_deleted");
    expect((await context.cookies()).some((cookie) => cookie.name === "ipillgood_account_recovery")).toBe(false);

    await login(uid, "/account/recovery");
    await page.goto("/account/recovery");
    await page.getByRole("checkbox").focus();
    await page.keyboard.press("Space");
    await page.getByRole("button", { name: "확인하고 계정 복구" }).click();
    await expect(page).toHaveURL(/\/profile\?restored=1$/);
    await expect(page.getByRole("status")).toContainText("계정과 돌봄 기록이 복구됐어요");
    expect((await job(uid))?.status).toBe("restored");
    expect((await secret.get()).data()).toEqual(preserved);
    await notificationsEmpty(uid);
    expect((await protectedStatus(oldCookie)).status()).toBe(401);
    expect((await connectedContext.request.get("/api/push/subscriptions?deviceId=test-device-000001")).status()).toBe(401);
    expect((await f.admin.collection("careConnections").doc(rid).get()).data()).toMatchObject({ status: "revoked", revokeReason: "account_deletion" });
    const restoredStatus = await browserRequest("/api/push/subscriptions?deviceId=test-device-000001");
    expect(restoredStatus.status()).toBe(200);
    expect((await restoredStatus.json()).subscribed).toBe(false);
    evidence.push({ step: "explicit-recovery", cancelledLoginDidNotExtendDeadline: true, healthRestored: true, oldSessionsStillRejected: true, oldSharedCareNotRestored: true, pushStillRemoved: true });

    advance(60_000);
    const second = await start(uid, await token(uid));
    expect(second.requestId).not.toBe(first.requestId);
    expect(Date.parse(second.deleteAfter)).toBeGreaterThan(Date.parse(first.deleteAfter));
    await finishSuspension(uid);
    const deadline = Date.parse(second.deleteAfter);
    advance(deadline - now() - 60_000);
    expect((await request.post("/api/account/deletion/cleanup", { headers: { "x-ipillgood-cron-secret": "wrong-secret" } })).status()).toBe(401);
    await cleanupCron();
    expect((await job(uid))?.status).toBe("soft_deleted");
    expect((await secret.get()).data()).toEqual(preserved);
    await login(uid, "/account/recovery");
    await page.goto("/account/recovery");
    await expect(page.getByRole("button", { name: "확인하고 계정 복구" })).toBeVisible();

    advance(deadline - now() + 2_000);
    await page.reload();
    await expect(page.getByRole("heading", { name: "계정 복구 기간이 지났어요" })).toBeVisible();
    expect((await browserRequest("/api/account/recovery", { action: "restore", confirmation: true })).status()).toBe(410);
    await info.attach("server-clock-expired", { body: await page.screenshot({ path: "verification-artifacts/account-deletion/full-cycle-expired.png", fullPage: true }), contentType: "image/png" });
    let cronCalls = 0;
    while (await job(uid)) {
      expect(cronCalls++).toBeLessThan(6);
      await cleanupCron();
    }
    expect(await auth.lookup(uid)).toBeNull();
    expect(await verifyRecipientHealthDataDeleted({ firestore: f.firestore, recipientId: rid, includeProfile: true })).toBe(true);
    expect((await f.admin.collection("careConnections").doc(rid).get()).exists).toBe(false);
    expect((await f.admin.collection("connectionCodes").where("recipientId", "==", rid).get()).empty).toBe(true);
    expect((await otherRecord.get()).data()).toEqual({ synthetic: "other-account-control" });
    expect(await auth.lookup(other.localId)).not.toBeNull();
    expect((await protectedStatus(oldCookie)).status()).toBe(401);
    expect((await request.post("/api/auth/google", { headers, data: { idToken: await token(uid) } })).status()).toBe(401);
    evidence.push({ step: "three-calendar-month-expiry", beforeDeadlineRetained: true, expiredRecoveryStatus: 410, cronCalls, authRemoved: true, healthAndUnknownDescendantsRemoved: true, sharedCareRemoved: true, jobRemoved: true, otherAccountUnchanged: true });

    await page.getByRole("button", { name: "로그인 화면으로" }).click();
    await expect(page).toHaveURL(/\/login$/);
    advance(60_000);
    const rejoined = await identity();
    expect(rejoined.localId).not.toBe(uid);
    await login(rejoined.localId, "/profile?onboarding=1");
    await page.goto("/profile?onboarding=1");
    await expect(page.getByRole("status")).toContainText("동의를 먼저 확인해 주세요");
    const denied = await browserRequest("/api/documents/analyze", {});
    expect(denied.status()).toBe(403);
    const cleanModel = (await f.admin.collection("careReadModels").doc(`google-${rejoined.localId}`).get()).data();
    expect(cleanModel?.documents ?? []).toEqual([]);
    expect(cleanModel?.medications ?? []).toEqual([]);
    await notificationsEmpty(rejoined.localId);
    expect(await job(rejoined.localId)).toBeUndefined();
    evidence.push({ step: "same-google-rejoin", newFirebaseUid: true, oldHealthNotRestored: true, oldPushNotRestored: true });
    expect(pageErrors).toEqual([]);
  } finally {
    const report = JSON.stringify({ provider: "synthetic Google/JWKS; real application auth and emulator APIs", evidence, pageErrors }, null, 2);
    writeFileSync("verification-artifacts/account-deletion/full-cycle-evidence.json", report);
    await info.attach("full-cycle-evidence", { body: report, contentType: "application/json" });
    writeFileSync(clockPath, "0");
    await connectedContext?.close();
    for (const uid of createdUsers) {
      const recipientId = `google-${uid}`;
      await auth.delete(uid);
      await f.admin.recursiveDelete(recipient(uid));
      await f.admin.recursiveDelete(f.admin.collection("careReadModels").doc(recipientId));
      await f.admin.recursiveDelete(f.admin.collection("careConnections").doc(recipientId));
      for (const code of (await f.admin.collection("connectionCodes").where("recipientId", "==", recipientId).get()).docs) await f.admin.recursiveDelete(code.ref);
      await f.admin.collection("accountDeletions").doc(recipientId).delete();
      for (const name of ["pushSubscriptions", "medicationReminderSchedules", "medicationReminderSync", "pushDeliveries"]) {
        for (const row of (await f.admin.collection(name).where("recipientId", "==", recipientId).get()).docs) await row.ref.delete();
      }
    }
    await f.cleanup();
  }
});
