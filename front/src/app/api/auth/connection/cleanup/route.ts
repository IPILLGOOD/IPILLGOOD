import { cleanupExpiredCareConnections } from "@care-atlas/backend";

function authorized(request: Request) {
  const configured = process.env.PUSH_CRON_SECRET;
  return Boolean(configured && configured.length >= 32 && request.headers.get("x-ipillgood-cron-secret") === configured);
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    return Response.json({ ok: true, summary: await cleanupExpiredCareConnections() });
  } catch (error) {
    console.error("Expired care connection cleanup failed", error);
    return Response.json({ error: "connection_cleanup_failed" }, { status: 500 });
  }
}
