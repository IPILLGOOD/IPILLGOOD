import { FileCheck2, FileClock, FileText, ShieldCheck } from "lucide-react";

import { DocumentUploadForm } from "@/components/documents/DocumentUploadForm";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ConnectionStatus } from "@/components/ui/ConnectionStatus";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCareSnapshot } from "@care-atlas/backend";
import { formatDate } from "@/lib/presentation";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const snapshot = await getCareSnapshot();
  return (
    <>
      <PageHeader
        eyebrow="문서 등록"
        title="처방전의 어려운 내용을 쉽게 정리해요"
        description="문서를 올린 뒤 보호자가 추출 결과를 원본과 확인하는 안전한 흐름을 준비했습니다."
        action={<ConnectionStatus source={snapshot.dataSource} />}
      />

      <div className="document-layout">
        <Card>
          <div className="section-heading">
            <div>
              <h2>새 문서 등록</h2>
              <p>실제 환자 정보 대신 비식별 샘플 사용을 권장해요.</p>
            </div>
          </div>
          <DocumentUploadForm />
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
                  const Icon = confirmed ? FileCheck2 : FileClock;
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
                        {confirmed ? "확인 완료" : "AI 연결 대기"}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="empty-state" role="status">
                <FileText size={26} aria-hidden="true" />
                <strong>아직 등록한 문서가 없어요</strong>
                <p>비식별 샘플로 안전하게 흐름을 체험할 수 있어요.</p>
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
