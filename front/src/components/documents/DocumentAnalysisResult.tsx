import {
  BadgeCheck,
  BookOpenText,
  CircleHelp,
  ClipboardList,
  ExternalLink,
  SearchCheck,
  ShieldCheck,
  TriangleAlert,
  CalendarCheck2,
} from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { DiagnosisDraftReview } from "@/components/documents/DiagnosisDraftReview";
import { confirmDiagnosesAction } from "@/app/actions";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { supportedNutritionDiagnoses } from "@/lib/nutrition-presentation";
import type { ClinicalDocument, DocumentAnalysis } from "@care-atlas/backend";

const evidenceLabels = {
  productName: "제품명",
  ingredientName: "성분명",
  itemCode: "품목기준코드(이전 형식)",
  mfdsItemSeq: "품목기준코드",
  insuranceCode: "보험코드",
  doseAmount: "1회 복용량",
  frequency: "복용 횟수",
  timing: "복용 시점",
  startDate: "시작일",
  endDate: "종료일",
  supplyDays: "투약일수",
} as const;

export function DocumentAnalysisResult({
  analysis,
  documentId,
  analysisRevision = 1,
  requiresPeriodReview = false,
  medicationRegistration = "draft",
  onDiagnosesSaved,
}: {
  analysis: DocumentAnalysis;
  documentId?: string;
  analysisRevision?: number;
  requiresPeriodReview?: boolean;
  medicationRegistration?: "draft" | "pending" | "merged";
  onDiagnosesSaved?: (document: ClinicalDocument) => void;
}) {
  const analysisSource =
    analysis.source === "api"
      ? "외부 API 문서 분석"
      : analysis.source === "openai"
        ? "OpenAI 문서 분석"
        : "데모 분석 결과";
  const nutritionDiagnoses = supportedNutritionDiagnoses(analysis);
  const medicationsNeedingReview = analysis.medications?.filter(
    (medication) => medication.reviewStatus !== "verified",
  ).length ?? 0;
  const requiresMedicationVerification = medicationsNeedingReview > 0;

  return (
    <section className="analysis-result" aria-labelledby="analysis-result-title">
      <div className="analysis-result__header">
        <span className="analysis-result__icon" aria-hidden="true">
          <BadgeCheck size={22} />
        </span>
        <div>
          <Badge tone={analysis.source === "demo" ? "info" : "success"}>
            {analysisSource}
          </Badge>
          <h3 id="analysis-result-title">{analysis.documentType} 분석 결과</h3>
          <p>{analysis.summary}</p>
        </div>
      </div>

      <dl className="analysis-findings">
        {analysis.findings.map((finding) => (
          <div key={`${finding.label}-${finding.value}`}>
            <dt>{finding.label}</dt>
            <dd>{finding.value}</dd>
          </div>
        ))}
      </dl>

      {analysis.extraction?.status !== undefined && analysis.extraction.status !== "complete" ? (
        <div className="disease-lookup-status disease-lookup-status--failed" role="status">
          <TriangleAlert size={18} aria-hidden="true" />
          <p>
            <strong>{analysis.extraction.status === "failed" ? "자동 추출 결과 없음" : "일부 항목 확인 필요"}</strong>
            찾지 못한 값은 버리지 않고 검토 초안으로 남겼어요. 원본을 보며 수정하거나 직접 추가해주세요.
          </p>
        </div>
      ) : null}

      {analysis.documentType === "처방전" && analysis.medications?.length ? (
        <div
          className={`disease-lookup-status disease-lookup-status--${medicationRegistration === "pending" || requiresMedicationVerification ? "failed" : requiresPeriodReview ? "not_configured" : "official_match"}`}
          role="status"
        >
          {medicationRegistration === "pending" || requiresMedicationVerification || requiresPeriodReview
            ? <TriangleAlert size={18} aria-hidden="true" />
            : <CalendarCheck2 size={18} aria-hidden="true" />}
          <p>
            <strong>
              {medicationRegistration === "merged"
                ? "기존 복약과 병합됨"
                : medicationRegistration === "pending"
                  ? "중복 확인 필요"
                  : requiresMedicationVerification
                    ? "OCR·공식 정보 확인이 필요한 초안"
                    : requiresPeriodReview
                      ? "처방 기간 확인이 필요한 초안"
                      : "복약 후보 초안 생성"}
            </strong>
            {medicationRegistration === "merged"
              ? "기존 복약 계획을 유지하고 중복 일정과 알림은 만들지 않았어요."
              : medicationRegistration === "pending"
                ? "등록 방식을 선택하기 전에는 복약 초안·오늘 일정·알림을 만들지 않아요."
                : requiresMedicationVerification
                  ? `OCR 또는 공식 정보 대조가 필요한 약 ${medicationsNeedingReview}개는 원본과 모든 값을 대조한 기록이 있어야 활성화할 수 있어요.`
                  : requiresPeriodReview
                    ? "처방일과 총 투약일수를 원본에서 확인하고 확정하기 전에는 약을 활성화하지 않아요."
                    : `처방전에서 약 ${analysis.medications.length}개를 찾았어요. 아래에서 검토하고 확정하기 전에는 복약 일정에 반영되지 않아요.`}
          </p>
        </div>
      ) : null}

      {analysis.documentType === "처방전" && analysis.medications?.length ? (
        <section className="medication-evidence" aria-labelledby="medication-evidence-title">
          <div className="medication-evidence__heading">
            <h4 id="medication-evidence-title">약별 OCR 근거와 공식 정보 대조</h4>
            <p>원문의 같은 부분을 보면서 제품명·복용법을 확인해주세요.</p>
          </div>
          <div className="medication-evidence__list">
            {analysis.medications.map((medication, index) => (
              <article className="medication-evidence__item" key={`${medication.productName}-${index}`}>
                <header>
                  <div>
                    <span>약 {index + 1}</span>
                    <h5>{medication.productName}</h5>
                  </div>
                  <Badge tone={medication.reviewStatus === "verified" || medication.reviewStatus === "human_confirmed" ? "success" : "warning"}>
                    {medication.reviewStatus === "verified"
                      ? "공식 대조 완료"
                      : medication.reviewStatus === "human_confirmed"
                        ? "보호자 대조 완료"
                        : "확인 필요"}
                  </Badge>
                </header>
                <dl>
                  {(medication.fieldEvidence ?? []).map((evidence) => (
                    <div key={`${evidence.field}-${evidence.sourceText}`}>
                      <dt>{evidenceLabels[evidence.field]}</dt>
                      <dd>
                        <q>{evidence.sourceText}</q>
                        {evidence.confidence !== undefined || evidence.region ? (
                          <small>
                            {evidence.confidence !== undefined
                              ? `신뢰도 ${Math.round(evidence.confidence * 100)}%`
                              : "원문에서 추출"}
                            {evidence.region ? ` · ${evidence.region.page}쪽 위치 ${Math.round(evidence.region.x * 100)}, ${Math.round(evidence.region.y * 100)}%` : ""}
                          </small>
                        ) : null}
                      </dd>
                    </div>
                  ))}
                </dl>
                {medication.verification?.officialProductName ? (
                  <p className="medication-evidence__official">
                    식약처 {medication.verification.officialItemCode}: {medication.verification.officialProductName}
                    {medication.verification.officialIngredientName
                      ? ` · ${medication.verification.officialIngredientName}`
                      : ""}
                  </p>
                ) : null}
                {medication.verification?.warnings.length ? (
                  <ul className="medication-evidence__warnings">
                    {medication.verification.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="analysis-columns">
        <div>
          <h4>
            <ClipboardList size={18} aria-hidden="true" /> 보호자가 살펴볼 점
          </h4>
          <ul>
            {analysis.carePoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4>
            <CircleHelp size={18} aria-hidden="true" /> 상담 때 물어볼 점
          </h4>
          <ul>
            {analysis.questionsForProfessional.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      </div>

      {analysis.documentType === "진단서" && analysis.diseaseLookup ? (
        <div
          className={`disease-lookup-status disease-lookup-status--${analysis.diseaseLookup.status}`}
          role="status"
        >
          <SearchCheck size={18} aria-hidden="true" />
          <p>
            <strong>질병 정보 조회</strong>
            {analysis.diseaseLookup.message}
          </p>
        </div>
      ) : null}

      {analysis.documentType === "진단서" && documentId ? (
        <DiagnosisDraftReview
          documentId={documentId}
          analysisRevision={analysisRevision}
          diagnoses={analysis.diagnoses ?? []}
          onSaved={onDiagnosesSaved}
        />
      ) : null}

      {analysis.documentType === "진단서" && documentId && nutritionDiagnoses.length > 0 ? (
        <form action={confirmDiagnosesAction} className="diagnosis-confirmation">
          <input type="hidden" name="documentId" value={documentId} />
          <div>
            <strong>식사·영양 안내에 반영할까요?</strong>
            <p>
              {nutritionDiagnoses.map((diagnosis) => diagnosis.name).join(" · ")}을(를)
              의료진에게 확인받은 질환으로 저장해요. 원본과 비교한 뒤 확정해주세요.
            </p>
          </div>
          <SubmitButton pendingText="확정하는 중…">확정 질환으로 저장</SubmitButton>
        </form>
      ) : null}

      {analysis.diseaseInformation && analysis.diseaseInformation.length > 0 ? (
        <section className="disease-information" aria-labelledby="disease-information-title">
          <div className="disease-information__heading">
            <BookOpenText size={20} aria-hidden="true" />
            <div>
              <h4 id="disease-information-title">진단 관련 정보</h4>
              <p>진단서에서 찾은 질병명으로 조회한 참고 정보예요.</p>
            </div>
          </div>

          <div className="disease-information__list">
            {analysis.diseaseInformation.map((disease) => (
              <article
                className="disease-information__item"
                key={`${disease.query}-${disease.code ?? disease.matchedName}`}
              >
                <header>
                  <div>
                    <span className="disease-information__query">입력: {disease.query}</span>
                    <h5>
                      {disease.matchedName}
                      {disease.code ? <small>{disease.code}</small> : null}
                    </h5>
                  </div>
                  <Badge tone={disease.source === "official_api" ? "success" : "info"}>
                    {disease.sourceLabel}
                  </Badge>
                </header>

                <p className="disease-information__overview">{disease.overview}</p>

                {disease.practicalPoints.length > 0 ? (
                  <div className="disease-information__points">
                    <strong>확인할 점</strong>
                    <ul>
                      {disease.practicalPoints.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {disease.warningSigns.length > 0 ? (
                  <div className="disease-information__warning">
                    <TriangleAlert size={17} aria-hidden="true" />
                    <div>
                      <strong>빠른 상담이 필요한 신호</strong>
                      <ul>
                        {disease.warningSigns.map((sign) => (
                          <li key={sign}>{sign}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : null}

                {disease.references.length > 0 ? (
                  <div className="disease-information__references">
                    <strong>조회 출처</strong>
                    <ul>
                      {disease.references.map((reference) => (
                        <li key={reference.url}>
                          <a href={reference.url} target="_blank" rel="noreferrer noopener">
                            {reference.title}
                            <ExternalLink size={13} aria-hidden="true" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <p className="analysis-disclaimer">
        <ShieldCheck size={17} aria-hidden="true" />
        {analysis.disclaimer}
      </p>
    </section>
  );
}
