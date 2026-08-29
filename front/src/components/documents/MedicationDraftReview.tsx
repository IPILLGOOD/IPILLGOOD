"use client";

import { BellRing, CheckCircle2, LoaderCircle, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { MedicationPlanCandidate, MedicationPlanDraft } from "@care-atlas/backend";

type EditableCandidate = Pick<
  MedicationPlanCandidate,
  | "id"
  | "included"
  | "productName"
  | "ingredientName"
  | "doseAmount"
  | "frequency"
  | "timing"
  | "startDate"
  | "endDate"
>;

interface ConfirmationResponse {
  message?: string;
  result?: { medications: Array<{ id: string }> };
}

export function MedicationDraftReview({ draft }: { draft: MedicationPlanDraft }) {
  const router = useRouter();
  const [candidates, setCandidates] = useState<EditableCandidate[]>(draft.candidates);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const selectedCount = candidates.filter((candidate) => candidate.included).length;

  function updateCandidate(id: string, update: Partial<EditableCandidate>) {
    setCandidates((current) => current.map((candidate) =>
      candidate.id === id ? { ...candidate, ...update } : candidate));
    setIdempotencyKey(crypto.randomUUID());
    setStatus("idle");
    setMessage("");
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

  return (
    <section className="medication-draft-review" aria-labelledby="medication-draft-title">
      <div className="medication-draft-review__heading">
        <div>
          <span>복약 후보 초안</span>
          <h3 id="medication-draft-title">원본과 비교해 약과 일정을 검토하세요</h3>
          <p>선택하고 확정하기 전에는 현재 복용약·오늘 일정·알림에 반영되지 않아요.</p>
        </div>
        <strong>{selectedCount}/{candidates.length}개 선택</strong>
      </div>

      <div className="medication-draft-review__list">
        {candidates.map((candidate, index) => (
          <fieldset className="medication-draft-candidate" disabled={status === "pending" || status === "success"} key={candidate.id}>
            <legend>약 {index + 1}</legend>
            <label className="medication-draft-candidate__include">
              <input
                type="checkbox"
                checked={candidate.included}
                onChange={(event) => updateCandidate(candidate.id, { included: event.target.checked })}
              />
              <span>
                <strong>이 약을 복약 일정에 포함</strong>
                <small>제외한 후보는 저장만 되고 활성화되지 않아요.</small>
              </span>
            </label>
            <div className="medication-draft-fields">
              <label>약 이름<input value={candidate.productName} onChange={(event) => updateCandidate(candidate.id, { productName: event.target.value })} required /></label>
              <label>성분명<input value={candidate.ingredientName} onChange={(event) => updateCandidate(candidate.id, { ingredientName: event.target.value })} /></label>
              <label>1회 용량<input value={candidate.doseAmount} onChange={(event) => updateCandidate(candidate.id, { doseAmount: event.target.value })} required /></label>
              <label>횟수<input value={candidate.frequency} onChange={(event) => updateCandidate(candidate.id, { frequency: event.target.value })} required /></label>
              <label>복용 시점<input value={candidate.timing} onChange={(event) => updateCandidate(candidate.id, { timing: event.target.value })} required /></label>
              <label>시작일<input type="date" value={candidate.startDate} onChange={(event) => updateCandidate(candidate.id, { startDate: event.target.value })} required /></label>
              <label>종료일<input type="date" value={candidate.endDate ?? ""} onChange={(event) => updateCandidate(candidate.id, { endDate: event.target.value || undefined })} required /></label>
            </div>
            <p className="medication-draft-candidate__notice">
              <TriangleAlert size={16} aria-hidden="true" /> 분석값은 확인이 필요한 초안이에요. 처방전과 약 봉투를 기준으로 수정해주세요.
            </p>
          </fieldset>
        ))}
      </div>

      <div className="medication-draft-summary">
        <BellRing size={20} aria-hidden="true" />
        <p>
          <strong>확정 전 요약</strong>
          선택한 약 {selectedCount}개가 활성 복약 계획과 오늘 일정에 반영되고, 알림을 사용 중이면 새 일정이 생성돼요.
        </p>
        <button className="button button--primary" type="button" disabled={selectedCount === 0 || status === "pending" || status === "success"} onClick={confirmDraft}>
          {status === "pending" ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : null}
          {status === "success" ? <CheckCircle2 size={18} aria-hidden="true" /> : null}
          {status === "pending" ? "확정하는 중…" : status === "success" ? "복약 일정 반영 완료" : `선택한 약 ${selectedCount}개 확정`}
        </button>
      </div>

      {message ? <p className={`analysis-status analysis-status--${status}`} role={status === "error" ? "alert" : "status"}>{message}</p> : null}
    </section>
  );
}
