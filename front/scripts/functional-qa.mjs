import { pathToFileURL } from "node:url";

const playwrightEntry = process.env.IPILLGOOD_PLAYWRIGHT;
if (!playwrightEntry) throw new Error("IPILLGOOD_PLAYWRIGHT is required");
const baseUrl = process.env.IPILLGOOD_BASE_URL ?? "http://127.0.0.1:3000";
const playwright = await import(pathToFileURL(playwrightEntry).href);
const chromium = playwright.chromium ?? playwright.default?.chromium;
if (!chromium) throw new Error("Chromium was not available from IPILLGOOD_PLAYWRIGHT");
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.IPILLGOOD_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /데모로 둘러보기/ }).click();
await page.waitForURL("**/today");
const quickCheckIn = page.getByRole("form", { name: "오늘의 안부 바로 기록" });
if ((await quickCheckIn.locator('select[name^="dose_"]').count()) !== 0) {
  throw new Error("Quick check-in still exposes duplicate dose controls");
}
await quickCheckIn.getByLabel("어지러움", { exact: true }).check();
await quickCheckIn
  .getByLabel("보호자 메모")
  .fill("자동 검증: 첫 화면에서 확인했고 잠깐 쉰 뒤 괜찮아졌어요.");
const dynamicQuestions = quickCheckIn.locator('select[name^="question_"]');
for (let index = 0; index < (await dynamicQuestions.count()); index += 1) {
  const question = dynamicQuestions.nth(index);
  const firstAnswer = await question.locator("option:not([disabled])").first().getAttribute("value");
  if (!firstAnswer) throw new Error("Dynamic care question did not include an answer option");
  await question.selectOption(firstAnswer);
}
await quickCheckIn.getByRole("button", { name: "안부 기록 저장" }).click();
await page.getByText("오늘의 몸 상태를 기록했어요.").waitFor();

await page.goto(`${baseUrl}/documents`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "비식별 샘플 처방전으로 체험" }).click();
await page.getByText("비식별 데모 분석을 마쳤어요.").waitFor();
await page.getByRole("heading", { name: "처방전 분석 결과" }).waitFor();
const sampleDocuments = page.getByText("비식별_샘플_처방전.jpg", { exact: true });
const sampleCountBeforeDelete = await sampleDocuments.count();
const documentCountBeforeDelete = await page.locator(".document-item").count();
page.once("dialog", (dialog) => dialog.accept());
await page
  .getByRole("button", { name: "“비식별_샘플_처방전.jpg” 문서 삭제" })
  .first()
  .click();
await page.waitForFunction(
  ({ selector, expected }) => document.querySelectorAll(selector).length === expected,
  {
    selector: ".document-item",
    expected: documentCountBeforeDelete - 1,
  },
);
if ((await sampleDocuments.count()) !== sampleCountBeforeDelete - 1) {
  throw new Error("Deleted document remained in the registered document list");
}

await page.goto(`${baseUrl}/today`, { waitUntil: "networkidle" });
const persistedNote = await page.getByLabel("보호자 메모").inputValue();
if (persistedNote !== "자동 검증: 첫 화면에서 확인했고 잠깐 쉰 뒤 괜찮아졌어요.") {
  throw new Error("Persisted check-in note was not restored from Firestore");
}
if (!(await page.getByLabel("어지러움", { exact: true }).isChecked())) {
  throw new Error("Persisted symptom was not restored from Firestore");
}

await page.getByRole("button", { name: "로그아웃" }).click();
await page.waitForURL(`${baseUrl}/`);
console.log(
  "Functional QA passed: wellbeing check-in, sample document add/delete, dashboard read, logout cleanup.",
);
await browser.close();
