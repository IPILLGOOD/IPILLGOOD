import "server-only";

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export function isAllowedPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return (
      host === "fcm.googleapis.com" ||
      host.endsWith(".push.apple.com") ||
      host.endsWith(".push.services.mozilla.com")
    );
  } catch {
    return false;
  }
}
