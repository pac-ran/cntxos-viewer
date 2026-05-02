import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/cx-surface/:path*",
        destination: "https://cntxos.com/api/cx-surface/:path*",
      },
      {
        source: "/api/cx-walk-stream/:path*",
        destination: "https://cntxos.com/api/cx-walk-stream/:path*",
      },
      {
        source: "/api/node-update",
        destination: "https://cntxos.com/api/node-update",
      },
    ];
  },
};

export default nextConfig;
