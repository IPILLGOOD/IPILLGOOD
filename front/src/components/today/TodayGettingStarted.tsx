import { ArrowRight, CheckCircle2 } from "lucide-react";
import Link from "next/link";

import { Card } from "@/components/ui/Card";
import type { GettingStartedGuide } from "@/lib/getting-started";

export function TodayGettingStarted({ guide }: { guide: GettingStartedGuide }) {
  return (
    <Card className="getting-started" aria-labelledby="getting-started-title">
      <div className="section-heading">
        <div>
          <h2 id="getting-started-title">돌봄 기록을 시작해 볼까요</h2>
          <p>아직 등록된 문서와 복약·몸 상태 기록이 없어요. 아래 순서로 차근차근 시작해 주세요.</p>
        </div>
      </div>
      <ol className="getting-started__steps" aria-label="돌봄 기록 시작 순서">
        <li aria-current={!guide.consentConfirmed ? "step" : undefined}>
          <span className="getting-started__number" aria-hidden="true">
            {guide.consentConfirmed ? <CheckCircle2 size={22} /> : "1"}
          </span>
          <div>
            <h3>프로필과 동의 확인</h3>
            <p>{guide.consentConfirmed
              ? "건강정보 처리 동의가 저장되어 있어요. 대상자 정보는 프로필에서 다시 확인할 수 있어요."
              : "돌봄 대상자의 정보를 확인하고 건강정보 처리 안내를 읽어 주세요."}</p>
          </div>
        </li>
        <li aria-current={guide.consentConfirmed ? "step" : undefined}>
          <span className="getting-started__number" aria-hidden="true">2</span>
          <div>
            <h3>처방전·진단서 등록</h3>
            <p>준비된 문서가 있을 때 올려 주세요. 문서 등록은 필수가 아니에요.</p>
          </div>
        </li>
        <li>
          <span className="getting-started__number" aria-hidden="true">3</span>
          <div>
            <h3>분석 결과와 원문 비교</h3>
            <p>분석 후 약 이름·복용량·횟수를 원문과 꼭 비교해 주세요. 불명확한 내용은 의사·약사에게 확인해 주세요.</p>
          </div>
        </li>
      </ol>
      <div className="getting-started__actions">
        <Link className="button button--primary" href={guide.nextHref}>
          {guide.nextLabel} <ArrowRight size={18} aria-hidden="true" />
        </Link>
        {guide.consentConfirmed ? (
          <>
            <Link className="button button--quiet" href="/profile">프로필 다시 확인</Link>
            <Link className="button button--quiet" href="/check-in">문서 없이 몸 상태 기록하기</Link>
          </>
        ) : null}
      </div>
    </Card>
  );
}
