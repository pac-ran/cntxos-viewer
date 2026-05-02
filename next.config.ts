import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/cx-surface/:path*",
        destination: "http://localhost:3000/api/cx-surface/:path*",
      },
      {
        source: "/api/cx-walk-stream/:path*",
        destination: "http://localhost:3000/api/cx-walk-stream/:path*",
      },
      {
        source: "/api/node-update",
        destination: "http://localhost:3000/api/node-update",
      },
    ];
  },
};

export default nextConfig;
