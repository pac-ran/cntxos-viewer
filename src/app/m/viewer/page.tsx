"use client";

// Mobile viewer route: full-screen WrapperPanel + floating "→ chat" toggle.
// Reads ?actor= from URL.

import { useEffect, useState } from "react";
import { WrapperPanel } from "@/components/WrapperPanel";

const CONTENT_BG = "#F5F2E8";
const ORANGE = "#C2400C";

function readActor(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("actor") ?? "";
}

export default function MobileViewerPage() {
  const [actor, setActor] = useState<string>("");
  useEffect(() => { setActor(readActor()); }, []);

  const chatHref = actor
    ? `/m/chat?actor=${encodeURIComponent(actor)}`
    : `/m/chat`;

  return (
    <div className="relative h-screen w-screen overflow-hidden" style={{ background: CONTENT_BG }}>
      <WrapperPanel />
      <a
        href={chatHref}
        className="fixed top-2 right-2 z-50 text-[12px] px-3 py-1.5 border shadow-md"
        style={{
          borderColor: ORANGE,
          color: ORANGE,
          background: CONTENT_BG,
          textDecoration: "none",
          fontFamily: 'var(--font-inter), ui-sans-serif, system-ui, sans-serif',
        }}
        title="Switch to chat"
      >
        → chat
      </a>
    </div>
  );
}
