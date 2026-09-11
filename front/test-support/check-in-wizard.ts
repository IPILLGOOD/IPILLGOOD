import { expect, type Page } from "@playwright/test";
import { checkChoice } from "./browser-controls";

// Exercise the visible sequence, including the required questions that remain
// hidden until their step. Existing answers are retained when editing a record.
export async function openCheckInDetails(page: Page, options: { source?: string; symptoms?: string[] } = {}) {
  const form = page.getByRole("form", { name: "오늘의 안부 기록", exact: true });
  if (options.source) await checkChoice(form.getByLabel(options.source, { exact: true }));
  await form.getByRole("button", { name: "다음 질문", exact: true }).click();
  for (const symptom of options.symptoms ?? []) await checkChoice(form.getByLabel(symptom, { exact: true }));
  await form.getByRole("button", { name: "다음 질문", exact: true }).click();
  for (let step = 0; step < 20; step++) {
    const next = form.getByRole("button", { name: "다음 질문", exact: true });
    if (!await next.isVisible()) break;
    const radios = form.getByRole("radio");
    expect(await radios.count()).toBeGreaterThan(0);
    const selected = await radios.evaluateAll((inputs) => inputs.some((input) => (input as HTMLInputElement).checked));
    if (!selected) await checkChoice(radios.first());
    await next.click();
  }
  await expect(form.getByLabel("보호자 메모")).toBeVisible();
  return form;
}
