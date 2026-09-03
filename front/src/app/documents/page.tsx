import { FileCheck2, FileClock, FileText, ShieldCheck } from "lucide-react";

import { DocumentUploadForm } from "@/components/documents/DocumentUploadForm";
import { DiagnosisDraftReview } from "@/components/documents/DiagnosisDraftReview";
import { MedicationDraftReview } from "@/components/documents/MedicationDraftReview";
import { DeleteDocumentButton } from "@/components/documents/DeleteDocumentButton";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCareSnapshot, getMedicationPlanDrafts } from "@care-atlas/backend";
import { formatDate } from "@/lib/presentation";
import { requireCareScope } from "@/lib/auth/care-scope";
import { confirmDiagnosesAction } from "@/app/actions";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { supportedNutritionDiagnoses } from "@/lib/nutrition-presentation";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const scope = await requireCareScope();
  const snapshot = await getCareSnapshot(scope);
  const reviewDocuments = snapshot.documents.filter((document) => document.medicationDraftId && document.status === "needs_review");
  const draftsById = await getMedicationPlanDrafts(scope, reviewDocuments.map((document) => document.medicationDraftId!));
  const drafts = new Map(reviewDocuments.map((document) => {
    const draft = draftsById.get(document.medicationDraftId!);
    return draft && (draft.state === "draft" || draft.state === "needs_review")
      ? [document.id, draft] as const
      : null;
  }).filter((entry) => entry !== null));
  return (
    <>
      <PageHeader
        eyebrow="문서 등록"
        title="처방전과 진단서를 쉬운 말로 확인해요"
        description="문서를 첨부하면 중요한 내용을 정리하고, 진단서는 공식 질병 API를 우선 조회한 뒤 필요할 때 OpenAI 웹 검색으로 보완해요."
      />

      <div className="document-layout">
        <Card>
          <div className="section-heading">
            <div>
              <h2>새 문서 등록</h2>
              <p>처방전 또는 진단서를 선택하고 분석 결과를 바로 확인하세요.</p>
            </div>
          </div>
          <DocumentUploadForm allowSamples={scope.useDemoData === true} />
        </Card>

        <div className="document-aside-stack">
          <Card>
            <div className="section-heading">
              <div>
                <h2>등록된 문서</h2>
                <p>최근 문서부터 보여드려요.</p>
              </div>
              <FileText size={21} color="var(--color-primary-700)" aria-hidden="true" />
            </div>
            {snapshot.documents.length > 0 ? (
              <ul className="document-list">
                {snapshot.documents.map((document) => {
                  const confirmed = document.status === "confirmed";
                  const needsReview = document.status === "needs_review";
                  const Icon = confirmed ? FileCheck2 : FileClock;
                  const draft = drafts.get(document.id);
                  return (
                    <li className="document-item" key={document.id}>
                      <span className="document-item__icon" aria-hidden="true">
                        <Icon size={19} />
                      </span>
                      <div>
                        <strong>{document.fileName}</strong>
                        <small>
                          {document.documentType} · {formatDate(document.uploadedAt)} ·{" "}
                          {document.sourceLabel}
                        </small>
                      </div>
                      <Badge tone={confirmed ? "success" : "warning"}>
                        {confirmed ? "분석 완료" : draft ? "복약 검토 필요" : needsReview ? "기간 확인 필요" : "분석 대기"}
                      </Badge>
                      <DeleteDocumentButton
                        documentId={document.id}
                        fileName={document.fileName}
                      />
                      {document.analysis ? (
                        <details className="saved-analysis">
                          <summary>분석 결과 보기</summary>
                          <p>{document.analysis.summary}</p>
                          {document.analysis.diseaseLookup ? (
                            <p className="saved-analysis__lookup">
                              질병 정보 조회: {document.analysis.diseaseLookup.message}
                            </p>
                          ) : null}
                          <dl>
                            {document.analysis.findings.map((finding) => (
                              <div key={`${finding.label}-${finding.value}`}>
                                <dt>{finding.label}</dt>
                                <dd>{finding.value}</dd>
                              </div>
                            ))}
                          </dl>
                          {document.documentType === "진단서" ? (
                            <DiagnosisDraftReview
                              key={`${document.id}-${document.analysisRevision ?? 1}`}
                              documentId={document.id}
                              analysisRevision={document.analysisRevision ?? 1}
                              diagnoses={document.analysis.diagnoses ?? []}
                            />
                          ) : null}
                          {document.documentType === "진단서" &&
                          supportedNutritionDiagnoses(document.analysis).some((diagnosis) =>
                            !snapshot.recipient.confirmedConditions?.some((condition) =>
                              condition.sourceDocumentId === document.id &&
                              (condition.code === diagnosis.code || condition.standardName === diagnosis.name),
                            ),
                          ) ? (
                            <form action={confirmDiagnosesAction} className="saved-analysis__confirm">
                              <input type="hidden" name="documentId" value={document.id} />
                              <SubmitButton pendingText="확정하는 중…">확정 질환으로 저장</SubmitButton>
                            </form>
                          ) : null}
                        </details>
                      ) : null}
                      {draft ? (
                        <details className="saved-analysis saved-medication-draft">
                          <summary>복약 초안 이어서 검토</summary>
                          <MedicationDraftReview draft={draft} />
                        </details>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="empty-state" role="status">
                <FileText size={26} aria-hidden="true" />
                <strong>아직 등록한 문서가 없어요</strong>
                <p>
                  {scope.useDemoData
                    ? "비식별 샘플로 안전하게 흐름을 체험할 수 있어요."
                    : "처방전이나 진단서를 첨부하고 분석해보세요."}
                </p>
              </div>
            )}
          </Card>

          <Card tone="accent" className="privacy-note">
            <ShieldCheck size={23} aria-hidden="true" />
            <div>
              <h2>보호자 권한과 동의가 먼저예요</h2>
              <p>
                가족이라는 이유만으로 자동 열람 권한이 생기지는 않아요. 어르신의 동의 또는
                적법한 대리 권한이 있는 정보만 등록해주세요.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
