"use client";

import { useEffect, useState } from "react";
import { WrapperPanel } from "@/components/WrapperPanel";
import { ChatPane } from "@/components/ChatPane";

const CONTENT_BG = "#F5F2E8";
const RULE = "#B8B09C";

// DS slug — each actor gets their own DS conversation history.
// Soul is shared (n-boot-prompt-ds-onboard) until per-user mooring nodes are staked at onboarding.
const DS_SLUG = "n-boot-prompt-ds-onboard";

function readActor(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("actor");
}

type ChatSize = "closed" | "half" | "full";

function readChatSize(actor: string | null): ChatSize {
  if (!actor || typeof window === "undefined") return "half";
  try {
    const raw = localStorage.getItem(`chat-open-${actor}`);
    if (raw === "0") return "closed";
    if (raw === "1") return "half";
    if (raw === "closed" || raw === "half" || raw === "full") return raw;
  } catch { /* ignore */ }
  return "half";
}

export default function AgentPanePage() {
  const [chatSize, setChatSize] = useState<ChatSize>("half");

  useEffect(() => {
    const a = readActor();
    setChatSize(readChatSize(a));

    const onCustom = (e: Event) => {
      const ce = e as CustomEvent<{ size?: ChatSize; open?: boolean }>;
      if (ce.detail?.size === "closed" || ce.detail?.size === "half" || ce.detail?.size === "full") {
        setChatSize(ce.detail.size);
      } else if (typeof ce.detail?.open === "boolean") {
        setChatSize(ce.detail.open ? "half" : "closed");
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (!e.key?.startsWith("chat-open-")) return;
      const v = e.newValue;
      if (v === "0") setChatSize("closed");
      else if (v === "1") setChatSize("half");
      else if (v === "closed" || v === "half" || v === "full") setChatSize(v);
    };
    const id = window.setInterval(() => {
      const a2 = readActor();
      setChatSize(prev => {
        const next = readChatSize(a2);
        return prev === next ? prev : next;
      });
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
  const showChat   = chatSize !== "closed";

  return (
    <div className="flex flex-col h-screen" style={{ background: CONTENT_BG }}>
      {showViewer && (
        <div className="flex-1 min-h-0 overflow-hidden" style={{ background: CONTENT_BG }}>
          <WrapperPanel />
        </div>
      )}
      {showChat && (
        <div
          className={`${showViewer ? "flex-1 border-t" : "flex-1"} min-h-0 overflow-hidden`}
          style={{ borderColor: showViewer ? `${RULE}80` : undefined }}
        >
          <ChatPane agentSlug={DS_SLUG} />
        </div>
      )}
      {!showChat && (
        <ChatPane agentSlug={DS_SLUG} />
      )}
    </div>
  );
}
