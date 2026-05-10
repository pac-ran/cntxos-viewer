// Mobile (/m) subtree layout — sets the mobile-friendly viewport meta and
// shared cream surface for /m/chat and /m/viewer.

import type { Metadata, Viewport } from "next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "cntxos · mobile",
};

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
