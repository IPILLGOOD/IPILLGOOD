"use client";

import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
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
  const [currentIndex, setCurrentIndex] = useState(0);
  const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const selected = candidates.filter((candidate) => candidate.included);
  const selectedCount = selected.length;
  const currentCandidate = candidates[currentIndex];
  const currentCandidateReady = currentCandidate
    ? Boolean(
        currentCandidate.productName.trim() &&
        currentCandidate.doseAmount.trim() &&
        currentCandidate.frequency.trim() &&
        currentCandidate.timing.trim() &&
        currentCandidate.startDate &&
        currentCandidate.endDate,
      ) && (currentCandidate.reviewStatus === "verified" || currentCandidate.confirmedAgainstOriginal)
    : false;
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
    setCandidates((current) => {
      setCurrentIndex(current.length);
      return [...current, {
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
      }];
    });
    resetRequestState();
  }

  function removeManualCandidate(id: string) {
    setCandidates((current) => current.filter((candidate) => candidate.id !== id));
    setCurrentIndex((current) => Math.max(0, current - 1));
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
      router.push("/dashboard");
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
          <span>복약 후보</span>
          <h3 id="medication-draft-title">약을 하나씩 확인하세요</h3>
        </div>
      </div>

      {candidates.length > 1 ? (
        <ol className="medication-review-stepper" aria-label="약 확인 단계">
          {candidates.map((candidate, index) => {
            const completed = index < currentIndex;
            const current = index === currentIndex;
            return (
              <li className={`${completed ? "is-complete" : ""}${current ? " is-current" : ""}`} key={candidate.id}>
                <button
                  type="button"
                  aria-current={current ? "step" : undefined}
                  aria-label={`약 ${index + 1}${completed ? " 확인 완료" : current ? " 확인 중" : " 확인 전"}`}
                  disabled={disabled || index > currentIndex}
                  onClick={() => setCurrentIndex(index)}
                >
                  {completed ? <CheckCircle2 size={18} aria-hidden="true" /> : index + 1}
                </button>
              </li>
            );
          })}
        </ol>
      ) : null}

      {candidates.length === 0 ? (
        <div className="medication-draft-empty" role="status">
          <TriangleAlert size={20} aria-hidden="true" />
          <p><strong>자동으로 찾은 약이 없어요.</strong> 원본 처방전을 보며 약을 직접 추가해주세요.</p>
        </div>
      ) : null}

      <div className="medication-draft-review__list">
        {currentCandidate ? (
          <MedicationDraftCandidate
            candidate={currentCandidate}
            disabled={disabled}
            index={currentIndex}
            key={currentCandidate.id}
            onRemove={removeManualCandidate}
            onUpdate={updateCandidate}
          />
        ) : null}
      </div>

      {candidates.length > 1 ? (
        <div className="medication-draft-navigation">
          <button className="button button--secondary" type="button" disabled={disabled || currentIndex === 0} onClick={() => setCurrentIndex((current) => Math.max(0, current - 1))}>
            <ChevronLeft size={17} aria-hidden="true" /> 이전
          </button>
          {currentIndex < candidates.length - 1 ? (
            <button className="button button--primary" type="button" disabled={disabled || !currentCandidateReady} onClick={() => setCurrentIndex((current) => Math.min(candidates.length - 1, current + 1))}>
              다음 약 <ChevronRight size={17} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}

      <button className="button button--secondary medication-draft-add" type="button" disabled={disabled || candidates.length >= 50} onClick={addManualCandidate}>
        <Plus size={17} aria-hidden="true" /> 약 직접 추가
      </button>

      <div className={`medication-draft-summary${currentIndex === candidates.length - 1 ? " is-visible" : ""}`}>
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
