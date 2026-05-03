import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["viewer.cntxos.com"],
  async rewrites() {
    return [
{
        source: "/api/cx-walk-stream/:path*",
        destination: "https://cntxos.com/api/cx-walk-stream/:path*",
      },
    ];
  },
};

export default nextConfig;
