import { z } from "zod";

import type { CareRecipient, DoseResponse } from "@care-atlas/backend";
import type { MedicationScheduleTask } from "@/lib/presentation";

export const profileSchema = z.object({
  displayName: z.string().trim().min(2, "이름을 두 글자 이상 입력해주세요."),
  ageBand: z
    .string()
    .trim()
    .regex(/^\d+$/, "나이를 숫자로 입력해주세요.")
    .refine((value) => Number(value) >= 1 && Number(value) <= 120, {
      message: "나이는 1세부터 120세 사이로 입력해주세요.",
    }),
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
  confirmedConditions: z.preprocess((value) => {
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch { return null; }
  }, z.array(z.object({
    id: z.string().min(1).max(256).optional(),
    standardName: z.string().trim().min(1, "질환명을 입력해주세요." ).max(120, "질환명은 120자 안으로 입력해주세요."),
    code: z.string().trim().max(30, "질환 코드는 30자 안으로 입력해주세요."),
    confirmed: z.literal(true, { error: "의료진에게 확인받은 질환인지 확인해주세요." }),
  })).max(50, "질환은 최대 50개까지 등록할 수 있어요.").superRefine((items, ctx) => {
    const names = new Set<string>();
    const ids = new Set<string>();
    for (const item of items) {
      const name = item.standardName.normalize("NFKC").replace(/\s/g, "").toLowerCase();
      if (names.has(name) || (item.id && ids.has(item.id))) {
        ctx.addIssue({ code: "custom", message: "같은 질환을 중복 등록하지 않도록 목록을 확인해주세요." });
      }
      names.add(name);
      if (item.id) ids.add(item.id);
    }
  })),
  mobilityNote: z.string().max(300, "300자 안으로 입력해주세요."),
  caregiverNote: z.string().max(500, "500자 안으로 입력해주세요."),
  consentConfirmed: z.literal("on", {
    error: "돌봄 정보 저장 동의를 확인해주세요.",
  }),
});

export type ProfileFormValues = z.infer<typeof profileSchema>;

export function listFromCommaSeparated(value: string) {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildRecipientProfile(
  current: CareRecipient,
  values: ProfileFormValues,
): CareRecipient {
  const confirmedAt = new Date().toISOString();
  const confirmedConditions = values.confirmedConditions.map((condition) => {
    const existing = condition.id
      ? current.confirmedConditions?.find((item) => item.id === condition.id)
      : undefined;
    if (condition.id && !existing) throw new Error("현재 프로필에 없는 질환입니다. 최신 프로필을 다시 확인해주세요.");
    const code = condition.code || "코드 미기재";
    if (existing && existing.standardName === condition.standardName && existing.code === code) return existing;
    // Edited diagnoses are newly confirmed profile entries, not unchanged document evidence.
    return {
      id: `condition-${crypto.randomUUID()}`,
      standardName: condition.standardName,
      code,
      sourceLabel: "프로필에서 의료진 확인 정보로 사용자 확정",
      confirmedAt,
    };
  });
  const recipient: CareRecipient = {
    ...current,
    displayName: values.displayName,
    ageBand: values.ageBand,
    allergies: listFromCommaSeparated(values.allergies),
    conditions: listFromCommaSeparated(values.conditions),
    confirmedConditions,
    mobilityNote: values.mobilityNote,
    caregiverNote: values.caregiverNote,
    consentConfirmed: true,
    lastConfirmedAt: confirmedAt,
    profileCompletedAt: confirmedAt,
  };

  delete recipient.heightCm;
  delete recipient.weightKg;
  if (values.heightCm !== undefined) recipient.heightCm = values.heightCm;
  if (values.weightKg !== undefined) recipient.weightKg = values.weightKg;

  return recipient;
}

const allowedDoseResponses = new Set<DoseResponse>([
  "completed",
  "partial",
  "skipped",
  "not_yet",
  "unconfirmed",
]);

type ScheduleTask = Pick<MedicationScheduleTask, "id" | "medicationPlanId" | "scheduledAt">;

export function collectCompleteDoseResponses(
  formData: FormData,
  schedule: Map<string, ScheduleTask>,
) {
  const responseByTaskId = new Map<
    string,
    {
      medicationPlanId: string;
      response: DoseResponse;
      scheduledAt: string;
    }
  >();

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("dose_") || typeof value !== "string") continue;
    if (!allowedDoseResponses.has(value as DoseResponse)) continue;
    const taskId = key.replace("dose_", "");
    const task = schedule.get(taskId);
    if (!task) continue;
    responseByTaskId.set(taskId, {
      medicationPlanId: task.medicationPlanId,
      response: value as DoseResponse,
      scheduledAt: task.scheduledAt,
    });
  }

  const missingTaskIds = [...schedule.keys()].filter((taskId) => !responseByTaskId.has(taskId));
  return {
    responses: [...responseByTaskId.values()],
    missingTaskIds,
  };
}
