"use client";

// Per Randy 2026-05-09: agent (right) pane is its own standalone route.
// Embedded by workspace as a separate iframe; not coupled to the editor pane.
//
// 2026-05-10 v2 design pass (Randy): cream everywhere — viewer + chat share
// the same #F5F2E8 surface. When chat is closed, its region is removed from
// the layout entirely so WrapperPanel fills the full height; ChatPane renders
// only a floating "Open chat" button bottom-right.

import { useEffect, useState } from "react";
import { WrapperPanel } from "@/components/WrapperPanel";
import { ChatPane } from "@/components/ChatPane";

const CONTENT_BG = "#F5F2E8";
const RULE = "#B8B09C";

function readActor(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("actor");
}

function readChatOpen(actor: string | null): boolean {
  if (!actor || typeof window === "undefined") return true;
  try {
    const raw = localStorage.getItem(`chat-open-${actor}`);
    if (raw === "0") return false;
    if (raw === "1") return true;
  } catch { /* ignore */ }
  return true;
}

export default function AgentPanePage() {
  // Default to true server-side & on first paint to avoid hydration flicker.
  // The ChatPane component is the source of truth for the persisted value;
  // this layout-level mirror is only used to decide whether to reserve flex
  // space for the chat region.
  const [chatOpen, setChatOpen] = useState<boolean>(true);

  useEffect(() => {
    const actor = readActor();
    setChatOpen(readChatOpen(actor));

    // ChatPane writes to localStorage on toggle. We can't observe same-tab
    // localStorage writes via the storage event, so ChatPane is expected to
    // also dispatch a CustomEvent("chat-open-change", { detail: { open } }).
    // Until that wires up cleanly, we poll on a quick interval — the cost is
    // trivial and the UX is correct.
    const onCustom = (e: Event) => {
      const ce = e as CustomEvent<{ open?: boolean }>;
      if (typeof ce.detail?.open === "boolean") setChatOpen(ce.detail.open);
    };
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (e.key.startsWith("chat-open-")) {
        setChatOpen(e.newValue === "0" ? false : true);
      }
    };
    const id = window.setInterval(() => {
      const a = readActor();
      const next = readChatOpen(a);
      setChatOpen((prev) => (prev === next ? prev : next));
    }, 400);
    window.addEventListener("chat-open-change", onCustom as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("chat-open-change", onCustom as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return (
    <div className="flex flex-col h-screen" style={{ background: CONTENT_BG }}>
      <div
        className="flex-1 min-h-0 overflow-hidden"
        style={{ background: CONTENT_BG }}
      >
        <WrapperPanel />
      </div>
      {chatOpen && (
        <div
          className="flex-[2] min-h-0 overflow-hidden border-t"
          style={{ borderColor: `${RULE}80` }}
        >
          <ChatPane />
        </div>
      )}
      {/* When closed, ChatPane renders ONLY a fixed-position floating button.
          Mounting it outside the flex region ensures no reserved space. */}
      {!chatOpen && <ChatPane />}
    </div>
  );
}
