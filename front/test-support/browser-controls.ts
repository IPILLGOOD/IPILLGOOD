import { expect, type Locator, type Page } from "@playwright/test";

// The delayed mobile install prompt can appear during any care task. Dismiss
// it through the UI, without force-clicking through it or pre-seeding storage.
export async function dismissInstallPromptWhenShown(page: Page) {
  await page.addLocatorHandler(page.getByRole("button", { name: "PWA 설치 안내 닫기", exact: true }), async (close) => {
    await close.click();
  });
}

// Choice cards hide the native input. Click the label users see, then verify
// the native state; force-clicking the input would bypass pointer regressions.
export async function checkChoice(input: Locator) {
  if (!await input.isChecked()) await input.locator("xpath=ancestor::label").click();
  await expect(input).toBeChecked();
}

export async function enterConnectionCode(page: Page, code: string) {
  const characters = code.replace(/-/g, "");
  expect(characters).toHaveLength(8);
  const group = page.getByRole("group", { name: "연결 코드", exact: true });
  await expect(group.getByRole("textbox")).toHaveCount(8);
  await group.getByRole("textbox", { name: "연결 코드 1번째 문자", exact: true }).focus();
  // Keyboard typing exercises automatic focus movement between all eight cells.
  await page.keyboard.type(characters);
  for (let index = 0; index < characters.length; index++) {
    await expect(group.getByRole("textbox", { name: `연결 코드 ${index + 1}번째 문자`, exact: true })).toHaveValue(characters[index]);
  }
  await expect(group.getByRole("status")).toHaveText("연결 코드 8자리를 모두 입력했어요.");
}
