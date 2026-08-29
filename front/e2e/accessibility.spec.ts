import { test, expect, type Page, type Locator, type TestInfo } from "@playwright/test";
import axe from "axe-core";
import { writeFileSync, mkdirSync } from "node:fs";

async function tabTo(page: Page, target: Locator) {
  for (let index = 0; index < 100; index++) {
    if (await target.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
  expect(await target.evaluate((element) => {
    const style = getComputedStyle(element);
    // Text fields use a border/shadow focus ring; other controls use an outline.
    return element.matches(":focus-visible") && (
      (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none"
    );
  })).toBe(true);
}

async function typeWithKeyboard(page: Page, target: Locator, value: string) {
  await tabTo(page, target);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(value);
}

test.beforeEach(async ({ context }) => {
  // Never contact OAuth, an AI provider or a real Push service during this audit.
  await context.route("**/*", (route) => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort("blockedbyclient"));
});

async function audit(page: Page, name: string, info: TestInfo) {
  await page.evaluate(axe.source);
  const results = await page.evaluate(async () => (window as unknown as { axe: typeof axe }).axe.run(document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
  }));
  const controls = await page.locator('a[href], button, input:not([type="hidden"]), select, textarea, summary').evaluateAll((elements) => elements.flatMap((element) => {
    const target = element.closest("label") ?? element;
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height || getComputedStyle(target).visibility === "hidden") return [];
    const labelledBy = element.getAttribute("aria-labelledby")?.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    const labels = "labels" in element ? Array.from((element as HTMLInputElement).labels ?? []).map((label) => label.textContent).join(" ") : "";
    const name = labelledBy || element.getAttribute("aria-label") || labels || element.textContent || "";
    return [{ tag: element.tagName, id: element.id, type: element.getAttribute("type"), name: name.trim().replace(/\s+/g, " ").slice(0, 160), role: element.getAttribute("role"), disabled: element.hasAttribute("disabled"), width: Math.round(rect.width), height: Math.round(rect.height), product44: rect.width >= 44 && rect.height >= 44, size24: rect.width >= 24 && rect.height >= 24 }];
  }));
  const report = { name, controls, violations: results.violations, incomplete: results.incomplete, note: "44px is a product goal; a size24=false result still needs spacing/exception assessment. This is not a screen-reader audit." };
  mkdirSync("verification-artifacts/accessibility", { recursive: true });
  writeFileSync(`verification-artifacts/accessibility/${name}.json`, JSON.stringify(report, null, 2));
  await info.attach(name, { body: JSON.stringify(report), contentType: "application/json" });
  await page.screenshot({ path: `verification-artifacts/accessibility/${name}.png` });
  expect(results.violations.map((item) => ({ id: item.id, impact: item.impact, targets: item.nodes.map((node) => node.target) }))).toEqual([]);
}

test("reload and restored landmark focus do not frame the page, while links keep their focus rings", async ({ page }) => {
  await page.goto("/404");
  const main = page.getByRole("main");
  const home = page.getByRole("link", { name: "홈으로 돌아가기", exact: true });

  for (const reload of [false, true]) {
    if (reload) await page.reload();
    await expect(home).toBeVisible();
    // Browser focus restoration and skip links can focus this non-interactive
    // landmark. Keep that capability, without drawing a page-sized focus ring.
    await page.keyboard.press("Tab");
    await main.focus();
    await expect(main).toBeFocused();
    await expect(main).toHaveCSS("outline-style", "none");
    await tabTo(page, home);
  }
});

test("core flows: accessible names, targets, keyboard, error and success states", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login?error=google_login_failed");
  await expect(page.getByRole("alert").filter({ hasText: "Google 로그인 중 문제가 생겼어요" })).toBeVisible();
  await audit(page, "desktop-login-error", info);
  await page.goto("/login");
  await audit(page, "desktop-login", info);
  await tabTo(page, page.getByRole("button", { name: /둘러보기/ }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/today$/);
  await audit(page, "desktop-today", info);
  await tabTo(page, page.getByRole("link", { name: "본문으로 바로가기" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await expect(page.getByRole("main")).toHaveCSS("outline-style", "none");
  await tabTo(page, page.getByRole("link", { name: /확인 시작/ }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/check-in$/);
  const form = page.getByRole("form", { name: "오늘의 복약과 안부 기록" });
  await typeWithKeyboard(page, form.getByLabel("보호자 메모"), "접근성 키보드 검증");
  const doseResponses = form.locator('input[name^="dose_"][value="completed"]');
  for (let index = 0; index < await doseResponses.count(); index++) {
    await tabTo(page, doseResponses.nth(index));
    await page.keyboard.press("Space");
    await expect(doseResponses.nth(index)).toBeChecked();
  }
  const questions = form.locator('select[name^="question_"]');
  for (let index = 0; index < await questions.count(); index++) {
    await tabTo(page, questions.nth(index));
    if (process.platform === "darwin") {
      // macOS headless Chromium does not drive native select popups (also reproduced on plain HTML).
      // This helper verifies selection behavior only; the manual keyboard gate stays open.
      await questions.nth(index).selectOption((await questions.nth(index).locator("option").last().getAttribute("value"))!);
    } else {
      await page.keyboard.press("ArrowDown");
    }
    await expect(questions.nth(index)).not.toHaveValue("");
  }
  await info.attach("native-select-keyboard", { body: JSON.stringify({ platform: process.platform, usedSelectionHelper: process.platform === "darwin" }), contentType: "application/json" });
  await tabTo(page, form.getByRole("button", { name: "오늘의 답변 저장" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("오늘의 복약과 몸 상태를 기록했어요.");
  await audit(page, "desktop-check-in-success", info);
  for (const path of ["/profile", "/documents", "/check-in"]) {
    await page.goto(path);
    await audit(page, `desktop-${path.slice(1)}`, info);
  }
  await page.goto("/documents");
  let releaseFailure!: () => void;
  const failureGate = new Promise<void>((resolve) => { releaseFailure = resolve; });
  await page.route("**/api/documents/analyze", async (route) => {
    await failureGate;
    await route.fulfill({ status: 503, json: { message: "문서를 분석하지 못했어요. 다시 시도해주세요." } });
  });
  await tabTo(page, page.getByRole("button", { name: "비식별 샘플 처방전으로 체험" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "분석하는 중…" })).toBeDisabled();
  await audit(page, "desktop-document-pending", info);
  releaseFailure();
  await expect(page.getByRole("alert").filter({ hasText: "문서를 분석하지 못했어요" })).toBeVisible();
  await audit(page, "desktop-document-error", info);
  await page.unroute("**/api/documents/analyze");
  await tabTo(page, page.getByRole("button", { name: "비식별 샘플 처방전으로 체험" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "기존 복약과 겹치는 항목이 있어요" })).toBeVisible();
  await audit(page, "desktop-document-success", info);
  await page.goto("/profile");
  const consent = page.locator('input[name="consentConfirmed"]');
  await expect(consent).toBeVisible();
  await tabTo(page, consent);
  await page.keyboard.press("Space");
  await audit(page, "desktop-profile-consent", info);
  await page.keyboard.press("Space");
  await typeWithKeyboard(page, page.getByLabel("화면에 표시할 이름"), " ");
  await typeWithKeyboard(page, page.getByLabel("나이", { exact: false }), "75");
  await tabTo(page, page.getByRole("button", { name: "프로필 저장", exact: true }));
  await page.keyboard.press("Enter");
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("화면에 표시할 이름")).toHaveAttribute("aria-invalid", "true");
  await audit(page, "desktop-profile-error", info);
  await typeWithKeyboard(page, page.getByLabel("화면에 표시할 이름"), "접근성 검증");
  await typeWithKeyboard(page, page.getByLabel("나이", { exact: false }), "75");
  await tabTo(page, page.getByRole("button", { name: "프로필 저장", exact: true }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("어르신 프로필을 업데이트했어요.");
  await audit(page, "desktop-profile-success", info);
  await tabTo(page, page.getByRole("button", { name: "로그아웃" }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);
});

test.describe("mobile Push status semantics (simulated user agent, no delivery)", () => {
  test.use({ userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/134.0.0.0 Mobile Safari/537.36" });

  test("loading, configuration failure and unavailable states have one announcement channel", async ({ page }, info) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/push/config", async (route) => {
      await gate;
      await route.fulfill({ status: 500, json: { message: "synthetic configuration failure" } });
    });
    await page.goto("/login");
    await page.getByRole("button", { name: /둘러보기/ }).click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByText("이 기기의 알림 가능 여부를 확인하고 있어요.")).toBeVisible();
    const installPrompt = page.getByRole("dialog", { name: "IPILLGOOD를 앱으로 사용해 보세요" });
    await expect(installPrompt).toBeVisible();
    await installPrompt.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(installPrompt).toBeHidden();
    await audit(page, "push-loading", info);
    release();
    const alert = page.getByRole("alert").filter({ hasText: "알림 연결을 확인하지 못했어요" });
    await expect(alert).toHaveCount(1);
    await expect(alert).toContainText("알림 연결을 확인하지 못했어요");
    expect(await alert.evaluate((element) => element.parentElement?.closest('[aria-live], [role="status"], [role="alert"]') === null)).toBe(true);
    await audit(page, "push-config-error", info);
    await page.unroute("**/api/push/config");
    await page.reload();
    await expect(page.getByText("현재 알림 서버 설정을 준비하고 있어요.")).toBeVisible();
    await audit(page, "push-unconfigured", info);
    await page.getByRole("button", { name: "로그아웃" }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});

test("mobile reflow and 200 percent text size retain usable controls", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/login");
  await audit(page, "mobile-login", info);
  await page.getByRole("button", { name: /둘러보기/ }).click();
  await expect(page).toHaveURL(/\/today$/);
  for (const width of [768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await audit(page, `today-${width}`, info);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 900 });
  for (const path of ["/today", "/profile", "/documents", "/check-in"]) {
    await page.goto(path);
    await audit(page, `mobile-${path.slice(1)}`, info);
    // Text-size stress test; actual OS/browser zoom and mobile screen readers are separate manual gates.
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    const overflow = await page.locator("body *").evaluateAll((elements) => elements.flatMap((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width && (rect.right > innerWidth + 1 || rect.left < -1) && getComputedStyle(element).position !== "fixed"
        ? [{ tag: element.tagName, className: element.className, width: rect.width, right: rect.right }] : [];
    }));
    await info.attach(`overflow-${path.slice(1)}`, { body: JSON.stringify(overflow), contentType: "application/json" });
    expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), JSON.stringify(overflow.slice(0, 12))).toBe(true);
    await audit(page, `large-text-${path.slice(1)}`, info);
  }
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/$/);
});
