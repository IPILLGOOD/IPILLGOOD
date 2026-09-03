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

import { withPushLifecycleLock } from "./lifecycle-lock.ts";
import { finishPendingBrowserCleanup } from "./browser-cleanup.ts";

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
  registered: boolean;
  needsIosInstall: boolean;
  configured: boolean;
  publicKey: string | null;
  sessionKey: string;
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

async function getPushConfiguration(signal?: AbortSignal, expectedSessionKey?: string) {
  const response = await fetch("/api/push/config", { cache: "no-store", signal: requestSignal(signal) });
  if (!response.ok && response.status !== 503) {
    throw new Error("알림 설정을 불러오지 못했어요.");
  }
  const configuration = (await response.json()) as {
    configured: boolean;
    publicKey: string | null;
    sessionKey: string;
  };
  if (expectedSessionKey && configuration.sessionKey !== expectedSessionKey) throw new Error("PUSH_SESSION_CHANGED");
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

async function uploadSubscription(subscription: PushSubscription, sessionKey: string, signal?: AbortSignal, onlyIfActive = false) {
  signal?.throwIfAborted();
  const response = await fetch("/api/push/subscriptions", {
    method: "POST",
    signal: requestSignal(signal),
    headers: { "Content-Type": "application/json", "x-push-session": sessionKey },
    body: JSON.stringify({
      ...browserRegistrationDetails(),
      ...(onlyIfActive ? { onlyIfActive: true } : {}),
      subscription: serializeSubscription(subscription),
    }),
  });
  if (!response.ok) throw new Error("이 기기의 알림 등록을 완료하지 못했어요.");
  const prepared = await response.json() as { bindingId: string };
  signal?.throwIfAborted();
  try {
    const activation = await fetch("/api/push/subscriptions", {
      method: "PATCH", signal: requestSignal(signal),
      headers: { "Content-Type": "application/json", "x-push-session": sessionKey },
      body: JSON.stringify({ bindingId: prepared.bindingId }),
    });
    if (!activation.ok) throw new Error("이 기기의 알림 활성화를 완료하지 못했어요.");
    return (await activation.json() as { status: NotificationScheduleStatus }).status;
  } catch (error) {
    signal?.throwIfAborted();
    // A lost confirmation response can be reconciled with the durable cookie + server state.
    const confirmed = await inspectPushClient(signal, sessionKey).catch(() => null);
    if (confirmed?.sessionKey === sessionKey && confirmed.subscribed && confirmed.status) return confirmed.status;
    throw error;
  }
}

export async function inspectPushClient(signal?: AbortSignal, expectedSessionKey?: string): Promise<PushClientState> {
  signal?.throwIfAborted();
  const environment = detectPushEnvironment(navigator.userAgent);
  const needsIosInstall = environment.isIos && !isStandalonePwa();
  const supported = isPushSupported() && !needsIosInstall;
  const permission = "Notification" in window ? getNotificationPermission() : "default";
  const configuration = await getPushConfiguration(signal, expectedSessionKey);
  const current = supported ? await withPushTimeout(getCurrentSubscription()) : null;
  signal?.throwIfAborted();
  let status: NotificationScheduleStatus | null = null;
  let registered = false;
  let active = false;
  let endpointMatches = false;
  let deliveryAuthRejected = false;
  const keyStatus = current && configuration.publicKey
    ? pushKeyStatus(current.options.applicationServerKey, configuration.publicKey)
    : "none";
  const expired = subscriptionExpired(current?.expirationTime);
  const deviceId = window.localStorage.getItem(DEVICE_ID_KEY);
  if (supported && configuration.configured && deviceId) {
    const response = await fetch(`/api/push/subscriptions?deviceId=${encodeURIComponent(deviceId)}`, { cache: "no-store", signal: requestSignal(signal), headers: { "x-push-session": configuration.sessionKey } });
    if (!response.ok) throw new Error("알림 설정을 불러오지 못했어요.");
    const result = await response.json() as { subscribed: boolean; pending?: boolean; endpointHash: string | null; lastHttpStatus: number | null; status: NotificationScheduleStatus };
    // A new browser subscription is not registered merely because an old endpoint is still active.
    active = result.subscribed;
    registered = active || result.pending === true;
    endpointMatches = current !== null && result.endpointHash === await pushEndpointHash(current.endpoint);
    deliveryAuthRejected = registered && endpointMatches && (result.lastHttpStatus === 401 || result.lastHttpStatus === 403);
    status = result.status;
  }
  return {
    supported,
    permission,
    subscribed: Boolean(current) && active && endpointMatches && permission === "granted" && keyStatus !== "mismatch" && !expired && !deliveryAuthRejected,
    registered,
    needsIosInstall,
    configured: configuration.configured,
    publicKey: configuration.publicKey,
    sessionKey: configuration.sessionKey,
    status,
    keyStatus,
    expired,
    deliveryAuthRejected,
  };
}

export function canAutomaticallyReconnect(state: PushClientState) {
  return state.supported && state.configured && state.permission === "granted" && state.registered
    && (state.keyStatus === "mismatch" || state.expired || state.keyStatus === "none"
      || (state.keyStatus === "matched" && !state.subscribed && !state.deliveryAuthRejected));
}

/** Restore an already enabled account/device without ever requesting permission. */
async function reconnectPushNotificationsUnlocked(signal?: AbortSignal, expectedSessionKey?: string): Promise<PushClientState> {
  await finishPendingBrowserCleanup();
  const state = await inspectPushClient(signal, expectedSessionKey);
  if (!canAutomaticallyReconnect(state) || !state.publicKey) return state;
  const registration = await withPushTimeout(navigator.serviceWorker.ready);
  const current = await withPushTimeout(registration.pushManager.getSubscription());
  const mayContinue = () => {
    signal?.throwIfAborted();
    return getNotificationPermission() === "granted";
  };
  if (!mayContinue()) return inspectPushClient(signal, expectedSessionKey);
  let subscription = current;
  if (current && (pushKeyStatus(current.options.applicationServerKey, state.publicKey) === "mismatch" || subscriptionExpired(current.expirationTime))) {
    if (!await withPushTimeout(current.unsubscribe())) throw new Error("이전 알림 연결을 해제하지 못했어요.");
    subscription = null;
  }
  if (!mayContinue()) return inspectPushClient(signal, expectedSessionKey);
  if (!subscription) {
    subscription = await withPushTimeout(registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodePushPublicKey(state.publicKey),
    }));
  }
  if (!mayContinue()) return inspectPushClient(signal, expectedSessionKey);
  await uploadSubscription(subscription, state.sessionKey, signal, true);
  return inspectPushClient(signal, expectedSessionKey);
}

/** Only called from an explicit user action. Inspection never subscribes or prompts. */
async function enablePushNotificationsUnlocked(signal?: AbortSignal, expectedSessionKey?: string) {
  signal?.throwIfAborted();
  if (!isPushSupported()) return { status: "unsupported" as const };
  if (getNotificationPermission() === "denied") return { status: "denied" as const };
  await finishPendingBrowserCleanup();
  const configuration = await getPushConfiguration(signal, expectedSessionKey);
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
  const status = await uploadSubscription(result.subscription, configuration.sessionKey, signal);
  return { status: "subscribed" as const, scheduleStatus: status };
}

async function disablePushNotificationsUnlocked(signal?: AbortSignal, expectedSessionKey?: string) {
  signal?.throwIfAborted();
  const deviceId = getPushDeviceId();
  const configuration = await getPushConfiguration(signal, expectedSessionKey);
  const response = await fetch("/api/push/subscriptions", {
    method: "DELETE",
    signal: requestSignal(signal),
    headers: { "Content-Type": "application/json", "x-push-session": configuration.sessionKey },
    body: JSON.stringify({ deviceId }),
  });
  if (!response.ok) throw new Error("알림 해제를 서버에 반영하지 못했어요.");
  signal?.throwIfAborted();
  await withPushTimeout(unsubscribe());
}

export function reconnectPushNotifications(signal?: AbortSignal, expectedSessionKey?: string) {
  return withPushLifecycleLock(() => reconnectPushNotificationsUnlocked(signal, expectedSessionKey));
}

export function enablePushNotifications(signal?: AbortSignal, expectedSessionKey?: string) {
  return withPushLifecycleLock(() => enablePushNotificationsUnlocked(signal, expectedSessionKey));
}

export function disablePushNotifications(signal?: AbortSignal, expectedSessionKey?: string) {
  return withPushLifecycleLock(() => disablePushNotificationsUnlocked(signal, expectedSessionKey));
}
