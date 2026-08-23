import {
  getCareSnapshot,
  getNotificationScheduleStatus,
  syncMedicationReminderSchedules,
} from "@care-atlas/backend";

import { isSameOriginRequest } from "@/lib/api-security";
import { careScopeFor } from "@/lib/auth/care-scope";
import { getSession } from "@/lib/auth/session";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const scope = careScopeFor(session);
    const snapshot = await getCareSnapshot(scope);
    await syncMedicationReminderSchedules({
      recipientId: scope.recipientId,
      medications: snapshot.medications,
    });
    const status = await getNotificationScheduleStatus(scope.recipientId);
    return Response.json({ ok: true, status });
  } catch (error) {
    console.error("Medication reminder sync failed", error);
    return Response.json({ error: "reminder_sync_failed" }, { status: 500 });
  }
}
