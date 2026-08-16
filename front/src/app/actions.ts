"use server";

import { revalidatePath } from "next/cache";

import {
  DEMO_RECIPIENT_ID,
  getCareSnapshot,
  saveDailyCheckIn,
  updateRecipientProfile,
  type ActionState,
} from "@care-atlas/backend";

import { createMedicationSchedule } from "@/lib/presentation";
import { getSession } from "@/lib/auth/session";
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
  if (process.env.CARE_ATLAS_DEMO_MODE === "true") return null;
  return {
    status: "error",
    message: "현재는 읽기 전용 모드예요. 인증을 연결한 뒤 저장 기능을 활성화해주세요.",
  };
}

export async function saveProfileAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await demoWriteGuard();
  if (guard) return guard;
  const result = profileSchema.safeParse(Object.fromEntries(formData));
  if (!result.success) {
    return {
      status: "error",
      message: "입력한 내용을 다시 확인해주세요.",
      fieldErrors: result.error.flatten().fieldErrors,
    };
  }

  try {
    const current = await getCareSnapshot();
    await updateRecipientProfile(
      {
        ...buildRecipientProfile(current.recipient, result.data),
        id: DEMO_RECIPIENT_ID,
      },
      current,
    );
    revalidatePath("/today");
    revalidatePath("/dashboard");
    revalidatePath("/profile");
    return { status: "success", message: "어르신 프로필을 업데이트했어요." };
  } catch (error) {
    console.error(error);
    return {
      status: "error",
      message: "프로필을 저장하지 못했어요. 잠시 후 다시 시도해주세요.",
    };
  }
}

export async function saveCheckInAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await demoWriteGuard();
  if (guard) return guard;
  const answeredBy = formData.get("answeredBy");
  if (answeredBy !== "caregiver" && answeredBy !== "recipient") {
    return { status: "error", message: "누가 답했는지 선택해주세요." };
  }

  const snapshot = await getCareSnapshot();
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

  try {
    await saveDailyCheckIn(
      {
        doseResponses: responses,
        symptoms,
        severity: symptoms.length > 0 ? Math.min(Math.max(severity, 1), 10) : 0,
        note,
        answeredBy,
      },
      snapshot,
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
    console.error(error);
    return {
      status: "error",
      message: "기록을 저장하지 못했어요. 잠시 후 다시 시도해주세요.",
    };
  }
}
