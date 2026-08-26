import "server-only";

export { isSameOriginRequest } from "./request-origin";

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
