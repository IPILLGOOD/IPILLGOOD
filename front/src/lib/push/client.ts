"use client";

import {
  getCurrentSubscription,
  getNotificationPermission,
  isPushSupported,
  serializeSubscription,
  subscribe,
  unsubscribe,
} from "@mmmike/web-push/client";

import {
  detectPushEnvironment,
  isStandalonePwa,
  type PushBrowser,
  type PushPlatform,
} from "./environment.ts";
import { decodePushPublicKey, pushEndpointHash, pushKeyStatus, subscriptionExpired, withPushTimeout, type PushKeyStatus } from "./key-validation.ts";

const DEVICE_ID_KEY = "ipillgood:push-device-id";

export interface NotificationScheduleStatus {
  activeSubscriptionCount: number;
  activeScheduleCount: number;
  nextReminderAt: string | null;
}

export interface PushClientState {
  supported: boolean;
  permission: NotificationPermission;
  subscribed: boolean;
  needsIosInstall: boolean;
  configured: boolean;
  publicKey: string | null;
  status: NotificationScheduleStatus | null;
  keyStatus: PushKeyStatus;
  expired: boolean;
  deliveryAuthRejected: boolean;
}

function randomDeviceId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function getPushDeviceId() {
  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = randomDeviceId();
  window.localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

function requestSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(10_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function getPushConfiguration(signal?: AbortSignal) {
  const response = await fetch("/api/push/config", { cache: "no-store", signal: requestSignal(signal) });
  if (!response.ok && response.status !== 503) {
    throw new Error("알림 설정을 불러오지 못했어요.");
  }
  const configuration = (await response.json()) as {
    configured: boolean;
    publicKey: string | null;
  };
  if (configuration.configured) {
    if (!configuration.publicKey) throw new Error("알림 서버 설정을 확인해 주세요.");
    decodePushPublicKey(configuration.publicKey);
  }
  return configuration;
}

function browserRegistrationDetails(): {
  deviceId: string;
  platform: PushPlatform;
  browser: PushBrowser;
  userAgent: string;
  timeZone: string;
} {
  const environment = detectPushEnvironment(navigator.userAgent);
  return {
    deviceId: getPushDeviceId(),
    platform: environment.platform,
    browser: environment.browser,
    userAgent: navigator.userAgent,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Seoul",
  };
}

async function uploadSubscription(subscription: PushSubscription, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const response = await fetch("/api/push/subscriptions", {
    method: "POST",
    signal: requestSignal(signal),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...browserRegistrationDetails(),
      subscription: serializeSubscription(subscription),
    }),
  });
  if (!response.ok) throw new Error("이 기기의 알림 등록을 완료하지 못했어요.");
  const result = (await response.json()) as {
    status: NotificationScheduleStatus;
  };
  return result.status;
}

export async function inspectPushClient(): Promise<PushClientState> {
  const environment = detectPushEnvironment(navigator.userAgent);
  const needsIosInstall = environment.isIos && !isStandalonePwa();
  const supported = isPushSupported() && !needsIosInstall;
  const permission = "Notification" in window ? getNotificationPermission() : "default";
  const configuration = await getPushConfiguration();
  const current = supported ? await withPushTimeout(getCurrentSubscription()) : null;
  let status: NotificationScheduleStatus | null = null;
  let registered = false;
  let deliveryAuthRejected = false;
  const keyStatus = current && configuration.publicKey
    ? pushKeyStatus(current.options.applicationServerKey, configuration.publicKey)
    : "none";
  const expired = subscriptionExpired(current?.expirationTime);
  const deviceId = window.localStorage.getItem(DEVICE_ID_KEY);
  if (current && configuration.configured && deviceId) {
    const response = await fetch(`/api/push/subscriptions?deviceId=${encodeURIComponent(deviceId)}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("알림 설정을 불러오지 못했어요.");
    const result = await response.json() as { subscribed: boolean; endpointHash: string | null; lastHttpStatus: number | null; status: NotificationScheduleStatus };
    // A new browser subscription is not registered merely because an old endpoint is still active.
    registered = result.subscribed && result.endpointHash === await pushEndpointHash(current.endpoint);
    deliveryAuthRejected = registered && (result.lastHttpStatus === 401 || result.lastHttpStatus === 403);
    status = result.status;
  }
  return {
    supported,
    permission,
    subscribed: Boolean(current) && registered && permission === "granted" && keyStatus !== "mismatch" && !expired && !deliveryAuthRejected,
    needsIosInstall,
    configured: configuration.configured,
    publicKey: configuration.publicKey,
    status,
    keyStatus,
    expired,
    deliveryAuthRejected,
  };
}

/** Only called from an explicit user action. Inspection never subscribes or prompts. */
export async function enablePushNotifications(signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!isPushSupported()) return { status: "unsupported" as const };
  if (getNotificationPermission() === "denied") return { status: "denied" as const };
  const configuration = await getPushConfiguration(signal);
  if (!configuration.configured || !configuration.publicKey) throw new Error("알림 서버 설정을 확인해 주세요.");
  const current = await withPushTimeout(getCurrentSubscription());
  signal?.throwIfAborted();
  if (current && (pushKeyStatus(current.options.applicationServerKey, configuration.publicKey) === "mismatch" || subscriptionExpired(current.expirationTime))) {
    if (!await withPushTimeout(current.unsubscribe())) throw new Error("이전 알림 연결을 해제하지 못했어요. 다시 시도해 주세요.");
  }
  const result = await withPushTimeout(subscribe(configuration.publicKey), 60_000);
  signal?.throwIfAborted();
  if (result.status === "unsupported") return { status: "unsupported" as const };
  if (result.status === "denied") return { status: "denied" as const };
  const status = await uploadSubscription(result.subscription, signal);
  return { status: "subscribed" as const, scheduleStatus: status };
}

export async function disablePushNotifications(signal?: AbortSignal) {
  signal?.throwIfAborted();
  const deviceId = getPushDeviceId();
  const response = await fetch("/api/push/subscriptions", {
    method: "DELETE",
    signal: requestSignal(signal),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId }),
  });
  if (!response.ok) throw new Error("알림 해제를 서버에 반영하지 못했어요.");
  signal?.throwIfAborted();
  await withPushTimeout(unsubscribe());
}
