import { getVapidConfiguration } from "@care-atlas/backend";
import { getPushSessionKey } from "@/lib/push/server-binding";
import { getSession } from "@/lib/auth/session";

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const vapid = getVapidConfiguration();
    return Response.json(
      {
        configured: Boolean(vapid),
        publicKey: vapid?.publicKey ?? null,
        sessionKey: await getPushSessionKey(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Invalid Web Push configuration", error);
    return Response.json(
      { configured: false, publicKey: null, error: "invalid_push_configuration" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
