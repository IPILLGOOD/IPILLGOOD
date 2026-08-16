import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const playwrightEntry = process.env.CARE_ATLAS_PLAYWRIGHT;
if (!playwrightEntry) throw new Error("CARE_ATLAS_PLAYWRIGHT is required");
const baseUrl = process.env.CARE_ATLAS_BASE_URL ?? "http://127.0.0.1:3000";

const { chromium } = await import(pathToFileURL(playwrightEntry).href);
const require = createRequire(import.meta.url);
const axeSource = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
const artifacts = new URL("../../design/screenshots/", import.meta.url);
await mkdir(artifacts, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CARE_ATLAS_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const routes = [
  "/",
  "/login",
  "/today",
  "/dashboard",
  "/medications",
  "/medications/med-amlodipine",
  "/check-in",
  "/documents",
  "/profile",
  "/report",
];
const viewports = [
  { name: "phone-320", width: 320, height: 780 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1024", width: 1024, height: 800 },
  { name: "desktop-1440", width: 1440, height: 1000 },
];
const failures = [];
const results = [];

for (const viewport of viewports) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  for (const route of routes) {
    if (route === "/today") {
      await context.request.post(`${baseUrl}/api/auth/demo`);
    }
    const response = await page.goto(`${baseUrl}${route}`, {
      waitUntil: "networkidle",
    });
    const metrics = await page.locator("body").evaluate((body) => ({
      scrollWidth: body.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      title: document.title,
      heading: document.querySelector("h1")?.textContent?.trim() ?? "",
    }));
    if (!response?.ok()) failures.push(`${viewport.name} ${route}: HTTP ${response?.status()}`);
    if (metrics.scrollWidth > metrics.clientWidth + 1) {
      failures.push(
        `${viewport.name} ${route}: horizontal overflow ${metrics.scrollWidth}/${metrics.clientWidth}`,
      );
    }
    if (!metrics.heading) failures.push(`${viewport.name} ${route}: missing h1`);
    results.push({ viewport: viewport.name, route, ...metrics });
  }

  if (consoleErrors.length) {
    failures.push(`${viewport.name}: console errors: ${consoleErrors.join(" | ")}`);
  }
  await context.close();
}

const auditContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const auditPage = await auditContext.newPage();
for (const route of routes) {
  if (route === "/today") {
    await auditContext.request.post(`${baseUrl}/api/auth/demo`);
  }
  await auditPage.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
  await auditPage.addScriptTag({ content: axeSource });
  const axe = await auditPage.evaluate(async () =>
    globalThis.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    }),
  );
  for (const violation of axe.violations) {
    const nodes = violation.nodes
      .map((node) => `${node.target.join(" ")} (${node.failureSummary ?? ""})`)
      .join(" | ");
    failures.push(
      `${route}: axe ${violation.impact} ${violation.id} — ${violation.help}: ${nodes}`,
    );
  }
  const smallTargets = await auditPage.locator("body").evaluate(() =>
    Array.from(
      document.querySelectorAll(
        'a:not(.skip-link), button, select, textarea, input:not([type="radio"]):not([type="checkbox"]):not([type="file"])',
      ),
    )
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          text: element.textContent?.trim().slice(0, 30) ?? "",
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      })
      .filter((target) => target.width < 44 || target.height < 44),
  );
  for (const target of smallTargets) {
    failures.push(
      `${route}: small target ${target.tag} "${target.text}" ${target.width}x${target.height}`,
    );
  }
}

const largeTextContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
const largeTextPage = await largeTextContext.newPage();
for (const route of routes) {
  if (route === "/today") {
    await largeTextContext.request.post(`${baseUrl}/api/auth/demo`);
  }
  await largeTextPage.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
  await largeTextPage.addStyleTag({ content: "html { font-size: 125% !important; }" });
  const overflow = await largeTextPage.locator("body").evaluate((body) => ({
    scrollWidth: body.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (overflow.scrollWidth > overflow.clientWidth + 1) {
    failures.push(
      `${route}: 125% text overflow ${overflow.scrollWidth}/${overflow.clientWidth}`,
    );
  }
}
await largeTextContext.close();

const screenshotContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const screenshotPage = await screenshotContext.newPage();
const screenshots = [
  { route: "/", name: "landing-desktop.png", width: 1440, height: 1000 },
  { route: "/", name: "landing-mobile.png", width: 375, height: 812 },
  { route: "/login", name: "login-desktop.png", width: 1440, height: 1000 },
  { route: "/login", name: "login-mobile.png", width: 375, height: 812 },
  { route: "/today", name: "today-desktop.png", width: 1440, height: 1000 },
  { route: "/today", name: "today-mobile.png", width: 375, height: 812 },
  { route: "/dashboard", name: "dashboard-desktop.png", width: 1440, height: 1000 },
  { route: "/dashboard", name: "dashboard-mobile.png", width: 375, height: 812 },
  { route: "/check-in", name: "check-in-mobile.png", width: 375, height: 812 },
  { route: "/medications", name: "medications-desktop.png", width: 1440, height: 1000 },
  {
    route: "/medications/med-amlodipine",
    name: "medication-detail-desktop.png",
    width: 1440,
    height: 1000,
  },
  { route: "/documents", name: "documents-desktop.png", width: 1440, height: 1000 },
  { route: "/report", name: "report-desktop.png", width: 1440, height: 1000 },
];
for (const shot of screenshots) {
  if (shot.route === "/today") {
    await screenshotContext.request.post(`${baseUrl}/api/auth/demo`);
  }
  await screenshotPage.setViewportSize({ width: shot.width, height: shot.height });
  await screenshotPage.goto(`${baseUrl}${shot.route}`, { waitUntil: "networkidle" });
  await screenshotPage.screenshot({
    path: fileURLToPath(new URL(shot.name, artifacts)),
    fullPage: true,
  });
}

await screenshotContext.close();
await auditContext.close();
await browser.close();

console.log(JSON.stringify({ results, failures }, null, 2));
if (failures.length) process.exitCode = 1;
