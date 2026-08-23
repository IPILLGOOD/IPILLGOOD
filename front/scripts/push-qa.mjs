import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const playwrightEntry = process.env.IPILLGOOD_PLAYWRIGHT;
if (!playwrightEntry) throw new Error("IPILLGOOD_PLAYWRIGHT is required");
const baseUrl = process.env.IPILLGOOD_BASE_URL ?? "http://127.0.0.1:3000";
const playwrightModule = await import(pathToFileURL(playwrightEntry).href);
const chromium = playwrightModule.chromium ?? playwrightModule.default?.chromium;
if (!chromium) throw new Error("Chromium launcher was not found in the Playwright runtime");
const require = createRequire(import.meta.url);
const axeSource = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.IPILLGOOD_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.grantPermissions(["notifications"], { origin: baseUrl });
const page = await context.newPage();
await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.getByRole("dialog", { name: "IPILLGOOD를 앱으로 사용해 보세요" }).waitFor();
const pwa = await page.evaluate(async () => {
  const response = await fetch("/manifest.webmanifest", { cache: "no-store" });
  if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
  const manifest = await response.json();
  const iconStatuses = await Promise.all(
    manifest.icons.map(async (icon) => ({
      src: icon.src,
      status: (await fetch(icon.src, { cache: "no-store" })).status,
    })),
  );
  const registration = await navigator.serviceWorker.ready;
  return {
    display: manifest.display,
    startUrl: manifest.start_url,
    scope: registration.scope,
    activeWorker: Boolean(registration.active),
    iconStatuses,
  };
});
if (
  pwa.display !== "standalone" ||
  pwa.startUrl !== "/today" ||
  pwa.scope !== `${baseUrl}/` ||
  !pwa.activeWorker ||
  pwa.iconStatuses.some((icon) => icon.status !== 200)
) {
  throw new Error(`PWA installability requirements failed: ${JSON.stringify(pwa)}`);
}
await page.getByRole("button", { name: "PWA 설치 안내 닫기" }).click();
await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /데모로 둘러보기/ }).click();
await page.waitForURL("**/today");
await page.getByRole("heading", { name: /오늘 돌봄/ }).waitFor();
await page.waitForTimeout(100);
if (await page.getByRole("heading", { name: /복약 시간을 알려드려요/ }).count()) {
  throw new Error("The push notification section must be hidden in a non-PWA desktop browser");
}
await page.evaluate(() => navigator.serviceWorker.ready);

const client = await context.newCDPSession(page);
let registrations = [];
client.on("ServiceWorker.workerRegistrationUpdated", (event) => {
  registrations = event.registrations;
});
await client.send("ServiceWorker.enable");
await page.waitForTimeout(250);
const registration = registrations.find((item) => item.scopeURL === `${baseUrl}/`);
if (!registration) throw new Error("Service Worker registration was not found");

const payload = {
  title: "IPILLGOOD 서비스워커 검증",
  body: "앱을 열지 않아도 표시되는 알림 경로를 확인했어요.",
  tag: "ipillgood-qa",
  requireInteraction: true,
  data: {
    url: "/today?notification=qa",
    type: "test",
    deliveryId: "a".repeat(48),
  },
};
const displayedReceiptRequest = context.waitForEvent("request", {
  predicate: (request) =>
    request.method() === "POST" &&
    new URL(request.url()).pathname === "/api/push/receipts" &&
    request.postData()?.includes('"receipt":"displayed"') === true,
  timeout: 3_000,
});
await client.send("ServiceWorker.deliverPushMessage", {
  origin: baseUrl,
  registrationId: registration.registrationId,
  data: JSON.stringify(payload),
});
let notification = null;
for (let attempt = 0; attempt < 50 && !notification; attempt += 1) {
  notification = await page.evaluate(async () => {
    const worker = await navigator.serviceWorker.ready;
    const [item] = await worker.getNotifications({ tag: "ipillgood-qa" });
    if (!item) return null;
    const result = { title: item.title, body: item.body, url: item.data?.url };
    item.close();
    return result;
  });
  if (!notification) await page.waitForTimeout(50);
}
if (!notification || notification.title !== payload.title || notification.url !== payload.data.url) {
  throw new Error(`Unexpected notification payload: ${JSON.stringify(notification)}`);
}
const receiptRequest = await displayedReceiptRequest;
const receiptBody = receiptRequest.postDataJSON();
if (
  receiptBody.deliveryId !== payload.data.deliveryId ||
  receiptBody.receipt !== "displayed"
) {
  throw new Error(`Unexpected displayed receipt: ${JSON.stringify(receiptBody)}`);
}

await page.addScriptTag({ content: axeSource });
const axe = await page.evaluate(async () =>
  globalThis.axe.run(document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
  }),
);
if (axe.violations.length) {
  throw new Error(`Accessibility violations: ${axe.violations.map((item) => item.id).join(", ")}`);
}

for (const width of [320, 768, 1024, 1440]) {
  await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
  const overflow = await page.locator("body").evaluate((body) => ({
    scrollWidth: body.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (overflow.scrollWidth > overflow.clientWidth + 1) {
    throw new Error(`Horizontal overflow at ${width}px: ${JSON.stringify(overflow)}`);
  }
}

if (process.env.IPILLGOOD_QA_SCREENSHOT) {
  await page.screenshot({ path: process.env.IPILLGOOD_QA_SCREENSHOT, fullPage: true });
}

console.log(JSON.stringify({
  pwa,
  desktopNotificationSectionHidden: true,
  notification,
  displayedReceiptRequested: true,
  accessibilityViolations: 0,
  responsiveWidths: [320, 768, 1024, 1440],
}));
await browser.close();
