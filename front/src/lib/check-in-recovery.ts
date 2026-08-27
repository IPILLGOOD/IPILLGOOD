import type { ActionState } from "@care-atlas/backend";

export type CheckInActionState = ActionState & { recoverQuestions?: boolean };
export type CheckInDraft = Record<string, string[]>;

export function changeDraft(draft: CheckInDraft, name: string, value: string, checked?: boolean): CheckInDraft {
  if (!/^(answeredBy|symptoms|severity|note|dose_[\w-]+|question_[\w-]+)$/.test(name)) return draft;
  return { ...draft, [name]: checked === undefined ? [value] : checked
    ? [...new Set([...(draft[name] ?? []), value])]
    : (draft[name] ?? []).filter((entry) => entry !== value) };
}

export function questionRecoveryDraft(draft: CheckInDraft, sameQuestionSet: boolean): CheckInDraft {
  return sameQuestionSet ? draft : Object.fromEntries(Object.entries(draft).filter(([key]) => !key.startsWith("question_")));
}
