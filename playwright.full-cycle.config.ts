import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

if (!process.env.IPILLGOOD_TEST_IDENTITY_KEY_PATH || !process.env.IPILLGOOD_TEST_CLOCK_PATH) {
  throw new Error("Run npm run verify -- --account-full-cycle for the isolated identity fixture.");
}
export default defineConfig({
  ...base, testDir: "./front/verification", fullyParallel: false, workers: 1, retries: 0,
  timeout: 180_000,
  reporter: [["list"], ["html", { open: "never", outputFolder: "verification-artifacts/full-cycle-report" }]],
  outputDir: "verification-artifacts/full-cycle-results",
});
