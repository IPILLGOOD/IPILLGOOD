import { pathToFileURL } from "node:url";

const playwrightEntry = process.env.CARE_ATLAS_PLAYWRIGHT;
if (!playwrightEntry) throw new Error("CARE_ATLAS_PLAYWRIGHT is required");
const { chromium } = await import(pathToFileURL(playwrightEntry).href);
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CARE_ATLAS_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

await page.goto("http://127.0.0.1:3000/check-in", { waitUntil: "networkidle" });
await page.getByLabel("어지러움", { exact: true }).check();
await page.getByLabel("보호자 메모").fill("자동 검증: 잠깐 앉아 쉬었고 이후 괜찮아졌어요.");
await page.getByRole("button", { name: "오늘의 답변 저장" }).click();
await page.getByText("오늘의 복약과 몸 상태를 기록했어요.").waitFor();

await page.goto("http://127.0.0.1:3000/documents", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "비식별 샘플 처방전으로 체험" }).click();
await page.getByText("샘플 처방전을 확인했어요.").waitFor();

await page.goto("http://127.0.0.1:3000/", { waitUntil: "networkidle" });
const firestoreStatus = await page.getByText("안전하게 저장 중").isVisible();
if (!firestoreStatus) throw new Error("Firestore connection status was not visible");

console.log("Functional QA passed: check-in write, sample document write, dashboard read.");
await browser.close();
