"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  addMedicationPlan,
  updateMedicationExplanation,
  simplifyOfficialMedicationSearchItemsWithOpenAI,
  verifyOfficialMedicationCode,
  withCareAccountProcessing,
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
  saveDoseResponse,
  saveWellbeingCheckIn,
  updateRecipientProfile,
  type ActionState,
  type QuestionSetAvailability,
} from "@care-atlas/backend";

import { createMedicationSchedule } from "@/lib/presentation";
import { getSession } from "@/lib/auth/session";
import { careScopeFor } from "@/lib/auth/care-scope";
import { enforceRateLimit } from "@/lib/rate-limit";
import type { CheckInActionState } from "@/lib/check-in-recovery";
import { parseMedicationRegistrationSelection } from "@/lib/medication-registration-options";
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
  if (
    session.provider === "google" ||
    session.provider === "connected" ||
    process.env.IPILLGOOD_DEMO_MODE === "true"
  )
    return null;
  return {
    status: "error",
    message:
      "현재는 읽기 전용 모드예요. 인증을 연결한 뒤 저장 기능을 활성화해주세요.",
  };
}

export async function saveDoseResponseAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const guard = await demoWriteGuard();
    if (guard) return guard;
    const eventId = String(formData.get("eventId") ?? "");
    const medicationPlanId = String(formData.get("medicationPlanId") ?? "");
    const scheduledAt = String(formData.get("scheduledAt") ?? "");
    const response = String(formData.get("response") ?? "");
    const reportSource = String(formData.get("reportSource") ?? "");
    const expectedRevision = Number(formData.get("expectedRevision"));
    if (!/^[^/]{1,256}$/.test(eventId))
      return { status: "error", message: "복약 일정을 다시 선택해주세요." };
    if (
      !["completed", "partial", "skipped", "not_yet", "unconfirmed"].includes(
        response,
      )
    ) {
      return { status: "error", message: "복용 여부를 선택해주세요." };
    }
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      return {
        status: "error",
        conflict: true,
        message: "최신 기록을 다시 불러와주세요.",
      };
    }
    const source = {
      caregiver: {
        actorRole: "caregiver" as const,
        evidenceLevel: "caregiver_observed" as const,
      },
      recipient: {
        actorRole: "recipient" as const,
        evidenceLevel: "self_reported" as const,
      },
      unconfirmed: {
        actorRole: "caregiver" as const,
        evidenceLevel: "unconfirmed" as const,
      },
    }[reportSource];
    if (!source)
      return { status: "error", message: "누가 확인했는지 선택해주세요." };

    const session = await getSession();
    if (!session)
      return { status: "error", message: "로그인 정보가 만료되었어요." };
    const scope = careScopeFor(session);
    const profileGuard = await completedProfileGuard(scope);
    if (profileGuard) return profileGuard;
    const snapshot = await getCareSnapshot(scope);
    const event =
      snapshot.doseEvents.find((item) => item.id === eventId) ??
      snapshot.doseEvents.find(
        (item) =>
          item.medicationPlanId === medicationPlanId &&
          item.scheduledAt === scheduledAt,
      );
    const occurrenceDate = new Date(scheduledAt);
    const todayTask = Number.isNaN(occurrenceDate.getTime())
      ? undefined
      : createMedicationSchedule(
          snapshot.medications,
          snapshot.doseEvents,
          occurrenceDate,
        ).find(
          (task) =>
            task.medicationPlanId === medicationPlanId &&
            task.scheduledAt === scheduledAt,
        );
    const occurrence = event ?? todayTask;
    if (
      !occurrence ||
      dateKeyInSeoul(occurrence.scheduledAt) > dateKeyInSeoul()
    ) {
      return {
        status: "error",
        message: "오늘 또는 지난 복약 일정만 응답할 수 있어요.",
      };
    }

    await saveDoseResponse(
      scope,
      {
        doseResponse: {
          medicationPlanId: occurrence.medicationPlanId,
          scheduledAt: occurrence.scheduledAt,
          response: response as
            | "completed"
            | "partial"
            | "skipped"
            | "not_yet"
            | "unconfirmed",
        },
        actorId: `${session.provider}:${session.id}`,
        ...source,
        idempotencyKey: `dashboard-${randomUUID()}`,
        correctionReason: "대시보드에서 복약 기록을 다시 확인해 수정함",
      },
      snapshot,
      expectedRevision,
    );
    revalidatePath("/dashboard");
    revalidatePath("/report");
    return { status: "success", message: "복약 기록을 수정했어요." };
  } catch (error) {
    if (error instanceof CareConflictError) {
      return {
        status: "error",
        conflict: true,
        message:
          "다른 기기에서 먼저 변경했어요. 새로고침 후 다시 시도해주세요.",
      };
    }
    console.error(error);
    return {
      status: "error",
      message: "복약 기록을 수정하지 못했어요. 잠시 후 다시 시도해주세요.",
    };
  }
}

async function completedProfileGuard(scope: {
  recipientId: string;
  useDemoData?: boolean;
}): Promise<ActionState | null> {
  if (
    scope.useDemoData ||
    (await isServiceCareProfileComplete(scope.recipientId))
  )
    return null;
  return {
    status: "error",
    message: "돌봄 대상자 정보와 건강정보 처리 동의를 먼저 확인해주세요.",
  };
}

export type ConnectionActionState = ActionState & {
  code?: string;
  expiresAt?: string;
};

export async function createConnectionCodeAction(
  _previousState: ConnectionActionState,
  _formData: FormData,
): Promise<ConnectionActionState> {
  void _previousState;
  void _formData;
  const session = await getSession();
  if (!session || session.provider !== "google") {
    return {
      status: "error",
      message: "Google 계정 소유자만 연결 코드를 만들 수 있어요.",
    };
  }
  try {
    const profileGuard = await completedProfileGuard(careScopeFor(session));
    if (profileGuard) return profileGuard;
    const rate = await enforceRateLimit("auth", { userId: session.id });
    if (!rate.allowed)
      return {
        status: "error",
        message: `${rate.retryAfterSeconds}초 뒤 다시 시도해주세요.`,
      };
    const result = await createCareConnectionCode(session.id, {
      ownerDisplayName: session.name,
    });
    revalidatePath("/profile");
    return {
      status: "success",
      message: "10분 동안 사용할 수 있는 연결 코드를 만들었어요.",
      ...result,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "CARE_CONNECTION_ALREADY_ACTIVE"
    ) {
      return {
        status: "error",
        message: "이미 연결된 사용자가 있어요. 먼저 기존 연결을 해제해주세요.",
      };
    }
    console.error(error);
    return {
      status: "error",
      message: "연결 코드를 만들지 못했어요. 잠시 후 다시 시도해주세요.",
    };
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
    return {
      status: "error",
      message: "Google 계정 소유자만 연결을 해제할 수 있어요.",
    };
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
    return {
      status: "success",
      message: "연결 사용자와 기기 권한을 해제했어요.",
    };
  } catch (error) {
    console.error(error);
    return {
      status: "error",
      message: "연결을 해제하지 못했어요. 잠시 후 다시 시도해주세요.",
    };
  }
}

export async function deleteDocumentAction(formData: FormData): Promise<void> {
  const guard = await demoWriteGuard();
  if (guard) throw new Error(guard.message);

  const documentId = formData.get("documentId");
  if (
    typeof documentId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(documentId)
  ) {
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
    confirmedConditions: formData.get("confirmedConditions"),
  });
  const expectedRevision = Number(formData.get("expectedRevision"));
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    return {
      status: "error",
      message: "최신 프로필을 다시 불러와주세요.",
      conflict: true,
    };
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
    if (!session)
      return { status: "error", message: "로그인 정보가 만료되었어요." };
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
    return { status: "success", message: "이용자 프로필을 업데이트했어요." };
  } catch (error) {
    if (error instanceof CareConflictError) {
      return {
        status: "error",
        conflict: true,
        message:
          "다른 기기에서 먼저 변경했어요. 최신 내용을 확인한 후 다시 저장해주세요.",
      };
    }
    console.error(error);
    return {
      status: "error",
      message: "프로필을 저장하지 못했어요. 잠시 후 다시 시도해주세요.",
    };
  }
}

export async function confirmDiagnosesAction(
  formData: FormData,
): Promise<void> {
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
    const reportSource = String(formData.get("reportSource") ?? "");
    const source = {
      recipient_self_reported: {
        actorRole: "recipient" as const,
        evidenceLevel: "self_reported" as const,
      },
      caregiver_observed: {
        actorRole: "caregiver" as const,
        evidenceLevel: "caregiver_observed" as const,
      },
      caregiver_relayed: {
        actorRole: "caregiver" as const,
        evidenceLevel: "relayed_confirmation" as const,
      },
      unconfirmed: {
        actorRole: "caregiver" as const,
        evidenceLevel: "unconfirmed" as const,
      },
    }[reportSource];
    if (!source)
      return {
        status: "error",
        message: "누가 어떻게 확인했는지 선택해주세요.",
      };

    const session = await getSession();
    if (!session)
      return { status: "error", message: "로그인 정보가 만료되었어요." };
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
      return {
        status: "error",
        conflict: true,
        message: "최신 기록을 다시 불러와주세요.",
      };
    }
    const requestedScope = String(formData.get("checkInScope") ?? "");
    const checkInScope =
      requestedScope === "wellbeing" || requestedScope === "guided_wellbeing"
        ? "wellbeing"
        : "full";
    const schedule = new Map(
      createMedicationSchedule(snapshot.medications, snapshot.doseEvents).map(
        (task) => [task.id, task],
      ),
    );
    const { responses, missingTaskIds } =
      checkInScope === "full"
        ? collectCompleteDoseResponses(formData, schedule)
        : { responses: [], missingTaskIds: [] };
    if (missingTaskIds.length > 0)
      return {
        status: "error",
        message: "각 복용 일정의 복용 여부를 모두 확인해주세요.",
      };

    const symptoms = formData
      .getAll("symptoms")
      .filter((value): value is string => typeof value === "string");
    const severity = Number(formData.get("severity") ?? 0);
    const note = String(formData.get("note") ?? "").trim();
    if (
      symptoms.length > 0 &&
      (!Number.isFinite(severity) || severity < 1 || severity > 10)
    ) {
      return {
        status: "error",
        message: "불편한 정도를 1에서 10 사이로 선택해주세요.",
      };
    }
    const correctionReason = String(
      formData.get("correctionReason") ?? "",
    ).trim();
    if (correctionReason.length > 300)
      return {
        status: "error",
        message: "수정 사유는 300자 이내로 입력해주세요.",
      };
    const idempotencyKey = String(
      formData.get("observationIdempotencyKey") ?? "",
    ).trim();
    if (!/^[^/]{8,256}$/.test(idempotencyKey))
      return {
        status: "error",
        message: "기록 화면을 새로 불러온 뒤 다시 저장해주세요.",
      };
    const observationInput = {
      symptoms: [...new Set(symptoms)].slice(0, 20),
      severity: symptoms.length > 0 ? Math.min(Math.max(severity, 1), 10) : 0,
      note,
      actorId: `${session.provider}:${session.id}`,
      actorRole: source.actorRole,
      evidenceLevel: source.evidenceLevel,
      idempotencyKey,
      ...(correctionReason ? { correctionReason } : {}),
    };

    if (requestedScope === "wellbeing") {
      await saveWellbeingCheckIn(
        scope,
        observationInput,
        snapshot,
        expectedRevision,
      );
      revalidatePath("/today");
      revalidatePath("/dashboard");
      revalidatePath("/check-in");
      revalidatePath("/report");
      return { status: "success", message: "오늘의 몸 상태를 기록했어요." };
    }

    const questionSetId = String(formData.get("questionSetId") ?? "").trim();
    if (!/^question-set-[a-zA-Z0-9-]{10,100}$/.test(questionSetId)) {
      return {
        status: "error",
        message: "오늘의 맞춤 질문을 다시 불러와주세요.",
      };
    }

    const questionSet = await getPatientQuestionSet(scope, questionSetId);
    if (
      !questionSet ||
      questionSet.subject_ref !== scope.recipientId ||
      questionSet.target_date !== dateKeyInSeoul()
    ) {
      return {
        status: "error",
        recoverQuestions: true,
        message: "오늘의 맞춤 질문을 다시 확인해야 해요. 입력은 유지돼요.",
      };
    }
    const questionResponse = buildPatientQuestionResponse({
      questionSet,
      answeredBy: source.actorRole,
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
        ...observationInput,
        scope: checkInScope,
        inputSource:
          checkInScope === "wellbeing" ? "quick_wellbeing" : "daily_check_in",
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
      message: "오늘의 복약과 몸 상태를 기록했어요.",
    };
  } catch (error) {
    if (error instanceof CareConflictError) {
      return {
        status: "error",
        conflict: true,
        message:
          "다른 기기에서 먼저 변경했어요. 최신 내용을 확인한 후 다시 저장해주세요.",
      };
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
    if (!session)
      return {
        status: "unavailable",
        message: "다시 로그인한 뒤 시도해 주세요.",
      };
    const limit = await enforceRateLimit("checkIn", { userId: session.id });
    if (!limit.allowed)
      return {
        status: "unavailable",
        message: `${limit.retryAfterSeconds}초 뒤 다시 시도해 주세요.`,
      };
    const scope = careScopeFor(session);
    const profileGuard = await completedProfileGuard(scope);
    if (profileGuard)
      return { status: "unavailable", message: profileGuard.message };
    return await getQuestionSetAvailability({ scope, answerer: "caregiver" });
  } catch {
    return {
      status: "unavailable",
      message: "질문을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
    };
  }
}

export async function addMedicationAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await demoWriteGuard();
  if (guard) return guard;
  const session = await getSession();
  if (!session)
    return { status: "error", message: "로그인 정보가 만료되었어요." };
  const expectedRevision = Number(formData.get("expectedRevision"));
  const itemSeq = String(formData.get("itemSeq") ?? "").trim();
  if (
    !formData.has("expectedRevision") ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0
  ) {
    return {
      status: "error",
      message: "화면을 새로고침한 뒤 다시 추가해주세요.",
    };
  }
  if (!/^\d{6,12}$/.test(itemSeq))
    return {
      status: "error",
      message: "검색 결과에서 약을 다시 선택해주세요.",
    };
  const selection = parseMedicationRegistrationSelection({
    doseQuantity: String(formData.get("doseQuantity") ?? ""),
    doseUnit: String(formData.get("doseUnit") ?? ""),
    frequency: String(formData.get("frequency") ?? ""),
    timings: formData.getAll("timing").map(String),
  });
  if (!selection) {
    return {
      status: "error",
      message: "복용량·주기·시점을 제공된 옵션에서 다시 선택해주세요.",
    };
  }
  const scope = careScopeFor(session);
  try {
    const limit = await enforceRateLimit("medicationSearch", {
      userId: scope.recipientId,
    });
    if (!limit.allowed)
      return {
        status: "error",
        message: `요청이 많아요. ${limit.retryAfterSeconds}초 후 다시 시도해주세요.`,
      };
    // Re-read the canonical product; hidden form fields cannot assert official provenance.
    const verified = await withCareAccountProcessing(scope.recipientId, () =>
      verifyOfficialMedicationCode(itemSeq),
    );
    if (verified.status !== "matched")
      return {
        status: "error",
        message:
          "공식 약 정보를 다시 확인하지 못했어요. 잠시 후 다시 시도해주세요.",
      };
    let explainedItem;
    try {
      [explainedItem] = await withCareAccountProcessing(scope.recipientId, () =>
        simplifyOfficialMedicationSearchItemsWithOpenAI([verified.item], {
          apiKey: process.env.OPENAI_API_KEY,
          model: process.env.OPENAI_MEDICAL_MODEL,
        }),
      );
    } catch (error) {
      console.error(
        "Medication explanation generation failed",
        error instanceof Error ? error.message : "unknown",
      );
      return {
        status: "error",
        message:
          "약의 쉬운 설명을 만들지 못해 저장하지 않았어요. 잠시 후 다시 시도해주세요.",
      };
    }
    const explanation = explainedItem?.plainExplanation;
    if (!explanation?.overview) {
      return {
        status: "error",
        message: "식약처 허가정보에서 설명 근거를 찾지 못해 저장하지 않았어요.",
      };
    }
    await addMedicationPlan(
      scope,
      {
        itemSeq: verified.item.itemSeq,
        productName: verified.item.productName,
        ingredientName: verified.item.ingredientName,
        categoryPlain:
          explanation.categoryPlain || verified.item.classification,
        purposePlain: explanation.overview,
        descriptionPlain:
          explanation.usagePlain ||
          explanation.safetyPlain ||
          explanation.caregiverNote,
        commonEffects: explanation.commonEffects,
        doseAmount: selection.doseAmount,
        frequency: selection.frequency,
        timing: selection.timing,
        startDate: String(formData.get("startDate") ?? ""),
        endDate: String(formData.get("endDate") ?? ""),
        confirmedBy: session.name,
      },
      expectedRevision,
    );
    for (const path of ["/medications", "/dashboard", "/today", "/report"])
      revalidatePath(path);
    return {
      status: "success",
      message: "복용약을 추가했어요. 목록과 복약 일정에서 확인해주세요.",
    };
  } catch (error) {
    if (error instanceof CareConflictError)
      return {
        status: "error",
        message:
          "다른 화면에서 기록이 변경됐어요. 새로고침한 뒤 다시 추가해주세요.",
        conflict: true,
      };
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "약을 추가하지 못했어요. 잠시 후 다시 시도해주세요.",
    };
  }
}

export async function refreshMedicationExplanationAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await demoWriteGuard();
  if (guard) return guard;
  const session = await getSession();
  if (!session)
    return { status: "error", message: "로그인 정보가 만료되었어요." };
  const expectedRevision = Number(formData.get("expectedRevision"));
  const medicationId = String(formData.get("medicationId") ?? "").trim();
  const itemSeq = String(formData.get("itemSeq") ?? "").trim();
  if (
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0 ||
    !medicationId ||
    !/^\d{6,12}$/.test(itemSeq)
  ) {
    return {
      status: "error",
      message: "화면을 새로고침한 뒤 다시 시도해주세요.",
    };
  }
  const scope = careScopeFor(session);
  try {
    const limit = await enforceRateLimit("medicationSearch", {
      userId: scope.recipientId,
    });
    if (!limit.allowed)
      return {
        status: "error",
        message: `요청이 많아요. ${limit.retryAfterSeconds}초 후 다시 시도해주세요.`,
      };
    const verified = await withCareAccountProcessing(scope.recipientId, () =>
      verifyOfficialMedicationCode(itemSeq),
    );
    if (verified.status !== "matched")
      return {
        status: "error",
        message: "공식 약 정보를 다시 확인하지 못했어요.",
      };
    const [explainedItem] = await withCareAccountProcessing(
      scope.recipientId,
      () =>
        simplifyOfficialMedicationSearchItemsWithOpenAI([verified.item], {
          apiKey: process.env.OPENAI_API_KEY,
          model: process.env.OPENAI_MEDICAL_MODEL,
        }),
    );
    const explanation = explainedItem?.plainExplanation;
    const description =
      explanation?.usagePlain ||
      explanation?.safetyPlain ||
      explanation?.caregiverNote;
    if (!explanation?.overview || !description)
      return {
        status: "error",
        message: "식약처 허가정보에서 설명 근거를 찾지 못했어요.",
      };
    await updateMedicationExplanation(
      scope,
      {
        medicationId,
        itemSeq: verified.item.itemSeq,
        categoryPlain:
          explanation.categoryPlain || verified.item.classification,
        purposePlain: explanation.overview,
        descriptionPlain: description,
        commonEffects: explanation.commonEffects,
      },
      expectedRevision,
    );
    for (const path of [
      "/medications",
      `/medications/${medicationId}`,
      "/dashboard",
    ])
      revalidatePath(path);
    return {
      status: "success",
      message: "식약처 정보를 바탕으로 쉬운 설명을 만들었어요.",
    };
  } catch (error) {
    if (error instanceof CareConflictError)
      return {
        status: "error",
        message:
          "다른 화면에서 기록이 변경됐어요. 새로고침한 뒤 다시 시도해주세요.",
        conflict: true,
      };
    console.error(
      "Medication explanation refresh failed",
      error instanceof Error ? error.message : "unknown",
    );
    return {
      status: "error",
      message: "쉬운 설명을 만들지 못했어요. 잠시 후 다시 시도해주세요.",
    };
  }
}
