import { getSession } from "@/lib/auth/session";
import { isSameOriginRequest } from "@/lib/api-security";
import { cleanupPushBinding, getPushSessionKey } from "@/lib/push/server-binding";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: "invalid_origin" }, { status: 403 });
  try {
    const session = await getSession();
    const cleaned = await cleanupPushBinding(session ? await getPushSessionKey() : "");
    return Response.json({ cleaned, signedIn: Boolean(session) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "cleanup_pending" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
