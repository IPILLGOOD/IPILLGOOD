import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

import {
  apiContentSecurityPolicy,
  commonSecurityHeaders,
  serviceWorkerContentSecurityPolicy,
} from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@care-atlas/backend"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: commonSecurityHeaders(process.env.NODE_ENV === "production"),
      },
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: apiContentSecurityPolicy,
          },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Security-Policy",
            value: serviceWorkerContentSecurityPolicy,
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/__/auth/:path*",
        destination: "/api/firebase-auth/:path*",
      },
    ];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;

initOpenNextCloudflareForDev();
