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
    const { sessionKey } = await (await context.request.get("/api/push/config")).json();
    const headers: Record<string, string> = { "x-push-session": sessionKey };
    for (const host of ["wns2-bl2p.notify.windows.com", "fcm.googleapis.com", "web.push.apple.com", "updates.push.services.mozilla.com"]) {
      const data = body(`https://${host}/w/?token=synthetic`);
      // Server-to-server request contract; same-origin browser handling has separate tests.
      const response = await context.request.post("/api/push/subscriptions", { data, headers });
      expect(response.status(), await response.text()).toBe(200);
      const { bindingId } = await response.json();
      // APIRequestContext does not send Secure cookies over the HTTP-only emulator URL.
      // Assert production attributes, then explicitly carry only these synthetic credentials.
      const issued = response.headers()["set-cookie"];
      expect(issued).toContain("Secure");
      expect(issued).toContain("HttpOnly");
      headers.cookie = `care_atlas_session=${token}; ${issued.split(";")[0]}`;
      const pending = await context.request.get(`/api/push/subscriptions?deviceId=${data.deviceId}`, { headers });
      expect((await pending.json()).subscribed).toBe(false);
      const activated = await context.request.patch("/api/push/subscriptions", { data: { bindingId }, headers });
      expect(activated.status(), await activated.text()).toBe(200);
      const status = await context.request.get(`/api/push/subscriptions?deviceId=${data.deviceId}`, { headers });
      expect((await status.json()).subscribed).toBe(true);
    }
    const rejected = await context.request.post("/api/push/subscriptions", { data: body("https://notify.windows.com.evil.test/w/"), headers });
    expect(rejected.status()).toBe(400);
    const records = await fixture.admin.collection("pushSubscriptions").where("recipientId", "==", recipientId).get();
    expect(records.size).toBe(4);
    const cookieBinding = headers.cookie.split("ipillgood_push_binding=")[1];
    const bindingId = JSON.parse(Buffer.from(cookieBinding.split(".")[1], "base64url").toString()).bindingId;
    const current = records.docs.find((doc) => doc.data().bindingId === bindingId)!;
    const display = { subscriptionId: current.id, bindingId };
    expect((await context.request.post("/api/push/authorize", { headers, data: display })).status()).toBe(204);
    expect((await context.request.post("/api/auth/logout", { headers, maxRedirects: 0 })).status()).toBe(303);
    expect((await current.ref.get()).data()?.active).toBe(false);
    expect((await context.request.post("/api/push/authorize", { headers, data: display })).status()).toBe(403);
  } finally {
    for (const collection of ["pushSubscriptions", "medicationReminderSchedules", "medicationReminderSync"]) {
      const docs = await fixture.admin.collection(collection).where("recipientId", "==", recipientId).get();
      for (const doc of docs.docs) await doc.ref.delete();
    }
    await fixture.admin.recursiveDelete(fixture.admin.collection("careRecipients").doc(recipientId));
    await fixture.admin.collection("careReadModels").doc(recipientId).delete();
    await fixture.cleanup();
  }
});
