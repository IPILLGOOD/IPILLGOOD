"use client";

import { formatInSeoul } from "@care-atlas/backend/dates";

import {
  Bell,
  BellOff,
  BellRing,
  Smartphone,
} from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { Card } from "@/components/ui/Card";
import {
  disablePushNotifications,
  enablePushNotifications,
  inspectPushClient,
  type PushClientState,
} from "@/lib/push/client";
import {
  detectPushEnvironment,
  isStandalonePwa,
  shouldShowPushNotificationSection,
} from "@/lib/push/environment";

type BusyAction = "enable" | "disable" | null;

function subscribeToPwaDisplayMode(notify: () => void) {
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}

function getNotificationSectionVisibility() {
  const environment = detectPushEnvironment(navigator.userAgent);
  return shouldShowPushNotificationSection({
    platform: environment.platform,
    standalone: isStandalonePwa(),
  });
}

function formatReminderTime(value: string | null | undefined) {
  if (!value) return null;
  return formatInSeoul(value, {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MedicationReminderCard() {
  const visible = useSyncExternalStore(
    subscribeToPwaDisplayMode,
    getNotificationSectionVisibility,
    () => false,
  );
  const [client, setClient] = useState<PushClientState | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible) return;

    let active = true;
    inspectPushClient()
      .then((state) => {
        if (active) setClient(state);
      })
      .catch(() => {
        if (active) setError("알림 상태를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
      });
    return () => {
      active = false;
    };
  }, [visible]);

  const enable = async () => {
    if (!client?.publicKey) return;
    setBusy("enable");
    setError("");
    try {
      const result = await enablePushNotifications(client.publicKey);
      if (result.status === "denied") {
        setClient({ ...client, permission: "denied", subscribed: false });
      } else if (result.status === "unsupported") {
        setClient({ ...client, supported: false, subscribed: false });
      } else {
        setClient({
          ...client,
          permission: "granted",
          subscribed: true,
          status: result.scheduleStatus,
        });
      }
    } catch {
      setError("알림 권한 또는 기기 등록을 완료하지 못했어요.");
    } finally {
      setBusy(null);
    }
  };

  const disable = async () => {
    if (!client) return;
    setBusy("disable");
    setError("");
    try {
      await disablePushNotifications();
      setClient({ ...client, subscribed: false, status: null });
    } catch {
      setError("알림을 해제하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(null);
    }
  };

  const nextReminder = formatReminderTime(client?.status?.nextReminderAt);
  const unavailable = client && (!client.configured || !client.supported || client.permission === "denied");

  if (!visible) return null;

  return (
    <Card className="medication-reminder-card">
      <section aria-labelledby="medication-reminder-title">
        <div className="medication-reminder-card__main">
          <span className="medication-reminder-card__icon" aria-hidden="true">
            {client?.subscribed ? <BellRing size={23} /> : <Bell size={23} />}
          </span>
          <div className="medication-reminder-card__copy">
            <span className="medication-reminder-card__eyebrow">복약 리마인더</span>
            <h2 id="medication-reminder-title">
              {client?.subscribed ? "이 기기로 복약 알림을 보내요" : "앱을 닫아도 복약 시간을 알려드려요"}
            </h2>
            {!client && !error ? <p>이 기기의 알림 가능 여부를 확인하고 있어요.</p> : null}
            {client?.needsIosInstall ? (
              <p>iPhone에서는 공유 메뉴에서 홈 화면에 추가한 뒤 설치된 앱을 열어 주세요.</p>
            ) : null}
            {client && !client.configured ? <p>현재 알림 서버 설정을 준비하고 있어요.</p> : null}
            {client && !client.supported && !client.needsIosInstall ? (
              <p>이 브라우저에서는 Web Push 알림을 지원하지 않아요.</p>
            ) : null}
            {client?.permission === "denied" ? (
              <p>브라우저 또는 기기 설정에서 IPILLGOOD 알림을 허용해 주세요.</p>
            ) : null}
            {client?.subscribed ? (
              <p>
                {nextReminder
                  ? `다음 알림은 ${nextReminder}에 예정되어 있어요.`
                  : "활성 복약 일정이 등록되면 다음 알림 시각을 표시해 드려요."}
              </p>
            ) : null}
          </div>
        </div>

        {client && !unavailable ? (
          <div className="medication-reminder-card__actions">
            {client.subscribed ? (
              <button className="button button--quiet" type="button" onClick={disable} disabled={busy !== null}>
                <BellOff size={17} aria-hidden="true" />
                {busy === "disable" ? "해제 중…" : "이 기기 알림 끄기"}
              </button>
            ) : (
              <button className="button button--primary" type="button" onClick={enable} disabled={busy !== null}>
                <Smartphone size={18} aria-hidden="true" />
                {busy === "enable" ? "기기 등록 중…" : "이 기기에서 알림 받기"}
              </button>
            )}
          </div>
        ) : null}

        {error ? (
          <div className="medication-reminder-card__status">
            <span role="alert">{error}</span>
          </div>
        ) : null}
      </section>
    </Card>
  );
}
