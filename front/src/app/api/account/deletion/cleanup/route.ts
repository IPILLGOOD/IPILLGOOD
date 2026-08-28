import { retryAccountDeletions } from "@care-atlas/backend";

export async function POST(request: Request) {
  const secret = process.env.PUSH_CRON_SECRET;
  if (!secret || secret.length < 32 || request.headers.get("x-ipillgood-cron-secret") !== secret) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const summary = await retryAccountDeletions();
    return Response.json(summary, { status: summary.failed ? 503 : 200 });
  } catch { return Response.json({ error: "account_deletion_cleanup_failed" }, { status: 503 }); }
}
