"use client";

// Mobile chat route: full-screen ChatPane + floating "→ viewer" toggle.
// Reads ?actor= from URL (ChatPane consumes it directly).
// Toggle button switches to /m/viewer?actor=<actor>, preserving the actor.

import { useEffect, useState } from "react";
import { ChatPane } from "@/components/ChatPane";

const CONTENT_BG = "#F5F2E8";
const ORANGE = "#C2400C";

function readActor(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("actor") ?? "";
}

export default function MobileChatPage() {
  const [actor, setActor] = useState<string>("");
  useEffect(() => { setActor(readActor()); }, []);

  const viewerHref = actor
    ? `/m/viewer?actor=${encodeURIComponent(actor)}`
    : `/m/viewer`;

  return (
    <div className="relative h-screen w-screen overflow-hidden" style={{ background: CONTENT_BG }}>
      <ChatPane mobile />
      <a
        href={viewerHref}
        className="fixed top-2 right-2 z-50 text-[12px] px-3 py-1.5 border shadow-md"
        style={{
          borderColor: ORANGE,
          color: ORANGE,
          background: CONTENT_BG,
          textDecoration: "none",
          fontFamily: 'var(--font-inter), ui-sans-serif, system-ui, sans-serif',
        }}
        title="Switch to viewer"
      >
        → viewer
      </a>
    </div>
  );
}
