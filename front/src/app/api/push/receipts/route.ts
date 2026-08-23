import {
  getPushDeliveryReceipt,
  recordPushDeliveryReceipt,
} from "@care-atlas/backend";
import { z } from "zod";

import { isSameOriginRequest } from "@/lib/api-security";
import { careScopeFor } from "@/lib/auth/care-scope";
import { getSession } from "@/lib/auth/session";

const deliveryIdSchema = z.string().regex(/^[a-f0-9]{48}$/);
const receiptSchema = z.object({
  deliveryId: deliveryIdSchema,
  receipt: z.enum(["displayed", "clicked"]),
});

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = deliveryIdSchema.safeParse(new URL(request.url).searchParams.get("deliveryId"));
  if (!parsed.success) {
    return Response.json({ error: "invalid_delivery" }, { status: 400 });
  }
  const receipt = await getPushDeliveryReceipt(
    careScopeFor(session).recipientId,
    parsed.data,
  );
  if (!receipt) return Response.json({ error: "delivery_not_found" }, { status: 404 });
  return Response.json({ receipt }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const input = receiptSchema.parse(await request.json());
    const recorded = await recordPushDeliveryReceipt({
      recipientId: careScopeFor(session).recipientId,
      ...input,
    });
    return recorded
      ? Response.json({ ok: true })
      : Response.json({ error: "delivery_not_found" }, { status: 404 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "invalid_receipt" }, { status: 400 });
    }
    console.error("Push delivery receipt failed", error);
    return Response.json({ error: "receipt_failed" }, { status: 500 });
  }
}
