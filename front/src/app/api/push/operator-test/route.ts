import {
  getPushDeliveryReceipt,
  getVapidConfiguration,
  sendTestPushToDevice,
} from "@care-atlas/backend";
import { z } from "zod";

const OPERATOR_HEADER = "x-ipillgood-operator-secret";

const userIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
const deviceIdSchema = z.string().min(16).max(128);
const deliveryIdSchema = z.string().regex(/^[a-f0-9]{48}$/);
const targetSchema = z.object({
  userId: userIdSchema,
  deviceId: deviceIdSchema,
});

function isAuthorizedOperator(request: Request) {
  const configured = process.env.PUSH_OPERATOR_SECRET;
  const supplied = request.headers.get(OPERATOR_HEADER);
  return Boolean(configured && configured.length >= 32 && supplied === configured);
}

function recipientIdForUser(userId: string) {
  return `google-${userId}`;
}

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  if (!isAuthorizedOperator(request)) return json({ error: "unauthorized" }, 401);

  try {
    const target = targetSchema.parse(await request.json());
    const vapid = getVapidConfiguration();
    if (!vapid) return json({ error: "push_not_configured" }, 503);

    const sent = await sendTestPushToDevice({
      userId: target.userId,
      recipientId: recipientIdForUser(target.userId),
      deviceId: target.deviceId,
      vapid,
    });
    if (!sent) return json({ error: "active_subscription_not_found" }, 404);

    return json(
      {
        accepted: sent.result.ok,
        expired: sent.result.expired,
        pushServiceStatus: sent.result.status,
        deliveryId: sent.deliveryId,
      },
      sent.result.ok ? 200 : 502,
    );
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: "invalid_target" }, 400);
    console.error("Operator test Web Push failed", error);
    return json({ error: "test_push_failed" }, 502);
  }
}

export async function GET(request: Request) {
  if (!isAuthorizedOperator(request)) return json({ error: "unauthorized" }, 401);

  const query = new URL(request.url).searchParams;
  const parsed = z
    .object({
      userId: userIdSchema,
      deliveryId: deliveryIdSchema,
    })
    .safeParse({
      userId: query.get("userId"),
      deliveryId: query.get("deliveryId"),
    });
  if (!parsed.success) return json({ error: "invalid_delivery" }, 400);

  try {
    const receipt = await getPushDeliveryReceipt(
      recipientIdForUser(parsed.data.userId),
      parsed.data.deliveryId,
    );
    if (!receipt) return json({ error: "delivery_not_found" }, 404);
    return json({ receipt });
  } catch (error) {
    console.error("Operator push receipt lookup failed", error);
    return json({ error: "receipt_lookup_failed" }, 500);
  }
}
