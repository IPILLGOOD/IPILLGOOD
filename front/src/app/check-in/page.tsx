import { CheckInForm } from "@/components/check-in/CheckInForm";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  getCareSnapshot,
  getPatientQuestionResponse,
  getPatientQuestionSet,
  getQuestionSetAvailability,
} from "@care-atlas/backend";
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
  return (
    <>
      <PageHeader
        eyebrow="오늘의 안부 확인"
        title="오늘 몸 상태는 어떠셨나요?"
        description="최근 기록을 바탕으로 고른 질문에 답하며 오늘의 변화를 남겨주세요. 정답을 맞히는 질문이 아니에요."
      />
      <div className="checkin-layout checkin-layout--single">
        <Card>
          <CheckInForm
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
