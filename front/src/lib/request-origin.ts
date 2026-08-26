export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  if (origin === new URL(request.url).origin) return true;

  // Chromium can serialize a same-origin top-level form POST as an opaque
  // origin after a strict response policy is applied. Fetch Metadata headers
  // are browser-controlled, so only that explicit same-origin case is safe.
  return origin === "null" && request.headers.get("sec-fetch-site") === "same-origin";
}
