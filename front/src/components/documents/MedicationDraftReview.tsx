"use client";

import {
  BellRing,
  CheckCircle2,
  LoaderCircle,
  Plus,
  TriangleAlert,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  MedicationDraftCandidate,
  type EditableMedicationCandidate,
} from "@/components/documents/MedicationDraftCandidate";
import type { MedicationPlanCandidate, MedicationPlanDraft } from "@care-atlas/backend";

interface ConfirmationResponse {
  message?: string;
  result?: { medications: Array<{ id: string }> };
}

function editableCandidate(candidate: MedicationPlanCandidate): EditableMedicationCandidate {
  return {
    ...candidate,
    mfdsItemSeq: candidate.mfdsItemSeq ?? candidate.itemCode,
    confirmedAgainstOriginal: candidate.reviewStatus === "human_confirmed",
  };
}

export function MedicationDraftReview({ draft }: { draft: MedicationPlanDraft }) {
  const router = useRouter();
  const [candidates, setCandidates] = useState<EditableMedicationCandidate[]>(() =>
    draft.candidates.map(editableCandidate),
  );
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const selected = candidates.filter((candidate) => candidate.included);
  const selectedCount = selected.length;
  const selectionReady = selected.every(
    (candidate) =>
      Boolean(
        candidate.productName.trim() &&
        candidate.doseAmount.trim() &&
        candidate.frequency.trim() &&
        candidate.timing.trim() &&
        candidate.startDate &&
        candidate.endDate,
      ) &&
      (candidate.reviewStatus === "verified" || candidate.confirmedAgainstOriginal),
  );

  function resetRequestState() {
    setIdempotencyKey(crypto.randomUUID());
    setStatus("idle");
    setMessage("");
  }

  function updateCandidate(
    id: string,
    update: Partial<EditableMedicationCandidate>,
    marksEdited = false,
  ) {
    setCandidates((current) => current.map((candidate) =>
      candidate.id === id
        ? {
            ...candidate,
            ...update,
            ...(marksEdited
              ? { reviewStatus: "needs_review" as const, confirmedAgainstOriginal: false }
              : {}),
          }
        : candidate));
    resetRequestState();
  }

  function addManualCandidate() {
    setCandidates((current) => [
      ...current,
      {
        id: `manual-${crypto.randomUUID()}`,
        included: false,
        isManual: true,
        productName: "",
        ingredientName: "",
        mfdsItemSeq: undefined,
        insuranceCode: undefined,
        doseAmount: "",
        frequency: "",
        timing: "",
        startDate: "",
        endDate: undefined,
        supplyDays: undefined,
        reviewStatus: "needs_review",
        confirmedAgainstOriginal: false,
      },
    ]);
    resetRequestState();
  }

  function removeManualCandidate(id: string) {
    setCandidates((current) => current.filter((candidate) => candidate.id !== id));
    resetRequestState();
  }

  async function confirmDraft() {
    setStatus("pending");
    setMessage("선택한 약과 복용 일정을 확인하고 있어요.");
    try {
      const response = await fetch("/api/documents/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: draft.id,
          revision: draft.revision,
          idempotencyKey,
          candidates,
        }),
      });
      const body = await response.json() as ConfirmationResponse;
      if (!response.ok || !body.result) throw new Error(body.message ?? "복약 초안을 확정하지 못했어요.");
      setStatus("success");
      setMessage(body.message ?? "복약 일정에 반영했어요.");
      router.refresh();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "복약 초안을 확정하지 못했어요.");
    }
  }

  const disabled = status === "pending" || status === "success";

  return (
    <section className="medication-draft-review" aria-labelledby="medication-draft-title">
      <div className="medication-draft-review__heading">
        <div>
          <span>복약 후보 초안</span>
          <h3 id="medication-draft-title">원본과 비교해 약과 일정을 검토하세요</h3>
          <p>누락된 약은 직접 추가할 수 있어요. 확정하기 전에는 복약 일정과 알림에 반영되지 않아요.</p>
        </div>
        <strong>{selectedCount}/{candidates.length}개 선택</strong>
      </div>

      {candidates.length === 0 ? (
        <div className="medication-draft-empty" role="status">
          <TriangleAlert size={20} aria-hidden="true" />
          <p><strong>자동으로 찾은 약이 없어요.</strong> 원본 처방전을 보며 약을 직접 추가해주세요.</p>
        </div>
      ) : null}

      <div className="medication-draft-review__list">
        {candidates.map((candidate, index) => (
          <MedicationDraftCandidate
            candidate={candidate}
            disabled={disabled}
            index={index}
            key={candidate.id}
            onRemove={removeManualCandidate}
            onUpdate={updateCandidate}
          />
        ))}
      </div>

      <button className="button button--secondary medication-draft-add" type="button" disabled={disabled || candidates.length >= 50} onClick={addManualCandidate}>
        <Plus size={17} aria-hidden="true" /> 원본에서 약 직접 추가
      </button>

      <div className="medication-draft-summary">
        <BellRing size={20} aria-hidden="true" />
        <p>
          <strong>확정 전 요약</strong>
          선택한 약 {selectedCount}개가 활성 복약 계획과 오늘 일정에 반영되고, 알림을 사용 중이면 새 일정이 생성돼요.
        </p>
        <button className="button button--primary" type="button" disabled={selectedCount === 0 || !selectionReady || disabled} onClick={confirmDraft}>
          {status === "pending" ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : null}
          {status === "success" ? <CheckCircle2 size={18} aria-hidden="true" /> : null}
          {status === "pending" ? "확정하는 중…" : status === "success" ? "복약 일정 반영 완료" : `선택한 약 ${selectedCount}개 확정`}
        </button>
      </div>

      {message ? <p className={`analysis-status analysis-status--${status}`} role={status === "error" ? "alert" : "status"}>{message}</p> : null}
    </section>
  );
}
