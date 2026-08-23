const FIREBASE_AUTH_ORIGIN = "https://care-atlas-seoul-2026-v2.firebaseapp.com";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

function safeAuthPath(path: string[]) {
  if (!path.length || path.some((segment) => !/^[a-zA-Z0-9._-]+$/.test(segment))) {
    return null;
  }
  return path.map(encodeURIComponent).join("/");
}

async function proxyFirebaseAuth(request: Request, context: RouteContext) {
  const { path } = await context.params;
  const safePath = safeAuthPath(path);
  if (!safePath) return new Response("Not found", { status: 404 });

  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(`/__/auth/${safePath}${incomingUrl.search}`, FIREBASE_AUTH_ORIGIN);
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.delete("cookie");
  headers.delete("content-length");
  headers.delete("host");
  for (const name of [...headers.keys()]) {
    if (name.startsWith("cf-")) headers.delete(name);
  }

  const upstream = await fetch(targetUrl, {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer(),
    redirect: "manual",
  });
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  const location = responseHeaders.get("location");
  if (location) {
    const redirectUrl = new URL(location, FIREBASE_AUTH_ORIGIN);
    if (redirectUrl.origin === FIREBASE_AUTH_ORIGIN) {
      redirectUrl.protocol = incomingUrl.protocol;
      redirectUrl.host = incomingUrl.host;
      responseHeaders.set("location", redirectUrl.toString());
    }
  }
  responseHeaders.set("Cache-Control", "no-store");
  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const GET = proxyFirebaseAuth;
export const POST = proxyFirebaseAuth;
export const HEAD = proxyFirebaseAuth;
export const OPTIONS = proxyFirebaseAuth;
