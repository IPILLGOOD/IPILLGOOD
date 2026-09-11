import { expect, type Page } from "@playwright/test";
import { checkChoice } from "./browser-controls";

// new_work presents the source, symptoms and generated questions on one page.
export async function openCheckInDetails(page: Page, options: { source?: string; symptoms?: string[] } = {}) {
  const form = page.getByRole("form", { name: "오늘의 안부 기록", exact: true });
  if (options.source) await checkChoice(form.getByLabel(options.source, { exact: true }));
  for (const symptom of options.symptoms ?? []) await checkChoice(form.getByLabel(symptom, { exact: true }));
  const questions = form.locator(".dynamic-question");
  expect(await questions.count()).toBeGreaterThan(0);
  for (const question of await questions.all()) {
    const radios = question.getByRole("radio");
    const selected = await radios.evaluateAll(inputs => inputs.some(input => (input as HTMLInputElement).checked));
    if (!selected) await checkChoice(radios.first());
  }
  await expect(form.getByLabel("보호자 메모")).toBeVisible();
  return form;
}
