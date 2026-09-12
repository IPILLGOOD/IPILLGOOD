import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.IPILLGOOD_TEST_BASE_URL;
if (!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname) || !process.env.FIREBASE_PROJECT_ID?.startsWith("demo-")) {
  throw new Error("Run npm run verify to use an isolated local test project.");
}
export default defineConfig({
  testDir: "./front/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    // Service-worker-owned fetches bypass the mocked analysis status API.
    { name: "webkit-pill-photo", testMatch: "**/pill-photo.spec.ts", use: { ...devices["iPhone 13"], browserName: "webkit", serviceWorkers: "block" } },
  ],
  use: { baseURL, ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, trace: "retain-on-failure", screenshot: "only-on-failure" },
});
