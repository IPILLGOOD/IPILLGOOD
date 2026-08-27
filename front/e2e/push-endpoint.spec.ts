import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { emulatorFixture } from "../../backend/test-support/emulator";

test("normal subscription API accepts WNS and existing providers, rejects lookalikes", async ({ context }) => {
  const fixture = emulatorFixture("admin");
  const userId = `endpoint-${randomUUID()}`;
  const recipientId = `google-${userId}`;
  const token = await new SignJWT({ name: "Endpoint 검증", provider: "google" }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode(process.env.SESSION_SECRET));
  await context.addCookies([{ name: "care_atlas_session", value: token, url: process.env.IPILLGOOD_TEST_BASE_URL!, httpOnly: true, sameSite: "Lax" }]);
  const body = (endpoint: string) => ({
    deviceId: `device-${randomUUID()}`, platform: "windows", browser: "edge", userAgent: "Synthetic endpoint contract",
    timeZone: "Asia/Seoul", subscription: { endpoint, keys: { p256dh: "x".repeat(87), auth: "y".repeat(22) } },
  });
  try {
    for (const host of ["wns2-bl2p.notify.windows.com", "fcm.googleapis.com", "web.push.apple.com", "updates.push.services.mozilla.com"]) {
      const data = body(`https://${host}/w/?token=synthetic`);
      // Server-to-server request contract; same-origin browser handling has separate tests.
      const response = await context.request.post("/api/push/subscriptions", { data });
      expect(response.status(), await response.text()).toBe(200);
      const status = await context.request.get(`/api/push/subscriptions?deviceId=${data.deviceId}`);
      expect((await status.json()).subscribed).toBe(true);
    }
    const rejected = await context.request.post("/api/push/subscriptions", { data: body("https://notify.windows.com.evil.test/w/") });
    expect(rejected.status()).toBe(400);
    expect((await fixture.admin.collection("pushSubscriptions").where("recipientId", "==", recipientId).get()).size).toBe(4);
  } finally {
    for (const collection of ["pushSubscriptions", "medicationReminderSchedules"]) {
      const docs = await fixture.admin.collection(collection).where("recipientId", "==", recipientId).get();
      for (const doc of docs.docs) await doc.ref.delete();
    }
    await fixture.admin.recursiveDelete(fixture.admin.collection("careRecipients").doc(recipientId));
    await fixture.admin.collection("careReadModels").doc(recipientId).delete();
    await fixture.cleanup();
  }
});
