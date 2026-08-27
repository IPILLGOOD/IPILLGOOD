import { dispatchDueMedicationReminders, getVapidConfiguration, reconcileMedicationReminders } from "@care-atlas/backend";

function isAuthorizedCron(request: Request) {
  const configured = process.env.PUSH_CRON_SECRET;
  const supplied = request.headers.get("x-ipillgood-cron-secret");
  return Boolean(configured && configured.length >= 32 && supplied === configured);
}

export async function POST(request: Request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const reconciliation = await reconcileMedicationReminders();
    const vapid = getVapidConfiguration();
    if (!vapid) {
      return Response.json({ error: "push_not_configured" }, { status: 503 });
    }
    const summary = await dispatchDueMedicationReminders({ vapid });
    const ok = summary.failed === 0 && reconciliation.failed === 0;
    return Response.json({ ok, summary, reconciliation }, { status: ok ? 200 : 503 });
  } catch (error) {
    console.error("Scheduled medication reminders failed", error);
    return Response.json({ error: "dispatch_failed" }, { status: 500 });
  }
}
