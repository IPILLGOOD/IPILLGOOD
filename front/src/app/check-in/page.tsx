import { ArrowRight, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { CheckInForm } from "@/components/check-in/CheckInForm";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  getCareSnapshot,
  getPatientQuestionResponse,
  getPatientQuestionSet,
  getQuestionSetAvailability,
} from "@care-atlas/backend";
import { requireCareScope } from "@/lib/auth/care-scope";
import { uniqueSymptomDays } from "@/lib/presentation";
import { recentCareRecords } from "@/lib/recent-care-records";
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
    ? await getPatientQuestionResponse(
        scope,
        snapshot.todayCheckIn.questionResponseId,
      )
    : null;
  const recent = recentCareRecords(snapshot);
  const dizzinessDays = uniqueSymptomDays(
    recent.symptomEvents.filter((event) => event.symptomType === "어지러움"),
  );
  return (
    <>
      <PageHeader
        eyebrow="오늘의 안부 확인"
        title="오늘 몸 상태는 어떠셨나요?"
        description="오늘의 증상을 잊기 전에 남겨주세요. 정답을 맞히는 질문이 아니에요."
      />
      <div className="checkin-layout checkin-layout--single">
        {dizzinessDays >= 3 ? (
          <Card tone="warning" className="signal-card checkin-signal-card">
            <div className="signal-card__headline">
              <TriangleAlert size={22} aria-hidden="true" />
              <div>
                <Badge tone="warning">함께 확인하기</Badge>
                <h2>어지러움이 {dizzinessDays}일 기록됐어요</h2>
              </div>
            </div>
            <p>
              기록이 반복되고 있지만, 약 때문이라고 판단할 수는 없어요. 기록을 보여주며
              의료진이나 약사에게 확인해보세요.
            </p>
            <Link className="button button--secondary" href="/report">
              상담용 기록 보기 <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </Card>
        ) : null}
        <Card>
          <CheckInForm
            questionSet={
              questions.status === "ready" ? questions.questionSet : null
            }
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
