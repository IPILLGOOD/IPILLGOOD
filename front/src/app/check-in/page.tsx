import { HeartHandshake, ShieldCheck } from "lucide-react";

import { CheckInForm } from "@/components/check-in/CheckInForm";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  getCareSnapshot,
  getQuestionSetAvailability,
} from "@care-atlas/backend";
import { createMedicationSchedule } from "@/lib/presentation";
import { requireCareScope } from "@/lib/auth/care-scope";

export const dynamic = "force-dynamic";

export default async function CheckInPage() {
  const scope = await requireCareScope();
  const snapshot = await getCareSnapshot(scope);
  const questions = await getQuestionSetAvailability({
    scope,
    answerer: "caregiver",
    snapshot,
  });
  const tasks = createMedicationSchedule(snapshot.medications, snapshot.doseEvents);

  return (
    <>
      <PageHeader
        eyebrow="오늘의 안부 확인"
        title="약은 잘 챙기셨나요?"
        description="하루를 마무리하며 다음의 내용을 기입해주세요. 모르거나 확인하지 못한 내용도 그대로 답할 수 있어요."
      />
      <div className="checkin-layout">
        <Card>
          <CheckInForm tasks={tasks} questionSet={questions.status === "ready" ? questions.questionSet : null} />
        </Card>
        <aside className="checkin-aside">
          <Card tone="accent">
            <HeartHandshake size={25} aria-hidden="true" />
            <h2>정답을 맞히는 질문이 아니에요</h2>
            <ul>
              <li>확실하지 않으면 “확인하지 못했어요”를 선택하세요.</li>
              <li>먹지 못한 기록이 처방 계획을 자동으로 바꾸지는 않아요.</li>
              <li>증상은 약 때문이라고 단정하지 않고 상담 준비에만 사용해요.</li>
            </ul>
          </Card>
          <Card tone="soft" className="aside-note">
            <ShieldCheck size={21} aria-hidden="true" />
            <p>
              숨쉬기 매우 어렵거나 의식을 잃는 등 급격한 증상이 있다면 앱 입력보다 119 또는
              즉시 이용 가능한 응급의료 도움을 먼저 요청하세요.
            </p>
          </Card>
        </aside>
      </div>
    </>
  );
}
