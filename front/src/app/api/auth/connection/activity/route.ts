import { touchCareConnection } from "@care-atlas/backend";

import { refreshConnectedSession, getSession } from "@/lib/auth/session";
import { isSameOriginRequest } from "@/lib/api-security";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: "invalid_origin" }, { status: 403 });
  const session = await getSession();
  if (!session || session.provider !== "connected" || !session.recipientId || !session.connectionId || !session.sessionVersion) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const connection = await touchCareConnection({
      recipientId: session.recipientId,
      connectionId: session.connectionId,
      sessionVersion: session.sessionVersion,
    });
    await refreshConnectedSession(session);
    return Response.json({ expiresAt: connection.expiresAt }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "connection_expired" }, { status: 401 });
  }
}
