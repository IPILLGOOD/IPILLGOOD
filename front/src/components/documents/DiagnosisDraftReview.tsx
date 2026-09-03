"use client";

import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ClinicalDocument } from "@care-atlas/backend";

interface DiagnosisDraft {
  name: string;
  code?: string;
}

export function DiagnosisDraftReview({
  documentId,
  analysisRevision,
  diagnoses,
  onSaved,
}: {
  documentId: string;
  analysisRevision: number;
  diagnoses: DiagnosisDraft[];
  onSaved?: (document: ClinicalDocument) => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<DiagnosisDraft[]>(() =>
    diagnoses.length > 0 ? diagnoses : [{ name: "", code: "" }],
  );
  const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  function updateRow(index: number, update: Partial<DiagnosisDraft>) {
    setRows((current) => current.map((row, rowIndex) =>
      rowIndex === index ? { ...row, ...update } : row));
    setStatus("idle");
    setMessage("");
  }

  async function save() {
    setStatus("pending");
    setMessage("진단 정보를 저장하고 있어요.");
    try {
      const response = await fetch("/api/documents/diagnoses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          expectedAnalysisRevision: analysisRevision,
          diagnoses: rows.map((row) => ({ name: row.name.trim(), code: row.code?.trim() || undefined })),
        }),
      });
      const body = await response.json() as { message?: string; document?: ClinicalDocument };
      if (!response.ok || !body.document) throw new Error(body.message ?? "진단 정보를 저장하지 못했어요.");
      setStatus("success");
      setMessage(body.message ?? "진단 정보를 저장했어요.");
      onSaved?.(body.document);
      router.refresh();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "진단 정보를 저장하지 못했어요.");
    }
  }

  const pending = status === "pending";
  const valid = rows.length > 0 && rows.every((row) => row.name.trim());

  return (
    <section className="diagnosis-draft-review" aria-labelledby={`diagnosis-draft-${documentId}`}>
      <div>
        <h4 id={`diagnosis-draft-${documentId}`}>원본과 대조해 진단 정보를 수정하세요</h4>
        <p>자동 추출값이 빠졌거나 잘못된 경우 진단명과 KCD/ICD 코드를 바로잡을 수 있어요.</p>
      </div>
      <div className="diagnosis-draft-review__rows">
        {rows.map((row, index) => (
          <div className="diagnosis-draft-review__row" key={index}>
            <label>
              진단명 {index + 1}
              <input value={row.name} maxLength={100} onChange={(event) => updateRow(index, { name: event.target.value })} required />
            </label>
            <label>
              질병코드
              <input value={row.code ?? ""} maxLength={20} onChange={(event) => updateRow(index, { code: event.target.value.toUpperCase() })} />
            </label>
            <button className="icon-button" type="button" aria-label={`진단 ${index + 1} 삭제`} disabled={pending || rows.length === 1} onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}>
              <Trash2 size={17} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      <div className="diagnosis-draft-review__actions">
        <button className="button button--secondary" type="button" disabled={pending || rows.length >= 20} onClick={() => setRows((current) => [...current, { name: "", code: "" }])}>
          <Plus size={17} aria-hidden="true" /> 진단 추가
        </button>
        <button className="button button--primary" type="button" disabled={pending || !valid} onClick={save}>
          {pending ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : null}
          수정값 저장
        </button>
      </div>
      {message ? <p className={`analysis-status analysis-status--${status}`} role={status === "error" ? "alert" : "status"}>{message}</p> : null}
    </section>
  );
}
