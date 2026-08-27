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
} from "./environment";

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

async function getPushConfiguration() {
  const response = await fetch("/api/push/config", { cache: "no-store" });
  if (!response.ok && response.status !== 503) {
    throw new Error("알림 설정을 불러오지 못했어요.");
  }
  return (await response.json()) as {
    configured: boolean;
    publicKey: string | null;
  };
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

async function uploadSubscription(subscription: PushSubscription) {
  const response = await fetch("/api/push/subscriptions", {
    method: "POST",
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
  const permission = getNotificationPermission();
  const configuration = await getPushConfiguration();
  const current = supported ? await getCurrentSubscription() : null;
  let status: NotificationScheduleStatus | null = null;
  let registered = false;
  const deviceId = window.localStorage.getItem(DEVICE_ID_KEY);
  if (current && configuration.configured && deviceId) {
    const response = await fetch(`/api/push/subscriptions?deviceId=${encodeURIComponent(deviceId)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("알림 설정을 불러오지 못했어요.");
    const result = await response.json() as { subscribed: boolean; status: NotificationScheduleStatus };
    registered = result.subscribed;
    status = result.status;
  }
  return {
    supported,
    permission,
    subscribed: Boolean(current) && registered,
    needsIosInstall,
    configured: configuration.configured,
    publicKey: configuration.publicKey,
    status,
  };
}

export async function enablePushNotifications(publicKey: string) {
  const result = await subscribe(publicKey);
  if (result.status === "unsupported") return { status: "unsupported" as const };
  if (result.status === "denied") return { status: "denied" as const };
  const status = await uploadSubscription(result.subscription);
  return { status: "subscribed" as const, scheduleStatus: status };
}

export async function disablePushNotifications() {
  const deviceId = getPushDeviceId();
  const response = await fetch("/api/push/subscriptions", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId }),
  });
  if (!response.ok) throw new Error("알림 해제를 서버에 반영하지 못했어요.");
  await unsubscribe();
}
