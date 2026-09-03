import { getCareRevisionForAuthorizedRequest } from "@care-atlas/backend";

import { careScopeFor } from "@/lib/auth/care-scope";
import { getSession } from "@/lib/auth/session";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rateLimitResponse } from "@/lib/rate-limit-core";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const rate = await enforceRateLimit("sync", { request, userId: session.id });
  if (!rate.allowed) return rateLimitResponse(rate);
  try {
    // getSession authorizes account generation / demo expiry / connected grant once
    // for this request; do not repeat those Firestore reads in the revision loader.
    const revision = await getCareRevisionForAuthorizedRequest(careScopeFor(session));
    return Response.json({ revision }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "revision_unavailable" }, { status: 503 });
  }
}
