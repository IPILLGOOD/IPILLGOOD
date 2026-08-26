import { cleanupExpiredDemoSessions } from "@care-atlas/backend";

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
    const summary = await cleanupExpiredDemoSessions();
    return Response.json({ ok: true, summary });
  } catch (error) {
    console.error("Expired demo session cleanup failed", error);
    return Response.json({ error: "demo_cleanup_failed" }, { status: 500 });
  }
}
