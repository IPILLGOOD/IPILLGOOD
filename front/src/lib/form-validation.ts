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
  const recipient: CareRecipient = {
    ...current,
    displayName: values.displayName,
    ageBand: values.ageBand,
    allergies: listFromCommaSeparated(values.allergies),
    conditions: listFromCommaSeparated(values.conditions),
    mobilityNote: values.mobilityNote,
    caregiverNote: values.caregiverNote,
    consentConfirmed: true,
    lastConfirmedAt: new Date().toISOString(),
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
