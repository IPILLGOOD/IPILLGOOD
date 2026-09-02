import { CheckInForm } from "@/components/check-in/CheckInForm";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  getCareSnapshot,
  getPatientQuestionResponse,
  getPatientQuestionSet,
  getQuestionSetAvailability,
} from "@care-atlas/backend";
import { createMedicationSchedule } from "@/lib/presentation";
import { requireCareScope } from "@/lib/auth/care-scope";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

export default async function CheckInPage() {
  const scope = await requireCareScope();
  const snapshot = await getCareSnapshot(scope);
  const savedQuestionSet = snapshot.todayCheckIn?.questionSetId
    ? await getPatientQuestionSet(scope, snapshot.todayCheckIn.questionSetId)
    : null;
  const questions = savedQuestionSet
    ? { status: "ready" as const, questionSet: savedQuestionSet }
    : await getQuestionSetAvailability({
        scope,
        answerer: "caregiver",
        snapshot,
      });
  const savedQuestionResponse = snapshot.todayCheckIn?.questionResponseId
    ? await getPatientQuestionResponse(scope, snapshot.todayCheckIn.questionResponseId)
    : null;
  const tasks = createMedicationSchedule(snapshot.medications, snapshot.doseEvents);

  return (
    <>
      <PageHeader
        eyebrow="오늘의 안부 확인"
        title="약은 잘 챙기셨나요?"
        description="하루를 마무리하며 복용 여부와 몸 상태를 기록해주세요. 정답을 맞히는 질문이 아니므로, 확실하지 않은 내용은 ‘확인하지 못했어요’로 남겨도 괜찮아요."
      />
      <div className="checkin-layout checkin-layout--single">
        <Card>
          <CheckInForm
            tasks={tasks}
            questionSet={questions.status === "ready" ? questions.questionSet : null}
            initialCheckIn={snapshot.todayCheckIn ?? null}
            initialQuestionResponse={savedQuestionResponse}
            revision={snapshot.revision}
            observationIdempotencyKey={randomUUID()}
          />
        </Card>
      </div>
    </>
  );
}
