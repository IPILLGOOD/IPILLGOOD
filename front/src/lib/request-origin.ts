export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  if (origin === new URL(request.url).origin) return true;

  // Chromium can serialize a same-origin top-level form POST as an opaque
  // origin after a strict response policy is applied. Fetch Metadata headers
  // are browser-controlled, so only that explicit same-origin case is safe.
  return origin === "null" && request.headers.get("sec-fetch-site") === "same-origin";
}

/** Browser-only mutation gate; Next's internal URL can differ from the incoming Host. */
export function isSameOriginBrowserRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return request.headers.get("sec-fetch-site") === "same-origin";
  try {
    const target = new URL(request.url);
    const host = request.headers.get("host");
    // Host is the actual HTTP authority, not a client-supplied X-Forwarded-Host override.
    if (host) target.host = host;
    return origin === target.origin;
  } catch { return false; }
}
