"use client";

import { useEffect, useState, useCallback } from "react";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import { deriveAffordances, filterByActor, type Affordance } from "@/lib/affordances";

interface FrameSlot {
  name: string;
  type: "surface" | "node" | "stream" | "walk" | "url";
  ref: string;
  anchor_slug?: string;
}

// Per-user resolution: the embedding workspace passes ?actor=<user>; the
// /api/frame-state response returns the resolved conv_id so this component
// subscribes to the right per-user node. Falls back to shared conv-frame-state
// when no actor is provided.
function readActor(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("actor");
}

function deriveLayout(count: number): "single" | "split" | "grid" {
  if (count <= 1) return "single";
  if (count === 2) return "split";
  return "grid";
}

export function WrapperPanel() {
  const [slots, setSlots] = useState<FrameSlot[] | null>(null);
  const [live, setLive] = useState(false);
  const [convId, setConvId] = useState<string | null>(null);
  const [actor, setActor] = useState<string | null>(null);
  const [devMode, setDevMode] = useState(false);
  useEffect(() => { setActor(readActor()); }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setDevMode(new URLSearchParams(window.location.search).get("dev") === "1");
  }, []);

  // Initial load via server-side API (service_role, bypasses RLS) —
  // returns slots + the resolved conv_id for the actor's frame-state
  useEffect(() => {
    const url = actor
      ? `/api/frame-state?actor=${encodeURIComponent(actor)}`
      : "/api/frame-state";
    fetch(url)
      .then(r => r.json())
      .then(({ slots: s, conv_id }: { slots: FrameSlot[]; conv_id?: string }) => {
        setSlots(Array.isArray(s) ? s : []);
        if (conv_id) setConvId(conv_id);
      })
      .catch(() => setSlots([]));
  }, [actor]);

  // Realtime subscription — bound to the resolved per-user conv_id
  useEffect(() => {
    if (!convId) return;
    const sb = getBrowserSupabase();
    const ch = sb
      .channel(`viewer:frame:${convId}`)
      .on("broadcast", { event: "refresh" }, () => {/* belt+suspenders */})
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "context_os", table: "events", filter: `subject_node_id=eq.${convId}` },
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
  }, [convId]);

  // frame-ack — emit a substrate event after every slot change so agents
  // have a return signal from the viewer. Per AC2 g-frame-ack-events-from-viewer
  // + ac2 stake 2026-05-12T01:43Z. Payload reports slot_count + known per-slot
  // status (slug resolution lives in NodeSlotView; we report what we know at
  // the viewer level — render attempt happened, slot count is N).
  useEffect(() => {
    if (!convId || !slots) return;
    const ackPayload = {
      slot_count: slots.length,
      slot_types: slots.map(s => s.type),
      slot_names: slots.map(s => s.name),
      actor_for: actor,
      success: true,
    };
    // Fire-and-forget. Failure to post ack is a soft failure — log only.
    fetch("/api/cx-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        node_slug: `conv-frame-state-${actor ?? "shared"}`,
        actor: "viewer",
        event_kind: "frame-ack",
        atomic_op: "render",
        outcome: slots.length > 0 ? "success" : "empty",
        payload: ackPayload,
      }),
    }).catch(() => { /* soft fail */ });
  }, [slots, convId, actor]);

  const layout = deriveLayout(slots?.length ?? 0);

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Header strip — diagnostic chrome (live dot + ACTOR label) is dev-only.
          FeedbackButtons stay always-visible for the operator. */}
      {(devMode || actor) && (
        <div
          className="shrink-0 flex items-center gap-3 py-2.5 border-b border-rule/30"
          style={{ paddingLeft: 20, paddingRight: 160 /* reserve space for workspace shell floating toolbar (layout presets + close) — re-applied 2026-05-10 after regression */ }}
        >
          {devMode && (
            <>
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${live ? "bg-green-500 animate-pulse" : "bg-muted/30"}`}
                title={live ? "connected" : "connecting"}
              />
              <span
                className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted"
                style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif' }}
              >
                {actor ? `${actor.toUpperCase()} viewer` : "viewer"}
              </span>
            </>
          )}

          {/* Feedback buttons — left-aligned next to the actor label.
              Per Randy mockup t-cc-viewer-feedback-buttons-mockup (2026-05-10):
              feedback cluster sits left of a vertical divider; layout/close cluster
              renders to the right via the workspace shell's floating toolbar.
              Original fix: c312c47. Regressed during P1; re-applied here. */}
          {actor && (
            <>
              <FeedbackButtons actor={actor} />
              <span
                aria-hidden
                className="border-l border-rule/40"
                style={{ alignSelf: "stretch", marginLeft: 4, marginRight: 4 }}
              />
            </>
          )}
        </div>
      )}

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

// Feedback buttons posted to substrate as user-feedback events (Randy 2026-05-09).
// Cross-origin: the workspace shell is on cntxos.com; we hit cntxos.com's
// /api/workspace/feedback so the cookie/auth flows through.
function FeedbackButtons({ actor }: { actor: string }) {
  const [last, setLast] = useState<string | null>(null);
  const send = async (action: "like" | "hold" | "next") => {
    setLast(action);
    try {
      await fetch("https://cntxos.com/api/workspace/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: actor, action }),
        credentials: "include",
      });
    } catch {/* best-effort */}
    setTimeout(() => setLast(null), 1500);
  };
  const items: Array<{a: "like"|"hold"|"next"; label: string}> = [
    { a: "like", label: "👍 like" },
    { a: "hold", label: "⏸ hold" },
    { a: "next", label: "→ next" },
  ];
  return (
    <div className="flex items-center gap-2">
      {items.map(({a, label}) => (
        <button
          key={a}
          onClick={() => send(a)}
          title={`feedback to driving agent: ${a}`}
          className={`font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 border transition-colors ${
            last === a
              ? "bg-accent text-bg border-accent"
              : "border-rule/40 text-muted hover:border-accent hover:text-accent"
          }`}
        >
          {label}
        </button>
      ))}
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

  if (slot.type === "walk") {
    return <WalkSlotView slot={slot} cls={cls} />;
  }

  if (slot.type === "url") {
    // Renders any URL as an iframe — agent-deployed surfaces (Supabase edge
    // functions, external pages). Per AC2 set_pane url slot type 2026-05-12.
    return (
      <iframe
        src={slot.ref}
        className={`${cls} border-0`}
        title={`slot:${slot.name}`}
        sandbox="allow-scripts allow-same-origin allow-forms"
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

// NodeAction was the legacy manual-config shape (node.payload.actions array).
// Replaced 2026-05-12 by derived Affordances from src/lib/affordances.ts.
// Per AC1 decision #5: P3 must explicitly delete the markdown-data-event
// button parsing in NodeViewer + replace payload.actions manual config.

// Walk slot — listens for cx-walk-rewalk window events (P2 of
// pr-derive-walk-from-button) and force-reloads the iframe so the operator
// sees mutated state instantly, without waiting on the 30s walk-cache TTL.
function WalkSlotView({ slot, cls }: { slot: FrameSlot; cls: string }) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const handler = () => setVersion(v => v + 1);
    window.addEventListener("cx-walk-rewalk", handler as EventListener);
    return () => window.removeEventListener("cx-walk-rewalk", handler as EventListener);
  }, []);
  const anchor = slot.anchor_slug ?? "";
  const src = `/api/cx-walk/${encodeURIComponent(slot.ref)}?anchor_slug=${encodeURIComponent(anchor)}${version > 0 ? `&v=${version}` : ""}`;
  return (
    <iframe
      src={src}
      className={`${cls} border-0`}
      title={`slot:${slot.name}`}
      sandbox="allow-scripts allow-same-origin"
    />
  );
}

function NodeSlotView({ ref_, name, cls }: { ref_: string; name: string; cls: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [nodePayload, setNodePayload] = useState<Record<string, unknown> | null>(null);
  const [nodeStatus, setNodeStatus] = useState<string | null>(null);
  const [nodeType, setNodeType] = useState<string | null>(null);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // role param drives gated affordance visibility (e.g. canon-promote only for randy/dl/ac1)
  const [role] = useState(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("role") ?? "randy"
      : "randy"
  );

  const load = useCallback(async () => {
    const [htmlText, nodeResult] = await Promise.all([
      fetch(`/api/cx-surface/${ref_}?f=1`, { cache: "no-store" })
        .then(r => (r.ok ? r.text() : ""))
        .catch(() => ""),
      fetch(`/api/node/${ref_}`)
        .then(r => r.ok ? r.json() : null)
        .then((d: { node?: { id?: string; node_type?: string; status?: string; payload?: Record<string, unknown> } } | null) => d?.node ?? null)
        .catch(() => null),
    ]);
    setHtml(htmlText);
    setNodePayload(nodeResult?.payload ?? null);
    setNodeStatus(nodeResult?.status ?? null);
    setNodeType(nodeResult?.node_type ?? null);
    if (nodeResult?.id) setNodeId(nodeResult.id);
  }, [ref_]);

  useEffect(() => { load(); }, [load]);

  // Per-slot Realtime subscription — fires load() when events insert for this node
  useEffect(() => {
    if (!nodeId) return;
    const sb = getBrowserSupabase();
    const ch = sb
      .channel(`viewer:slot:${nodeId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "context_os",
          table: "events",
          filter: `subject_node_id=eq.${nodeId}`,
        },
        () => { load(); }
      )
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [nodeId, load]);

  // Dispatch an affordance — branches by op type per pr-derive-walk-from-button.
  // Replaces the legacy field/value action handler (which only knew about
  // node-field updates). Now handles transitions, walk invocations, event
  // posts, archives. After any mutation, re-load + signal walk slots to rewalk.
  const handleAffordance = useCallback(async (a: Affordance) => {
    setActionError(null);
    try {
      if (a.op === "transition" && a.to) {
        const res = await fetch("/api/node-update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: ref_, field: "status", value: a.to }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "transition failed");
      } else if (a.op === "archive") {
        const res = await fetch("/api/node-update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: ref_, field: "status", value: "archived" }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "archive failed");
      } else if (a.op === "walk" && a.walk) {
        const res = await fetch("/api/cx-walk/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ walk_slug: a.walk, anchor_slug: ref_, allow_mutations: true }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "walk failed");
        // Signal walk slots to rewalk per pr-derive-walk-from-button instant-rewalk pattern
        try { window.dispatchEvent(new Event("cx-walk-rewalk")); } catch { /* ignore */ }
      } else if (a.op === "event" && a.event_kind) {
        const res = await fetch("/api/cx-event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            node_slug: ref_,
            actor: role,
            event_kind: a.event_kind,
            atomic_op: "write",
            outcome: a.outcome,
            payload: a.payload ?? {},
          }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "event post failed");
      } else if (a.op === "edit") {
        // Edit opens the node in the cntxos workspace's NodeEditor shape.
        // The viewer renders inside a workspace iframe, so we postMessage
        // up to the parent. The workspace listens and swaps its left-pane
        // shape to node-editor for this slug. Custom events don't cross
        // iframe boundaries; postMessage does.
        try {
          if (typeof window !== "undefined" && window.parent && window.parent !== window) {
            window.parent.postMessage({ type: "cx-edit-node", slug: ref_ }, "*");
          } else {
            // Fallback for standalone viewer page (not embedded): same-window event
            window.dispatchEvent(new CustomEvent("cx-edit-node", { detail: { slug: ref_ } }));
          }
        } catch { /* ignore */ }
      }
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [ref_, load, role]);

  if (html === null) {
    return (
      <div className={`${cls} flex items-center justify-center`}>
        <span className="font-mono text-[11px] text-muted animate-pulse">{name}…</span>
      </div>
    );
  }

  const lensText  = (nodePayload?.lenses as Record<string, string> | undefined)?.[role] ?? "";
  const nextText  = (nodePayload?.next   as Record<string, string> | undefined)?.[role] ?? "";
  // Affordances are now DERIVED from node intrinsics (status + node_type +
  // payload overrides), not configured per-node. Per pr-derive-walk-from-button
  // P3 — replaces the old payload.actions manual config.
  const affordances: Affordance[] = filterByActor(
    deriveAffordances({
      slug: ref_,
      node_type: nodeType ?? undefined,
      status: nodeStatus,
      payload: nodePayload,
    }),
    role
  );

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

      {affordances.length > 0 && (
        <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2">
          {affordances.map((a, i) => {
            // Plain-English explanation of what the click will do, per
            // Randy 2026-05-13: "if they are buttons, please fix them and
            // put some help text so we know what they do".
            const helpText =
              a.op === "transition" && a.to === "review"
                ? "Submit this draft for review. Status changes from draft to review."
                : a.op === "transition" && a.to === "canon"
                  ? "Promote this node to canon (the durable, walked truth). Reversible by sending back to draft."
                  : a.op === "transition" && a.to === "draft"
                    ? "Send this back to draft so the author can keep editing."
                    : a.op === "transition"
                      ? `Change status to ${a.to}.`
                      : a.op === "walk"
                        ? `Run walk: ${a.walk}.`
                        : a.op === "edit"
                          ? "Open this node in the cntxos workspace editor (left pane). Edit content + tags, save back to substrate."
                          : a.op === "archive"
                            ? "Archive: hide from default views, keep in substrate. Reversible."
                            : a.op;
            return (
              <button
                key={`${a.op}-${a.label}-${i}`}
                onClick={() => handleAffordance(a)}
                title={helpText}
                aria-label={`${a.label} — ${helpText}`}
                className="font-mono text-[10px] border border-rule/40 px-2 py-0.5 hover:border-rule/80 text-muted hover:text-ink transition-colors"
              >
                {a.label}
              </button>
            );
          })}
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
