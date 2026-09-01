import {
  WebPushError,
  rawPayload,
  sendPushNotification,
} from "@mmmike/web-push/send";

export interface BrowserPushSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface WebPushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  lang?: string;
  timestamp?: number;
  data: {
    url: string;
    type: "medication-reminder" | "test";
    deliveryId?: string;
    subscriptionId?: string;
    bindingId?: string;
  };
}

export interface VapidConfiguration {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface WebPushDeliveryResult {
  ok: boolean;
  status: number;
  expired: boolean;
  responseBody: string;
  retryAfterMs?: number;
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export function getVapidConfiguration(
  providedEnv?: {
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
    VAPID_SUBJECT?: string;
  },
): VapidConfiguration | null {
  const env = providedEnv ?? {
    VAPID_PUBLIC_KEY: process.env["VAPID_PUBLIC_KEY"],
    VAPID_PRIVATE_KEY: process.env["VAPID_PRIVATE_KEY"],
    VAPID_SUBJECT: process.env["VAPID_SUBJECT"],
  };
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  if (decodeBase64Url(env.VAPID_PUBLIC_KEY).length !== 65) {
    throw new Error("VAPID_PUBLIC_KEY 길이가 올바르지 않습니다.");
  }
  if (decodeBase64Url(env.VAPID_PRIVATE_KEY).length !== 32) {
    throw new Error("VAPID_PRIVATE_KEY 길이가 올바르지 않습니다.");
  }
  if (!env.VAPID_SUBJECT.startsWith("mailto:") && !env.VAPID_SUBJECT.startsWith("https://")) {
    throw new Error("VAPID_SUBJECT는 mailto: 또는 https:// 주소여야 합니다.");
  }
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT,
  };
}

export async function sendWebPush(
  subscription: BrowserPushSubscription,
  payload: WebPushNotificationPayload,
  options: {
    vapid: VapidConfiguration;
    ttlSeconds: number;
    urgency?: "very-low" | "low" | "normal" | "high";
    topic?: string;
  },
): Promise<WebPushDeliveryResult> {
  try {
    const delivered = await sendPushNotification(
      subscription,
      rawPayload(JSON.stringify(payload)),
      options.vapid,
      {
        ttl: Math.max(1, Math.min(Math.floor(options.ttlSeconds), 86_400)),
        urgency: options.urgency ?? "normal",
        ...(options.topic ? { topic: options.topic.slice(0, 32) } : {}),
      },
    );
    return delivered
      ? { ok: true, status: 201, expired: false, responseBody: "" }
      : { ok: false, status: 410, expired: true, responseBody: "gone" };
  } catch (error) {
    if (error instanceof WebPushError) {
      return {
        ok: false,
        status: error.statusCode,
        expired: error.statusCode === 404 || error.statusCode === 410,
        responseBody: error.body.slice(0, 500),
        ...(error.retryAfterMs !== null ? { retryAfterMs: error.retryAfterMs } : {}),
      };
    }
    throw error;
  }
}
