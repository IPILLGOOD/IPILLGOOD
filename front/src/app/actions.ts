"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  buildPatientQuestionResponse,
  CareConflictError,
  confirmDocumentDiagnoses,
  createCareConnectionCode,
  dateKeyInSeoul,
  deactivatePushSubscriptionsForUser,
  deleteDocumentAndSyncMedicationReminders,
  disconnectCareConnection,
  getCareSnapshot,
  getPatientQuestionSet,
  getQuestionSetAvailability,
  isServiceCareProfileComplete,
  saveDailyCheckIn,
  updateRecipientProfile,
  type ActionState,
  type QuestionSetAvailability,
} from "@care-atlas/backend";

import { createMedicationSchedule } from "@/lib/presentation";
import { getSession } from "@/lib/auth/session";
import { careScopeFor } from "@/lib/auth/care-scope";
import { enforceRateLimit } from "@/lib/rate-limit";
import type { CheckInActionState } from "@/lib/check-in-recovery";
import {
  buildRecipientProfile,
  collectCompleteDoseResponses,
  profileSchema,
} from "@/lib/form-validation";

async function demoWriteGuard(): Promise<ActionState | null> {
  const session = await getSession();
  if (!session) {
    return {
      status: "error",
      message: "로그인 정보가 만료되었어요. 다시 로그인해주세요.",
    };
  }
  if (session.provider === "google" || session.provider === "connected" || process.env.IPILLGOOD_DEMO_MODE === "true") return null;
  return {
    status: "error",
    message: "현재는 읽기 전용 모드예요. 인증을 연결한 뒤 저장 기능을 활성화해주세요.",
  };
}

async function completedProfileGuard(scope: { recipientId: string; useDemoData?: boolean }): Promise<ActionState | null> {
  if (scope.useDemoData || await isServiceCareProfileComplete(scope.recipientId)) return null;
  return {
    status: "error",
    message: "돌봄 대상자 정보와 건강정보 처리 동의를 먼저 확인해주세요.",
  };
}

export type ConnectionActionState = ActionState & { code?: string; expiresAt?: string };

export async function createConnectionCodeAction(
  _previousState: ConnectionActionState,
  _formData: FormData,
): Promise<ConnectionActionState> {
  void _previousState;
  void _formData;
  const session = await getSession();
  if (!session || session.provider !== "google") {
    return { status: "error", message: "Google 계정 소유자만 연결 코드를 만들 수 있어요." };
  }
  try {
    const profileGuard = await completedProfileGuard(careScopeFor(session));
    if (profileGuard) return profileGuard;
    const rate = await enforceRateLimit("auth", { userId: session.id });
    if (!rate.allowed) return { status: "error", message: `${rate.retryAfterSeconds}초 뒤 다시 시도해주세요.` };
    const result = await createCareConnectionCode(session.id, { ownerDisplayName: session.name });
    revalidatePath("/profile");
    return { status: "success", message: "10분 동안 사용할 수 있는 연결 코드를 만들었어요.", ...result };
  } catch (error) {
    if (error instanceof Error && error.message === "CARE_CONNECTION_ALREADY_ACTIVE") {
      return { status: "error", message: "이미 연결된 사용자가 있어요. 먼저 기존 연결을 해제해주세요." };
    }
    console.error(error);
    return { status: "error", message: "연결 코드를 만들지 못했어요. 잠시 후 다시 시도해주세요." };
  }
}

export async function disconnectConnectionAction(
  _previousState: ConnectionActionState,
  _formData: FormData,
): Promise<ConnectionActionState> {
  void _previousState;
  void _formData;
  const session = await getSession();
  if (!session || session.provider !== "google") {
    return { status: "error", message: "Google 계정 소유자만 연결을 해제할 수 있어요." };
  }
  try {
    const connection = await disconnectCareConnection(session.id);
    if (connection) {
      await deactivatePushSubscriptionsForUser({
        userId: connection.connectedUserId,
        recipientId: connection.recipientId,
      });
    }
    revalidatePath("/profile");
    return { status: "success", message: "연결 사용자와 기기 권한을 해제했어요." };
  } catch (error) {
    console.error(error);
    return { status: "error", message: "연결을 해제하지 못했어요. 잠시 후 다시 시도해주세요." };
  }
}

export async function deleteDocumentAction(formData: FormData): Promise<void> {
  const guard = await demoWriteGuard();
  if (guard) throw new Error(guard.message);

  const documentId = formData.get("documentId");
  if (typeof documentId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(documentId)) {
    throw new Error("삭제할 문서를 확인하지 못했어요.");
  }

  try {
    const session = await getSession();
    if (!session) throw new Error("로그인 정보가 만료되었어요.");
    const scope = careScopeFor(session);
    const profileGuard = await completedProfileGuard(scope);
    if (profileGuard) throw new Error(profileGuard.message);
    const snapshot = await getCareSnapshot(scope);
    await deleteDocumentAndSyncMedicationReminders(scope, documentId, snapshot);
    revalidatePath("/documents");
    revalidatePath("/dashboard");
  } catch (error) {
    console.error(error);
    throw new Error("문서를 삭제하지 못했어요. 잠시 후 다시 시도해주세요.");
  }
}

export async function saveProfileAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await demoWriteGuard();
  if (guard) return guard;
  const result = profileSchema.safeParse({
    ...Object.fromEntries(formData),
    confirmedConditionIds: formData.getAll("confirmedConditionIds"),
  });
  const expectedRevision = Number(formData.get("expectedRevision"));
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    return { status: "error", message: "최신 프로필을 다시 불러와주세요.", conflict: true };
  }
  if (!result.success) {
    return {
      status: "error",
      message: "입력한 내용을 다시 확인해주세요.",
      fieldErrors: result.error.flatten().fieldErrors,
    };
  }

  try {
    const session = await getSession();
    if (!session) return { status: "error", message: "로그인 정보가 만료되었어요." };
    const scope = careScopeFor(session);
    const current = await getCareSnapshot(scope);
    await updateRecipientProfile(
      scope,
      {
        ...buildRecipientProfile(current.recipient, result.data),
        id: scope.recipientId,
      },
      current,
      expectedRevision,
    );
    revalidatePath("/today");
    revalidatePath("/dashboard");
    revalidatePath("/profile");
    revalidatePath("/nutrition");
    return { status: "success", message: "어르신 프로필을 업데이트했어요." };
  } catch (error) {
    if (error instanceof CareConflictError) {
      return { status: "error", conflict: true, message: "다른 기기에서 먼저 변경했어요. 최신 내용을 확인한 후 다시 저장해주세요." };
    }
    console.error(error);
    return {
      status: "error",
      message: "프로필을 저장하지 못했어요. 잠시 후 다시 시도해주세요.",
    };
  }
}

export async function confirmDiagnosesAction(formData: FormData): Promise<void> {
  const guard = await demoWriteGuard();
  if (guard) throw new Error(guard.message);
  const documentId = formData.get("documentId");
  if (typeof documentId !== "string" || !/^[^/]{1,256}$/.test(documentId)) {
    throw new Error("확인할 진단서를 찾지 못했어요.");
  }
  const session = await getSession();
  if (!session) throw new Error("로그인 정보가 만료되었어요.");
  const scope = careScopeFor(session);
  const profileGuard = await completedProfileGuard(scope);
  if (profileGuard) throw new Error(profileGuard.message);
  await confirmDocumentDiagnoses(scope, documentId);
  revalidatePath("/dashboard");
  revalidatePath("/documents");
  revalidatePath("/nutrition");
  revalidatePath("/profile");
  redirect("/nutrition");
}

export async function saveCheckInAction(
  _previousState: CheckInActionState,
  formData: FormData,
): Promise<CheckInActionState> {
  try {
    const guard = await demoWriteGuard();
    if (guard) return guard;
    const answeredBy = formData.get("answeredBy");
    if (answeredBy !== "caregiver" && answeredBy !== "recipient") {
      return { status: "error", message: "누가 답했는지 선택해주세요." };
    }

    const session = await getSession();
    if (!session) return { status: "error", message: "로그인 정보가 만료되었어요." };
    const rateLimit = await enforceRateLimit("checkIn", { userId: session.id });
    if (!rateLimit.allowed) {
      return {
        status: "error",
        message: `요청이 너무 많아요. ${rateLimit.retryAfterSeconds}초 뒤 다시 시도해주세요.`,
      };
    }
    const scope = careScopeFor(session);
    const profileGuard = await completedProfileGuard(scope);
    if (profileGuard) return profileGuard;
    const snapshot = await getCareSnapshot(scope);
    const expectedRevision = Number(formData.get("expectedRevision"));
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      return { status: "error", conflict: true, message: "최신 기록을 다시 불러와주세요." };
    }
    const schedule = new Map(
      createMedicationSchedule(snapshot.medications, snapshot.doseEvents).map((task) => [
        task.id,
        task,
      ]),
    );

    const { responses, missingTaskIds } = collectCompleteDoseResponses(formData, schedule);
    if (missingTaskIds.length > 0) {
      return { status: "error", message: "각 복용 일정의 복용 여부를 모두 확인해주세요." };
    }

    const symptoms = formData
      .getAll("symptoms")
      .filter((value): value is string => typeof value === "string");
    const severity = Number(formData.get("severity") ?? 0);
    const note = String(formData.get("note") ?? "").trim();
    const questionSetId = String(formData.get("questionSetId") ?? "").trim();
    if (!/^question-set-[a-zA-Z0-9-]{10,100}$/.test(questionSetId)) {
      return { status: "error", message: "오늘의 맞춤 질문을 다시 불러와주세요." };
    }

    const questionSet = await getPatientQuestionSet(scope, questionSetId);
    if (
      !questionSet ||
      questionSet.subject_ref !== scope.recipientId ||
      questionSet.target_date !== dateKeyInSeoul()
    ) {
      return { status: "error", recoverQuestions: true, message: "오늘의 맞춤 질문을 다시 확인해야 해요. 입력은 유지돼요." };
    }
    const questionResponse = buildPatientQuestionResponse({
      questionSet,
      answeredBy,
      responseId:
        snapshot.todayCheckIn?.questionSetId === questionSetId
          ? snapshot.todayCheckIn.questionResponseId
          : undefined,
      answers: Object.fromEntries(
        questionSet.questions.map((question) => [
          question.question_id,
          formData.get(`question_${question.question_id}`) as string | null,
        ]),
      ),
    });
    await saveDailyCheckIn(
      scope,
      {
        doseResponses: responses,
        symptoms,
        severity: symptoms.length > 0 ? Math.min(Math.max(severity, 1), 10) : 0,
        note,
        answeredBy,
        questionResponse,
      },
      snapshot,
      expectedRevision,
    );
    revalidatePath("/today");
    revalidatePath("/dashboard");
    revalidatePath("/check-in");
    revalidatePath("/report");
    return {
      status: "success",
      message:
        formData.get("checkInScope") === "wellbeing"
          ? "오늘의 몸 상태를 기록했어요."
          : "오늘의 복약과 몸 상태를 기록했어요.",
    };
  } catch (error) {
    if (error instanceof CareConflictError) {
      return { status: "error", conflict: true, message: "다른 기기에서 먼저 변경했어요. 최신 내용을 확인한 후 다시 저장해주세요." };
    }
    console.error(error);
    return {
      status: "error",
      message: "기록을 저장하지 못했어요. 잠시 후 다시 시도해주세요.",
    };
  }
}

export async function recoverCheckInQuestions(): Promise<QuestionSetAvailability> {
  try {
    const guard = await demoWriteGuard();
    if (guard) return { status: "unavailable", message: guard.message };
    const session = await getSession();
    if (!session) return { status: "unavailable", message: "다시 로그인한 뒤 시도해 주세요." };
    const limit = await enforceRateLimit("checkIn", { userId: session.id });
    if (!limit.allowed) return { status: "unavailable", message: `${limit.retryAfterSeconds}초 뒤 다시 시도해 주세요.` };
    const scope = careScopeFor(session);
    const profileGuard = await completedProfileGuard(scope);
    if (profileGuard) return { status: "unavailable", message: profileGuard.message };
    return await getQuestionSetAvailability({ scope, answerer: "caregiver" });
  } catch {
    return { status: "unavailable", message: "질문을 불러오지 못했어요. 잠시 후 다시 시도해 주세요." };
  }
}
