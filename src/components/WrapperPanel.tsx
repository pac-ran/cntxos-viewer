"use client";

import { useEffect, useState, useCallback } from "react";
import { getBrowserSupabase } from "@/lib/supabase-browser";

interface FrameSlot {
  name: string;
  type: "surface" | "node" | "stream";
  ref: string;
}

const CONV_FRAME_STATE_ID = "cd315a53-396a-4ead-bf88-67da32083a3d";

function deriveLayout(count: number): "single" | "split" | "grid" {
  if (count <= 1) return "single";
  if (count === 2) return "split";
  return "grid";
}

export function WrapperPanel() {
  const [slots, setSlots] = useState<FrameSlot[] | null>(null);
  const [live, setLive] = useState(false);

  // Initial load via server-side API (service_role, bypasses RLS)
  useEffect(() => {
    fetch("/api/frame-state")
      .then(r => r.json())
      .then(({ slots: s }: { slots: FrameSlot[] }) => {
        setSlots(Array.isArray(s) ? s : []);
      })
      .catch(() => setSlots([]));
  }, []);

  // Realtime subscription — anon key, conv-frame-state is public
  useEffect(() => {
    const sb = getBrowserSupabase();
    const ch = sb
      .channel("viewer:frame")
      .on("broadcast", { event: "refresh" }, () => {/* belt+suspenders */})
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "context_os", table: "events", filter: `subject_node_id=eq.${CONV_FRAME_STATE_ID}` },
        (payload) => {
          if ((payload.new as Record<string, unknown>)?.event_kind !== "frame-update") return;
          const evPayload = (payload.new as Record<string, unknown>).payload as { slots?: FrameSlot[]; mode?: string } | undefined;
          const newSlots = evPayload?.slots ?? [];
          if (evPayload?.mode === "append") {
            setSlots(prev => [...(prev ?? []), ...newSlots]);
          } else {
            setSlots(newSlots);
          }
        }
      )
      .subscribe((s) => setLive(s === "SUBSCRIBED"));

    return () => { sb.removeChannel(ch); };
  }, []);

  const layout = deriveLayout(slots?.length ?? 0);

  return (
    <div className="flex flex-col h-full bg-bg">
      <div className="shrink-0 flex items-center gap-3 px-5 py-2.5 border-b border-rule/30">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${live ? "bg-green-500 animate-pulse" : "bg-muted/30"}`}
          title={live ? "connected" : "connecting"}
        />
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted">CC</span>
      </div>

      {slots === null && (
        <div className="flex-1 flex items-center justify-center">
          <span className="font-mono text-[11px] text-muted animate-pulse">connecting to substrate…</span>
        </div>
      )}
      {slots !== null && slots.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <span className="font-mono text-[11px] text-muted italic">
            no active frame — post a frame-update event to begin
          </span>
        </div>
      )}
      {slots !== null && slots.length > 0 && (
        <div
          className={`flex-1 min-h-0 ${
            layout === "single" ? "flex" :
            layout === "split"  ? "grid grid-cols-2 gap-px" :
            "grid grid-cols-2 auto-rows-fr gap-px"
          }`}
        >
          {slots.map((slot) => (
            <SlotView key={slot.name} slot={slot} fill={layout === "single"} />
          ))}
        </div>
      )}
    </div>
  );
}

function SlotView({ slot, fill }: { slot: FrameSlot; fill: boolean }) {
  const cls = `${fill ? "flex-1 " : ""}w-full min-h-0`;

  if (slot.type === "surface") {
    return (
      <iframe
        src={`/api/cx-surface/${slot.ref}`}
        className={`${cls} border-0`}
        title={`slot:${slot.name}`}
        sandbox="allow-scripts allow-same-origin"
      />
    );
  }

  if (slot.type === "stream") {
    const qIdx = slot.ref.indexOf("?");
    const refSlug = qIdx >= 0 ? slot.ref.slice(0, qIdx) : slot.ref;
    const refQuery = qIdx >= 0 ? slot.ref.slice(qIdx) : "";
    const src = `/api/cx-walk-stream/${encodeURIComponent(refSlug)}${refQuery}`;
    return (
      <iframe
        src={src}
        className={`${cls} border-0`}
        title={`slot:${slot.name}`}
        sandbox="allow-scripts allow-same-origin"
      />
    );
  }

  return <NodeSlotView ref_={slot.ref} name={slot.name} cls={cls} />;
}

interface NodeAction {
  label: string;
  field: string;
  value: unknown;
}

function NodeSlotView({ ref_, name, cls }: { ref_: string; name: string; cls: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [nodePayload, setNodePayload] = useState<Record<string, unknown> | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [role] = useState(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("role") ?? "randy"
      : "randy"
  );

  const load = useCallback(async () => {
    const [htmlText, payloadResult] = await Promise.all([
      fetch(`/api/cx-surface/${ref_}?f=1`, { cache: "no-store" })
        .then(r => (r.ok ? r.text() : ""))
        .catch(() => ""),
      fetch(`/api/node/${ref_}`)
        .then(r => r.ok ? r.json() : null)
        .then((d: { node?: { payload?: Record<string, unknown> } } | null) => d?.node?.payload ?? null)
        .catch(() => null),
    ]);
    setHtml(htmlText);
    setNodePayload(payloadResult);
  }, [ref_]);

  useEffect(() => { load(); }, [load]);

  const handleAction = useCallback(async (field: string, value: unknown) => {
    setActionError(null);
    const res = await fetch("/api/node-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: ref_, field, value }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      setActionError(err.error ?? "Action failed");
      return;
    }
    await load();
  }, [ref_, load]);

  if (html === null) {
    return (
      <div className={`${cls} flex items-center justify-center`}>
        <span className="font-mono text-[11px] text-muted animate-pulse">{name}…</span>
      </div>
    );
  }

  const lensText  = (nodePayload?.lenses as Record<string, string> | undefined)?.[role] ?? "";
  const nextText  = (nodePayload?.next   as Record<string, string> | undefined)?.[role] ?? "";
  const actionList: NodeAction[] = Array.isArray(nodePayload?.actions)
    ? (nodePayload!.actions as NodeAction[])
    : [];

  return (
    <div className={`${cls} flex flex-col`}>
      {!dismissed && nextText && (
        <div
          className="shrink-0 flex items-start gap-2 px-3 py-2 border-b"
          style={{ background: "#1c1800", borderColor: "#4a3800" }}
        >
          <span className="flex-1 font-mono text-[11px] leading-relaxed" style={{ color: "#d4b46a" }}>
            Your next step: {nextText}
          </span>
          <button
            onClick={() => setDismissed(true)}
            className="shrink-0 font-mono text-[12px] leading-none opacity-60 hover:opacity-100 transition-opacity"
            style={{ color: "#d4b46a" }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {lensText && (
        <div className="shrink-0 mx-3 mt-2 px-2 py-1.5 border-l-2 border-rule/40 font-mono text-[11px] text-muted leading-relaxed">
          {lensText}
        </div>
      )}

      {actionList.length > 0 && (
        <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2">
          {actionList.map((action, i) => (
            <button
              key={i}
              onClick={() => handleAction(action.field, action.value)}
              className="font-mono text-[10px] border border-rule/40 px-2 py-0.5 hover:border-rule/80 text-muted hover:text-ink transition-colors"
            >
              {action.label}
            </button>
          ))}
          {actionError && (
            <span className="font-mono text-[10px] text-red-400">{actionError}</span>
          )}
        </div>
      )}

      <div
        className="flex-1 min-h-0 overflow-auto"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
