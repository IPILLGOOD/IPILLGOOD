"use client";

import { useActionState, useState, useTransition, type ChangeEvent } from "react";
import { recoverCheckInQuestions, saveCheckInAction } from "@/app/actions";
import { changeDraft, questionRecoveryDraft, type CheckInActionState, type CheckInDraft } from "@/lib/check-in-recovery";
import type { PatientQuestionSet } from "@care-atlas/backend";

const initialState: CheckInActionState = { status: "idle", message: "" };

export function useCheckInForm(
  initialQuestions: PatientQuestionSet | null,
  revision: number,
  initialDraft: CheckInDraft = {},
) {
  const [questionSet, setQuestionSet] = useState(initialQuestions);
  const [draft, setDraft] = useState<CheckInDraft>(initialDraft);
  const [recovering, startRecovery] = useTransition();
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [state, formAction, pending] = useActionState(async (previous: CheckInActionState, data: FormData) => {
    setRecoveryMessage("");
    try { return await saveCheckInAction(previous, data); }
    catch { return { status: "error" as const, message: "연결이 끊겨 저장을 확인하지 못했어요. 입력을 유지했으니 다시 시도해 주세요." }; }
  }, initialState);
  const [baselineRevision, setBaselineRevision] = useState(revision);

  const onChange = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
    // Read all selected checkboxes, including server defaults not yet edited.
    if (target instanceof HTMLInputElement && target.type === "checkbox") {
      const values = new FormData(target.form!).getAll(target.name).filter((value): value is string => typeof value === "string");
      setDraft((current) => ({ ...current, [target.name]: values }));
    } else setDraft((current) => changeDraft(current, target.name, target.value));
  };
  const recover = () => startRecovery(async () => {
    setRecoveryMessage("");
    try {
      const result = await recoverCheckInQuestions();
      if (result.status === "unavailable") { setRecoveryMessage(result.message); return; }
      setDraft((current) => questionRecoveryDraft(current, questionSet?.question_set_id === result.questionSet.question_set_id));
      setQuestionSet(result.questionSet);
      setRecoveryMessage("질문을 다시 준비했어요. 남아 있는 입력과 답변을 확인한 뒤 저장해 주세요.");
    } catch { setRecoveryMessage("연결하지 못했어요. 입력을 유지했으니 잠시 후 다시 시도해 주세요."); }
  });

  return {
    state, formAction, pending: pending || recovering, questionSet, draft, onChange, baselineRevision,
    latestRevisionReady: revision !== baselineRevision,
    acceptLatestRevision: () => setBaselineRevision(revision),
    recover, recovering, recoveryMessage,
    field: (name: string, fallback = "") => ({ value: draft[name]?.[0] ?? fallback, onChange }),
    check: (name: string, value: string, fallback = false) => ({ checked: draft[name] ? draft[name].includes(value) : fallback, onChange }),
  };
}
