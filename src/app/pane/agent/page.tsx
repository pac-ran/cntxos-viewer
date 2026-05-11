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

type ChatSize = "closed" | "half" | "full";

function readChatSize(actor: string | null): ChatSize {
  if (!actor || typeof window === "undefined") return "half";
  try {
    const raw = localStorage.getItem(`chat-open-${actor}`);
    // Backwards compat with the boolean era
    if (raw === "0") return "closed";
    if (raw === "1") return "half";
    if (raw === "closed" || raw === "half" || raw === "full") return raw;
  } catch { /* ignore */ }
  return "half";
}

export default function AgentPanePage() {
  // 3-state chat sizing per Randy 2026-05-11: closed | half | full.
  // Layout reacts: closed → viewer full; half → 50/50; full → chat full, viewer hidden.
  // ChatPane is source of truth for the persisted value; this mirror decides flex.
  const [chatSize, setChatSize] = useState<ChatSize>("half");

  useEffect(() => {
    const actor = readActor();
    setChatSize(readChatSize(actor));

    const onCustom = (e: Event) => {
      const ce = e as CustomEvent<{ size?: ChatSize; open?: boolean }>;
      if (ce.detail?.size === "closed" || ce.detail?.size === "half" || ce.detail?.size === "full") {
        setChatSize(ce.detail.size);
      } else if (typeof ce.detail?.open === "boolean") {
        // Back-compat: chat-open-change fires {open:bool}
        setChatSize(ce.detail.open ? "half" : "closed");
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (!e.key || !e.key.startsWith("chat-open-")) return;
      const v = e.newValue;
      if (v === "0") setChatSize("closed");
      else if (v === "1") setChatSize("half");
      else if (v === "closed" || v === "half" || v === "full") setChatSize(v);
    };
    const id = window.setInterval(() => {
      const a = readActor();
      const next = readChatSize(a);
      setChatSize((prev) => (prev === next ? prev : next));
    }, 400);
    window.addEventListener("chat-size-change", onCustom as EventListener);
    window.addEventListener("chat-open-change", onCustom as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("chat-size-change", onCustom as EventListener);
      window.removeEventListener("chat-open-change", onCustom as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const showViewer = chatSize !== "full";
  const showChat = chatSize !== "closed";

  return (
    <div className="flex flex-col h-screen" style={{ background: CONTENT_BG }}>
      {showViewer && (
        <div
          className="flex-1 min-h-0 overflow-hidden"
          style={{ background: CONTENT_BG }}
        >
          <WrapperPanel />
        </div>
      )}
      {showChat && (
        <div
          className={`${showViewer ? "flex-1 border-t" : "flex-1"} min-h-0 overflow-hidden`}
          style={{ borderColor: showViewer ? `${RULE}80` : undefined }}
        >
          <ChatPane />
        </div>
      )}
      {/* When closed, ChatPane renders ONLY a fixed-position floating button.
          Mounting it outside the flex region ensures no reserved space. */}
      {!showChat && <ChatPane />}
    </div>
  );
}
