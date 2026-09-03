const CACHE_VERSION = "ipillgood-shell-v2";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith("ipillgood-") && key !== CACHE_VERSION).map((key) => caches.delete(key))),
      ),
    ]),
  );
});

function safeAppUrl(rawUrl) {
  try {
    const url = new URL(rawUrl || "/today", self.location.origin);
    if (url.origin !== self.location.origin) return "/today";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/today";
  }
}

async function reportDeliveryReceipt(deliveryId, receipt) {
  if (!/^[a-f0-9]{48}$/.test(deliveryId || "")) return;
  try {
    await fetch("/api/push/receipts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ deliveryId, receipt }),
    });
  } catch {
    // The notification remains useful even if the optional receipt cannot be recorded.
  }
}

async function mayDisplayPush(data) {
  if (!data?.subscriptionId || !data?.bindingId) return false;
  try {
    const response = await fetch("/api/push/authorize", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ subscriptionId: data.subscriptionId, bindingId: data.bindingId }),
    });
    return response.status === 204;
  } catch { return false; }
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = {};
  }

  const title = payload.title || "IPILLGOOD 알림";
  const data = {
    ...(payload.data && typeof payload.data === "object" ? payload.data : {}),
    url: safeAppUrl(payload.data?.url),
  };
  event.waitUntil(
    (async () => {
      if (!await mayDisplayPush(data)) return;
      await self.registration.showNotification(title, {
        body: payload.body || "오늘의 돌봄 일정을 확인해 주세요.",
        icon: payload.icon || "/icons/pwa-192.png",
        badge: payload.badge || "/icons/pwa-192.png",
        tag: payload.tag || "ipillgood-care-reminder",
        lang: payload.lang || "ko-KR",
        timestamp: payload.timestamp || Date.now(),
        requireInteraction: payload.requireInteraction === true,
        data,
      });
      await reportDeliveryReceipt(data.deliveryId, "displayed");
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = safeAppUrl(data.url);
  event.waitUntil(
    (async () => {
      if (!await mayDisplayPush(data)) return;
      await reportDeliveryReceipt(data.deliveryId, "clicked");
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const targetPath = new URL(targetUrl, self.location.origin).pathname;
      const existing = windows.find(
        (client) => new URL(client.url).pathname === targetPath,
      );
      if (existing) {
        if ("navigate" in existing) await existing.navigate(targetUrl);
        return existing.focus();
      }
      return self.clients.openWindow(targetUrl);
    })(),
  );
});
