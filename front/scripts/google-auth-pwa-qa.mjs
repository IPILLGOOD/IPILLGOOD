import { pathToFileURL } from "node:url";

const playwrightEntry = process.env.IPILLGOOD_PLAYWRIGHT;
if (!playwrightEntry) throw new Error("IPILLGOOD_PLAYWRIGHT is required");
const baseUrl = process.env.IPILLGOOD_BASE_URL ?? "http://localhost:3000";
const expectedAuthHost = process.env.IPILLGOOD_EXPECTED_AUTH_HOST;
// Exercise a local build under the registered HTTPS app origin without deploying.
const localOrigin = process.env.IPILLGOOD_LOCAL_ORIGIN;
if (localOrigin && !["127.0.0.1", "localhost"].includes(new URL(localOrigin).hostname)) {
  throw new Error("IPILLGOOD_LOCAL_ORIGIN must be a loopback server");
}
const playwrightModule = await import(pathToFileURL(playwrightEntry).href);
const chromium = playwrightModule.chromium ?? playwrightModule.default?.chromium;
if (!chromium) throw new Error("Chromium launcher was not found in the Playwright runtime");

const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.IPILLGOOD_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
try {
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 Version/18.4 Mobile/15E148 Safari/604.1",
});
context.setDefaultTimeout(10_000);
if (localOrigin) {
  await context.route(`${new URL(baseUrl).origin}/**`, async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${localOrigin}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
}
await context.addInitScript(() => {
  try { localStorage.setItem("ipillgood:pwa-install-prompt:hidden", "true"); } catch { /* Cross-origin helper */ }
  Object.defineProperty(navigator, "standalone", { configurable: true, get: () => true });
  const originalMatchMedia = window.matchMedia.bind(window);
  window.matchMedia = (query) => {
    const result = originalMatchMedia(query);
    if (query === "(display-mode: standalone)") Object.defineProperty(result, "matches", { value: true });
    return result;
  };
});
const page = await context.newPage();
const diagnostics = [];
page.on("console", (message) => {
  if (message.type() === "error") diagnostics.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
page.on("request", (request) => {
  if (request.isNavigationRequest()) diagnostics.push(`navigation: ${request.url()}`);
});
page.on("response", (response) => {
  if (response.status() >= 400) diagnostics.push(`http ${response.status()}: ${response.url()}`);
});
await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });

const authHandlerRequest = page.waitForRequest(
  (request) => {
    const url = new URL(request.url());
    return (
      url.pathname === "/__/auth/handler" &&
      url.searchParams.get("authType") === "signInViaRedirect"
    );
  },
  { timeout: 20_000 },
);
const googleOAuthRequest = page.waitForRequest(
  (request) => {
    const url = new URL(request.url());
    return (
      url.hostname === "accounts.google.com" &&
      (url.pathname.includes("/o/oauth2/auth") || url.pathname.includes("/o/oauth2/v2/auth"))
    );
  },
  { timeout: 20_000 },
);

await page.getByRole("button", { name: "Google로 계속하기" }).click();
let handlerRequest;
let oauthRequest;
try {
  [handlerRequest, oauthRequest] = await Promise.all([authHandlerRequest, googleOAuthRequest]);
} catch (error) {
  const visibleError = await page.locator('[role="alert"]').innerText().catch(() => "");
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const buttonState = await page.getByRole("button").evaluate((button) => ({
    ariaBusy: button.getAttribute("aria-busy"),
    disabled: button.hasAttribute("disabled"),
    label: button.textContent?.trim(),
  })).catch(() => null);
  const browserState = await page.evaluate(() => ({
    pending: localStorage.getItem("ipillgood:google-redirect-pending"),
    standalone: matchMedia("(display-mode: standalone)").matches,
    userAgent: navigator.userAgent,
  })).catch(() => null);
  throw new Error([
    error instanceof Error ? error.message : String(error),
    `page: ${page.url()}`,
    bodyText ? `body: ${bodyText.slice(0, 500)}` : "",
    visibleError ? `alert: ${visibleError}` : "",
    `button: ${JSON.stringify(buttonState)}`,
    `browser: ${JSON.stringify(browserState)}`,
    ...diagnostics,
  ].filter(Boolean).join("\n"));
}
const handlerUrl = new URL(handlerRequest.url());
const oauthUrl = new URL(oauthRequest.url());
const redirectUri = oauthUrl.searchParams.get("redirect_uri");
const clientId = oauthUrl.searchParams.get("client_id");
if (!redirectUri) throw new Error("Google OAuth request did not include redirect_uri");
if (expectedAuthHost && new URL(redirectUri).hostname !== expectedAuthHost) {
  throw new Error(`Unexpected auth redirect host: ${redirectUri}`);
}
if (context.pages().length !== 1) {
  throw new Error(`PWA auth opened ${context.pages().length} windows instead of redirecting`);
}

await page.waitForURL((url) => url.hostname === "accounts.google.com", { timeout: 10_000 });
await page.waitForLoadState("domcontentloaded", { timeout: 10_000 });
await page.waitForTimeout(3_000);
const oauthPageText = await page.locator("body").innerText().catch(() => "");
if (/redirect_uri_mismatch|redirect uri mismatch|redirect uri.*mismatch/i.test(oauthPageText)) {
  throw new Error(`Google OAuth rejected the callback URI for ${clientId}: ${redirectUri}`);
}
if (!/Google 계정으로 로그인|Sign in with Google|Choose an account|계정 선택/i.test(oauthPageText)) {
  throw new Error(`Google OAuth page was not ready: ${oauthPageText.slice(0, 300)}`);
}

console.log(JSON.stringify({
  mode: "redirect",
  standalone: true,
  localBuild: Boolean(localOrigin),
  popupCount: 0,
  handlerHost: handlerUrl.hostname,
  clientId,
  redirectUri,
  oauthPageHost: new URL(page.url()).hostname,
  oauthPageState: "account-selection",
  returnMarker: handlerUrl.searchParams.get("redirectUrl")?.includes("google_redirect=1") === true,
}));
} finally {
await browser.close();
}
