import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@care-atlas/backend"],
  experimental: {
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
