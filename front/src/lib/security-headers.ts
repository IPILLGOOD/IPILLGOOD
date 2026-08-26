export type HeaderEntry = { key: string; value: string };

const FIREBASE_AUTH_CONNECT_SOURCES = [
  "https://identitytoolkit.googleapis.com",
  "https://securetoken.googleapis.com",
  "https://www.googleapis.com",
] as const;

const FIREBASE_AUTH_FRAME_SOURCES = [
  "https://care-atlas-seoul-2026-v2.firebaseapp.com",
  "https://accounts.google.com",
] as const;

export function contentSecurityPolicy(options: {
  development: boolean;
  nonce: string;
  upgradeInsecureRequests?: boolean;
}) {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${options.nonce}' 'strict-dynamic'${options.development ? " 'unsafe-eval'" : ""}`,
    options.development
      ? "style-src 'self' 'unsafe-inline'"
      : `style-src 'self' 'nonce-${options.nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self' ${FIREBASE_AUTH_CONNECT_SOURCES.join(" ")}`,
    `frame-src 'self' ${FIREBASE_AUTH_FRAME_SOURCES.join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (options.upgradeInsecureRequests) directives.push("upgrade-insecure-requests");
  return `${directives.join("; ")};`;
}

export const apiContentSecurityPolicy = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ") + ";";

export const serviceWorkerContentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "connect-src 'self'",
].join("; ") + ";";

export function commonSecurityHeaders(production: boolean): HeaderEntry[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "no-referrer" },
    {
      key: "Permissions-Policy",
      value: "browsing-topics=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    },
    { key: "X-Frame-Options", value: "DENY" },
    ...(production
      ? [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ]
      : []),
  ];
}

export function cspResponseHeaderName(mode: string | undefined) {
  return mode === "report-only"
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";
}
