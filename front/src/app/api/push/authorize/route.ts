import { authorizePushDisplay } from "@care-atlas/backend";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { careScopeFor } from "@/lib/auth/care-scope";
import { isSameOriginRequest } from "@/lib/api-security";
import { getPushSessionKey, readPushBinding } from "@/lib/push/server-binding";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return new Response(null, { status: 403 });
  try {
    const session = await getSession();
    const binding = await readPushBinding();
    if (!session || !binding || binding.userId !== session.id || binding.sessionKey !== await getPushSessionKey()) return new Response(null, { status: 403 });
    const input = z.object({ subscriptionId: z.string().regex(/^[a-f0-9]{48}$/), bindingId: z.string().uuid() }).parse(await request.json());
    if (binding.bindingId !== input.bindingId) return new Response(null, { status: 403 });
    const allowed = await authorizePushDisplay({ ...binding, ...input, recipientId: careScopeFor(session).recipientId });
    return new Response(null, { status: allowed ? 204 : 403, headers: { "Cache-Control": "no-store" } });
  } catch {
    // Offline, expired/revoked sessions and unavailable storage never reveal an old notification.
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
