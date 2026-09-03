"use client";

import { FileImage, FlaskConical, GitMerge, Layers3, LoaderCircle, LockKeyhole, RotateCcw, Square, TriangleAlert } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DocumentAnalysisResult } from "@/components/documents/DocumentAnalysisResult";
import { MedicationDraftReview } from "@/components/documents/MedicationDraftReview";
import type { ClinicalDocument, ClinicalDocumentType, DocumentAnalysis, DocumentAnalysisJob, MedicationPlanDraft } from "@care-atlas/backend";

interface AnalysisResponse {
  message?: string;
  analysis?: DocumentAnalysis;
  addedMedicationCount?: number;
  document?: Pick<ClinicalDocument, "id" | "analysis" | "analysisRevision">;
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
  cancelled?: boolean;
  job?: DocumentAnalysisJob;
}

const activeJobStorageKey = "ipillgood:document-analysis-job";
const ANALYSIS_JOB_POLL_INTERVAL_MS = 2_000;
const ANALYSIS_JOB_DISCOVERY_RETRY_MS = 3_000;

function jobStateMessage(job: DocumentAnalysisJob) {
  if (job.state === "queued") return "분석 작업을 준비하고 있어요.";
  if (job.state === "uploading") return "문서를 안전하게 전달하고 있어요.";
  if (job.state === "extracting") return "파일 형식과 문서 내용을 확인하고 있어요.";
  if (job.state === "analyzing") return "문서 내용을 분석하고 있어요. 정확한 남은 시간은 표시하지 않아요.";
  if (job.state === "saving_draft") return "분석 결과를 검토용 초안으로 저장하고 있어요.";
  if (job.state === "cancellation_requested") return "취소 요청을 처리하고 있어요. 결과가 저장되지 않도록 확인 중이에요.";
  return "문서 분석 상태를 확인하고 있어요.";
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
  const [analysisRevision, setAnalysisRevision] = useState(1);
  const [draft, setDraft] = useState<MedicationPlanDraft | null>(null);
  const [requiresPeriodReview, setRequiresPeriodReview] = useState(false);
  const [duplicateCandidates, setDuplicateCandidates] = useState<NonNullable<AnalysisResponse["duplicateCandidates"]>>([]);
  const [medicationRegistration, setMedicationRegistration] = useState<"draft" | "pending" | "merged">("draft");
  const [activeJobId, setActiveJobId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : sessionStorage.getItem(activeJobStorageKey),
  );
  const [retryJob, setRetryJob] = useState<Pick<DocumentAnalysisJob, "id" | "idempotencyKey"> | null>(null);
  const [retryable, setRetryable] = useState(false);
  const retryFormData = useRef<FormData | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const previewUrl = useMemo(
    () => (file?.type.startsWith("image/") ? URL.createObjectURL(file) : null),
    [file],
  );

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const applyCompletedResponse = useCallback((body: AnalysisResponse) => {
    sessionStorage.removeItem(activeJobStorageKey);
    setActiveJobId(null);
    if (body.duplicateResolutionRequired && body.analysis) {
      setStatus("success");
      setMessage(body.message ?? "기존 복약과 겹치는 후보를 확인해주세요.");
      setAnalysis(body.analysis);
      setDuplicateCandidates(body.duplicateCandidates ?? []);
      setMedicationRegistration("pending");
      setRetryable(false);
      setRetryJob(null);
      return;
    }
    if (!body.analysis) return;
    setStatus("success");
    setMessage(body.message ?? "문서 분석을 마쳤어요.");
    setAnalysis(body.analysis);
    setDocumentId(body.document?.id ?? null);
    setAnalysisRevision(body.document?.analysisRevision ?? 1);
    setDraft(body.draft ?? null);
    setRequiresPeriodReview(body.requiresPeriodReview === true);
    setMedicationRegistration(body.duplicateResolution === "merge" ? "merged" : "draft");
    setRetryable(false);
    setRetryJob(null);
    router.refresh();
  }, [router]);

  useEffect(() => {
    if (!activeJobId) return;
    let stopped = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (stopped || inFlight || document.visibilityState !== "visible" || !navigator.onLine) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/documents/analyze/jobs/${encodeURIComponent(activeJobId)}`, {
          cache: "no-store",
        });
        if (response.status === 404) {
          if (!stopped) timer = setTimeout(poll, ANALYSIS_JOB_DISCOVERY_RETRY_MS);
          return;
        }
        const body = (await response.json()) as { job?: DocumentAnalysisJob; message?: string };
        if (!response.ok || !body.job) throw new Error(body.message ?? "분석 상태를 확인하지 못했어요.");
        const job = body.job;
        if (["queued", "uploading", "extracting", "analyzing", "saving_draft", "cancellation_requested"].includes(job.state)) {
          setStatus("pending");
          setMessage(jobStateMessage(job));
          if (!stopped) timer = setTimeout(poll, ANALYSIS_JOB_POLL_INTERVAL_MS);
          return;
        }
        if (job.state === "completed" && job.result) {
          applyCompletedResponse({ ...job.result, job });
          return;
        }
        if (job.state === "cancelled") {
          sessionStorage.removeItem(activeJobStorageKey);
          setActiveJobId(null);
          setStatus("error");
          setMessage("문서 분석을 취소했어요. 결과와 초안은 저장하지 않았어요. 같은 파일을 다시 선택하면 이 작업을 안전하게 재시도해요.");
          setRetryJob({ id: job.id, idempotencyKey: job.idempotencyKey });
          setRetryable(retryFormData.current !== null);
          return;
        }
        if (job.state === "failed") {
          sessionStorage.removeItem(activeJobStorageKey);
          setActiveJobId(null);
          setStatus("error");
          setMessage(`${job.error?.message ?? "문서 분석에 실패했어요."} 같은 파일을 다시 선택하면 이 작업을 이어서 재시도해요.`);
          setRetryJob(job.error?.retryable === true
            ? { id: job.id, idempotencyKey: job.idempotencyKey }
            : null);
          setRetryable(job.error?.retryable === true && retryFormData.current !== null);
        }
      } catch (error) {
        if (stopped) return;
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "분석 상태를 확인하지 못했어요.");
        setRetryable(retryFormData.current !== null);
      } finally {
        inFlight = false;
      }
    };
    const wake = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      if (timer) clearTimeout(timer);
      timer = undefined;
      void poll();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [activeJobId, applyCompletedResponse]);

  async function requestAnalysis(formData: FormData) {
    if (!formData.get("idempotencyKey")) {
      formData.set("idempotencyKey", retryJob?.idempotencyKey ?? crypto.randomUUID());
    }
    if (!formData.get("jobId")) formData.set("jobId", retryJob?.id ?? crypto.randomUUID());
    setRetryJob(null);
    retryFormData.current = copyFormData(formData);
    const jobId = String(formData.get("jobId"));
    sessionStorage.setItem(activeJobStorageKey, jobId);
    setActiveJobId(jobId);
    setRetryable(false);
    setStatus("pending");
    setMessage("분석 작업을 준비하고 있어요.");
    setAnalysis(null);
    setDocumentId(null);
    setDraft(null);
    setRequiresPeriodReview(false);
    setDuplicateCandidates([]);
    setMedicationRegistration("draft");

    try {
      requestController.current?.abort();
      const controller = new AbortController();
      requestController.current = controller;
      const response = await fetch("/api/documents/analyze", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      const body = (await response.json()) as AnalysisResponse;
      if (response.status === 202 && body.job) {
        setMessage(jobStateMessage(body.job));
        return;
      }
      if (body.cancelled) return;
      if ((response.ok || response.status === 409) && (body.analysis || body.duplicateResolutionRequired)) {
        applyCompletedResponse(body);
        return;
      }
      if (!response.ok || !body.analysis) {
        throw new Error(body.message ?? "문서를 분석하지 못했어요.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "문서를 분석하지 못했어요.");
      setRetryable(retryFormData.current !== null);
    } finally {
      requestController.current = null;
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
    formData.set("jobId", crypto.randomUUID());
    await requestAnalysis(formData);
  }

  async function cancelAnalysis() {
    if (!activeJobId) return;
    setMessage("취소 요청을 보내고 있어요.");
    const response = await fetch(`/api/documents/analyze/jobs/${encodeURIComponent(activeJobId)}`, {
      method: "DELETE",
    });
    const body = (await response.json()) as { message?: string; job?: DocumentAnalysisJob };
    if (!response.ok) {
      setStatus("error");
      setMessage(body.message ?? "취소 요청을 보내지 못했어요.");
      return;
    }
    requestController.current?.abort();
    setMessage(body.message ?? "취소 요청을 접수했어요.");
  }

  async function retryAnalysis() {
    if (!retryFormData.current) return;
    await requestAnalysis(copyFormData(retryFormData.current));
  }

  function selectDocumentType(type: ClinicalDocumentType) {
    if (type === documentType) return;
    sessionStorage.removeItem(activeJobStorageKey);
    setActiveJobId(null);
    retryFormData.current = null;
    setDocumentType(type);
    setFile(null);
    setStatus("idle");
    setMessage("");
    setAnalysis(null);
    setDocumentId(null);
    setAnalysisRevision(1);
    setDraft(null);
    setRequiresPeriodReview(false);
    setDuplicateCandidates([]);
    setMedicationRegistration("draft");
    setRetryJob(null);
    setRetryable(false);
  }

  const handleDiagnosesSaved = useCallback((document: ClinicalDocument) => {
    if (document.analysis) setAnalysis(document.analysis);
    setAnalysisRevision(document.analysisRevision ?? 1);
  }, []);

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
                  disabled={pending}
                  onChange={() => selectDocumentType(type)}
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
            key={documentType}
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
          {pending && activeJobId ? (
            <button className="button button--secondary" type="button" onClick={cancelAnalysis}>
              <Square size={16} aria-hidden="true" /> 분석 취소
            </button>
          ) : null}
          {status === "error" && retryable ? (
            <button className="button button--secondary" type="button" onClick={retryAnalysis}>
              <RotateCcw size={17} aria-hidden="true" /> 같은 작업 다시 시도
            </button>
          ) : null}
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
            {documentType === "진단서"
              ? "비식별 샘플 진단서로 체험"
              : "비식별 샘플 처방전으로 체험"}
          </button>
        </>
      ) : null}

      {status !== "idle" ? (
        <p
          className={`analysis-status analysis-status--${status}`}
          role={status === "error" ? "alert" : "status"}
          aria-live={status === "error" ? "assertive" : "polite"}
          aria-atomic="true"
        >
          {message}
        </p>
      ) : null}

      {analysis ? (
        <div className="document-verification-layout">
          <figure className="document-verification-original">
            <figcaption>
              <strong>원본 {analysis.documentType}</strong>
              <span>{file?.name ?? "비식별 데모 문서"}</span>
            </figcaption>
            {previewUrl ? (
              <Image
                src={previewUrl}
                width={720}
                height={960}
                unoptimized
                alt={`대조할 원본 ${analysis.documentType}`}
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
            analysisRevision={analysisRevision}
            requiresPeriodReview={requiresPeriodReview}
            medicationRegistration={medicationRegistration}
            onDiagnosesSaved={handleDiagnosesSaved}
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
