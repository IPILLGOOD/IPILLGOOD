"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  analyzeMedicationDocument,
  DEMO_RECIPIENT_ID,
  getCareSnapshot,
  registerDocument,
  saveDailyCheckIn,
  updateRecipientProfile,
  type ActionState,
  type DoseResponse,
} from "@care-atlas/backend";

function demoWriteGuard(): ActionState | null {
  if (process.env.CARE_ATLAS_DEMO_MODE === "true") return null;
  return {
    status: "error",
    message: "현재는 읽기 전용 모드예요. 인증을 연결한 뒤 저장 기능을 활성화해주세요.",
  };
}

const profileSchema = z.object({
  displayName: z.string().trim().min(2, "이름을 두 글자 이상 입력해주세요."),
  ageBand: z.string().min(1, "연령대를 선택해주세요."),
  heightCm: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().min(100).max(220).optional(),
  ),
  weightKg: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().min(25).max(200).optional(),
  ),
  allergies: z.string(),
  conditions: z.string(),
  mobilityNote: z.string().max(300, "300자 안으로 입력해주세요."),
  caregiverNote: z.string().max(500, "500자 안으로 입력해주세요."),
  consentConfirmed: z.literal("on", {
    error: "돌봄 정보 저장 동의를 확인해주세요.",
  }),
});

function listFromCommaSeparated(value: string) {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function saveProfileAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = demoWriteGuard();
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
    await updateRecipientProfile({
      ...current.recipient,
      id: DEMO_RECIPIENT_ID,
      displayName: result.data.displayName,
      ageBand: result.data.ageBand,
      heightCm: result.data.heightCm,
      weightKg: result.data.weightKg,
      allergies: listFromCommaSeparated(result.data.allergies),
      conditions: listFromCommaSeparated(result.data.conditions),
      mobilityNote: result.data.mobilityNote,
      caregiverNote: result.data.caregiverNote,
      consentConfirmed: true,
      lastConfirmedAt: new Date().toISOString(),
    });
    revalidatePath("/");
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

const doseResponses = new Set<DoseResponse>([
  "completed",
  "partial",
  "skipped",
  "not_yet",
  "unconfirmed",
]);

export async function saveCheckInAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = demoWriteGuard();
  if (guard) return guard;
  const answeredBy = formData.get("answeredBy");
  if (answeredBy !== "caregiver" && answeredBy !== "recipient") {
    return { status: "error", message: "누가 답했는지 선택해주세요." };
  }

  const responses: Array<{
    medicationPlanId: string;
    response: DoseResponse;
  }> = [];

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("dose_") || typeof value !== "string") continue;
    if (!doseResponses.has(value as DoseResponse)) continue;
    responses.push({
      medicationPlanId: key.replace("dose_", ""),
      response: value as DoseResponse,
    });
  }

  if (responses.length === 0) {
    return { status: "error", message: "복용 여부를 한 가지 이상 확인해주세요." };
  }

  const symptoms = formData
    .getAll("symptoms")
    .filter((value): value is string => typeof value === "string");
  const severity = Number(formData.get("severity") ?? 0);
  const note = String(formData.get("note") ?? "").trim();

  try {
    await saveDailyCheckIn({
      doseResponses: responses,
      symptoms,
      severity: symptoms.length > 0 ? Math.min(Math.max(severity, 1), 10) : 0,
      note,
      answeredBy,
    });
    revalidatePath("/");
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

export async function registerDocumentAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = demoWriteGuard();
  if (guard) return guard;
  const file = formData.get("document");
  const documentType = String(formData.get("documentType") ?? "처방전");

  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "등록할 문서 사진이나 PDF를 선택해주세요." };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { status: "error", message: "문서는 5MB 이하로 올려주세요." };
  }
  if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
    return { status: "error", message: "이미지 또는 PDF 파일만 등록할 수 있어요." };
  }

  try {
    await registerDocument({
      fileName: file.name,
      documentType,
      size: file.size,
      isSample: false,
    });
    const analysis = await analyzeMedicationDocument();
    revalidatePath("/documents");
    return { status: "success", message: analysis.message };
  } catch (error) {
    console.error(error);
    return {
      status: "error",
      message: "문서 정보를 등록하지 못했어요. 다시 시도해주세요.",
    };
  }
}

export async function registerSampleDocumentAction(
  previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  void previousState;
  void formData;
  const guard = demoWriteGuard();
  if (guard) return guard;
  try {
    await registerDocument({
      fileName: "비식별_샘플_처방전.jpg",
      documentType: "처방전",
      size: 284_000,
      isSample: true,
    });
    revalidatePath("/documents");
    return {
      status: "success",
      message: "샘플 처방전을 확인했어요. 대시보드의 복약 정보와 연결됐습니다.",
    };
  } catch (error) {
    console.error(error);
    return { status: "error", message: "샘플을 불러오지 못했어요." };
  }
}
