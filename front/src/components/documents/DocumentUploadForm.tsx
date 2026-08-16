"use client";

import { FileImage, FlaskConical, LoaderCircle, LockKeyhole } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { DocumentAnalysisResult } from "@/components/documents/DocumentAnalysisResult";
import type { ClinicalDocumentType, DocumentAnalysis } from "@care-atlas/backend";

interface AnalysisResponse {
  message?: string;
  analysis?: DocumentAnalysis;
  addedMedicationCount?: number;
}

export function DocumentUploadForm() {
  const router = useRouter();
  const [documentType, setDocumentType] = useState<ClinicalDocumentType>("처방전");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [analysis, setAnalysis] = useState<DocumentAnalysis | null>(null);
  const previewUrl = useMemo(
    () => (file?.type.startsWith("image/") ? URL.createObjectURL(file) : null),
    [file],
  );

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function requestAnalysis(formData: FormData) {
    setStatus("pending");
    setMessage(
      documentType === "진단서"
        ? "진단명을 확인하고 공식 질병 정보와 신뢰할 수 있는 출처를 조회하고 있어요."
        : "문서에서 중요한 내용을 찾고 쉬운 말로 정리하고 있어요.",
    );
    setAnalysis(null);

    try {
      const response = await fetch("/api/documents/analyze", {
        method: "POST",
        body: formData,
      });
      const body = (await response.json()) as AnalysisResponse;
      if (!response.ok || !body.analysis) {
        throw new Error(body.message ?? "문서를 분석하지 못했어요.");
      }

      setStatus("success");
      setMessage(body.message ?? "문서 분석을 마쳤어요.");
      setAnalysis(body.analysis);
      router.refresh();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "문서를 분석하지 못했어요.");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await requestAnalysis(new FormData(event.currentTarget));
  }

  async function handleSample() {
    const formData = new FormData();
    formData.set("documentType", documentType);
    formData.set("sample", "true");
    await requestAnalysis(formData);
  }

  const pending = status === "pending";

  return (
    <div className="upload-stack">
      <form onSubmit={handleSubmit}>
        <fieldset className="document-type-field">
          <legend>문서 종류</legend>
          <div className="document-type-options">
            {(["처방전", "진단서"] as const).map((type) => (
              <label className="document-type-option" key={type}>
                <input
                  name="documentType"
                  type="radio"
                  value={type}
                  checked={documentType === type}
                  onChange={() => setDocumentType(type)}
                />
                <span>
                  <strong>{type}</strong>
                  <small>
                    {type === "처방전"
                      ? "약 이름과 먹는 방법을 정리해요"
                      : "확인된 상태와 다음 계획을 정리해요"}
                  </small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="upload-dropzone" htmlFor="document">
          {previewUrl ? (
            <Image
              className="upload-preview"
              src={previewUrl}
              width={520}
              height={300}
              unoptimized
              alt={`선택한 ${documentType} 미리보기`}
            />
          ) : (
            <span>
              <FileImage size={34} aria-hidden="true" />
              <strong>{documentType} 사진 또는 PDF를 선택하세요</strong>
              <p>이름·주민번호·주소는 가린 뒤 올려주세요. 최대 5MB</p>
            </span>
          )}
          <input
            id="document"
            name="document"
            type="file"
            accept="image/*,application/pdf"
            required
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>

        {file ? (
          <p className="selected-file" role="status">
            선택됨: {file.name} · {(file.size / 1024).toFixed(0)}KB
          </p>
        ) : null}

        <div className="privacy-note upload-privacy">
          <LockKeyhole size={20} aria-hidden="true" />
          <p>
            원본 파일은 저장하지 않고 분석 요청에만 사용해요. 분석 결과는 반드시 원본과
            비교해서 확인해주세요.
          </p>
        </div>

        <div className="form-actions">
          <button className="button button--primary" type="submit" disabled={pending}>
            {pending ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : null}
            {pending ? "분석하는 중…" : `${documentType} 첨부하고 분석하기`}
          </button>
        </div>
      </form>

      <div className="sample-divider" aria-hidden="true">
        <span>또는</span>
      </div>
      <button
        className="button button--secondary sample-button"
        type="button"
        disabled={pending}
        onClick={handleSample}
      >
        <FlaskConical size={18} aria-hidden="true" />
        비식별 샘플 {documentType}으로 체험
      </button>

      {status !== "idle" ? (
        <p
          className={`analysis-status analysis-status--${status}`}
          role={status === "error" ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}

      {analysis ? <DocumentAnalysisResult analysis={analysis} /> : null}
    </div>
  );
}
