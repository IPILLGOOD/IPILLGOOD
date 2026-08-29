"use client";

import { FileImage, FlaskConical, GitMerge, Layers3, LoaderCircle, LockKeyhole, TriangleAlert } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { DocumentAnalysisResult } from "@/components/documents/DocumentAnalysisResult";
import { MedicationDraftReview } from "@/components/documents/MedicationDraftReview";
import type { ClinicalDocumentType, DocumentAnalysis, MedicationPlanDraft } from "@care-atlas/backend";

interface AnalysisResponse {
  message?: string;
  analysis?: DocumentAnalysis;
  addedMedicationCount?: number;
  document?: { id: string };
  reviewMedicationCount?: number;
  draft?: MedicationPlanDraft | null;
  requiresPeriodReview?: boolean;
  duplicateResolutionRequired?: boolean;
  duplicateCandidates?: Array<{
    existingMedicationPlanId: string;
    existingDocumentId?: string;
    productName: string;
  }>;
  duplicateResolution?: "merge" | "separate";
}

function copyFormData(source: FormData) {
  const copy = new FormData();
  for (const [key, value] of source.entries()) copy.append(key, value);
  return copy;
}

export function DocumentUploadForm({ allowSamples }: { allowSamples: boolean }) {
  const router = useRouter();
  const [documentType, setDocumentType] = useState<ClinicalDocumentType>("처방전");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [analysis, setAnalysis] = useState<DocumentAnalysis | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MedicationPlanDraft | null>(null);
  const [requiresPeriodReview, setRequiresPeriodReview] = useState(false);
  const [duplicateCandidates, setDuplicateCandidates] = useState<NonNullable<AnalysisResponse["duplicateCandidates"]>>([]);
  const [medicationRegistration, setMedicationRegistration] = useState<"draft" | "pending" | "merged">("draft");
  const retryFormData = useRef<FormData | null>(null);
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
    if (!formData.get("idempotencyKey")) formData.set("idempotencyKey", crypto.randomUUID());
    retryFormData.current = copyFormData(formData);
    setStatus("pending");
    setMessage(
      documentType === "진단서"
        ? "진단명을 확인하고 공식 질병 정보와 신뢰할 수 있는 출처를 조회하고 있어요."
        : "문서에서 중요한 내용을 찾고 쉬운 말로 정리하고 있어요.",
    );
    setAnalysis(null);
    setDocumentId(null);
    setDraft(null);
    setRequiresPeriodReview(false);
    setDuplicateCandidates([]);
    setMedicationRegistration("draft");

    try {
      const response = await fetch("/api/documents/analyze", {
        method: "POST",
        body: formData,
      });
      const body = (await response.json()) as AnalysisResponse;
      if (response.status === 409 && body.duplicateResolutionRequired && body.analysis) {
        setStatus("success");
        setMessage(body.message ?? "기존 복약과 겹치는 후보를 확인해주세요.");
        setAnalysis(body.analysis);
        setDuplicateCandidates(body.duplicateCandidates ?? []);
        setMedicationRegistration("pending");
        return;
      }
      if (!response.ok || !body.analysis) {
        throw new Error(body.message ?? "문서를 분석하지 못했어요.");
      }

      setStatus("success");
      setMessage(body.message ?? "문서 분석을 마쳤어요.");
      setAnalysis(body.analysis);
      setDocumentId(body.document?.id ?? null);
      setDraft(body.draft ?? null);
      setRequiresPeriodReview(body.requiresPeriodReview === true);
      setMedicationRegistration(body.duplicateResolution === "merge" ? "merged" : "draft");
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

  async function resolveDuplicate(action: "merge" | "separate") {
    if (!retryFormData.current) return;
    const formData = copyFormData(retryFormData.current);
    formData.set("duplicateAction", action);
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
            accept="image/jpeg,image/png,image/webp,application/pdf"
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

      {allowSamples ? (
        <>
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
        </>
      ) : null}

      {status !== "idle" ? (
        <p
          className={`analysis-status analysis-status--${status}`}
          role={status === "error" ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}

      {analysis ? (
        <div className="document-verification-layout">
          <figure className="document-verification-original">
            <figcaption>
              <strong>원본 {documentType}</strong>
              <span>{file?.name ?? "비식별 데모 문서"}</span>
            </figcaption>
            {previewUrl ? (
              <Image
                src={previewUrl}
                width={720}
                height={960}
                unoptimized
                alt={`대조할 원본 ${documentType}`}
              />
            ) : (
              <div className="document-verification-original__placeholder">
                <FileImage size={36} aria-hidden="true" />
                <p>{file?.type === "application/pdf" ? "PDF 원본은 파일을 열어 결과와 나란히 확인해주세요." : "데모 원본과 분석 결과를 비교하는 화면이에요."}</p>
              </div>
            )}
          </figure>
          <DocumentAnalysisResult
            analysis={analysis}
            documentId={documentId ?? undefined}
            requiresPeriodReview={requiresPeriodReview}
            medicationRegistration={medicationRegistration}
          />
        </div>
      ) : null}
      {draft ? <MedicationDraftReview draft={draft} /> : null}

      {duplicateCandidates.length > 0 ? (
        <section className="duplicate-resolution" aria-labelledby="duplicate-resolution-title">
          <div className="duplicate-resolution__heading">
            <TriangleAlert size={22} aria-hidden="true" />
            <div>
              <h3 id="duplicate-resolution-title">기존 복약과 겹치는 항목이 있어요</h3>
              <p>같은 처방의 다른 사진·PDF일 수 있어요. 아래 후보를 확인한 뒤 등록 방식을 선택해주세요.</p>
            </div>
          </div>
          <ul>
            {duplicateCandidates.map((candidate) => (
              <li key={`${candidate.existingMedicationPlanId}-${candidate.productName}`}>
                <strong>{candidate.productName}</strong>
                <span>
                  기존 복약 {candidate.existingMedicationPlanId}
                  {candidate.existingDocumentId ? ` · 문서 ${candidate.existingDocumentId}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <div className="duplicate-resolution__actions">
            <button className="button button--primary" type="button" disabled={pending} onClick={() => resolveDuplicate("merge")}>
              <GitMerge size={18} aria-hidden="true" /> 기존 복약과 병합
            </button>
            <button className="button button--secondary" type="button" disabled={pending} onClick={() => resolveDuplicate("separate")}>
              <Layers3 size={18} aria-hidden="true" /> 별도 처방으로 등록
            </button>
          </div>
          <p className="duplicate-resolution__note">병합하면 새 문서는 보존하지만 중복 복약·오늘 일정·알림은 만들지 않아요.</p>
        </section>
      ) : null}
    </div>
  );
}
