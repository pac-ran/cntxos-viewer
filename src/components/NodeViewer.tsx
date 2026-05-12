"use client";

import { useEffect, useState, useCallback } from "react";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import ReactMarkdown from "react-markdown";

type WorkStatus = "inbox" | "in-progress" | "done";

// 2026-05-12 P3 — markdown-data-event interactive slots DELETED per AC1 decision.
// The old pattern parsed `- [ ] option {event: "x", value: "y"}` syntax in
// markdown content into clickable checkbox buttons. It's now replaced by
// affordance-derived buttons rendered in NodeSlotView (WrapperPanel.tsx) via
// deriveAffordances() in @/lib/affordances. Buttons emerge from node intrinsics
// (status + node_type + payload overrides), not from markdown content syntax.
// If you need an inline interactive element, drop a walk slot or a url slot.

interface NodeRow {
  id: string;
  slug: string;
  node_type: string;
  status: string;
  work_status: WorkStatus;
  content: string | null;
  tags: string[];
  scope: string;
  payload: Record<string, unknown>;
  visibility?: string;
}

interface ActivityEvent {
  event_kind: string;
  actor: string;
  occurred_at: string;
  outcome: string | null;
}

const STATUS_LABELS: Record<WorkStatus, string> = {
  inbox: "inbox",
  "in-progress": "in progress",
  done: "done",
};

// (Old SLOT_PATTERN + remarkInteractiveSlots plugin removed 2026-05-12 P3.)

export function NodeViewer({ slug, onEdit }: { slug: string; onEdit: () => void }) {
  const [node, setNode] = useState<NodeRow | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/node/${slug}`);
    if (!res.ok) { setNotFound(true); return; }
    const { node: row, events: evts } = await res.json() as {
      node: NodeRow | null;
      events: ActivityEvent[];
      actionManifest: string | null;
      tagsVocab: string[];
    };
    if (!row) { setNotFound(true); return; }
    setNode(row);
    setEvents(evts ?? []);
  }, [slug]);

  // 2026-05-12 P3: postSlotEvent removed. Derived affordances in
  // WrapperPanel/NodeSlotView handle button → walk dispatch now (per
  // pr-derive-walk-from-button + p-buttons-emerge-from-node-shape canon).

  useEffect(() => { load(); }, [load]);

  // Realtime subscription — auto-refresh when an event is inserted for this node
  useEffect(() => {
    if (!node?.id) return;
    const supabase = getBrowserSupabase();
    const channel = supabase
      .channel(`node-viewer-${node.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "context_os", table: "events", filter: `subject_node_id=eq.${node.id}` },
        () => { load(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [node?.id, load]);

  // (Custom markdown li renderer removed 2026-05-12 P3 — no more in-content
  // interactive slots. ReactMarkdown renders lists with defaults now.)

  if (notFound) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="font-mono text-[11px] text-muted">node not found: {slug}</span>
      </div>
    );
  }

  if (!node) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="font-mono text-[11px] text-muted animate-pulse">loading…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header strip — edit on LEFT (controls THIS pane), then identity.
           Metadata (type / status) rendered as inline-text labels with prefix
           (Randy 2026-05-09: bordered chips looked like buttons / clickable;
           now clearly read-only metadata). */}
      <div className="shrink-0 border-b border-rule px-5 py-3 flex flex-col gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={onEdit}
            className="text-[12px] font-semibold border border-accent px-3 py-1 text-accent hover:bg-accent hover:text-bg transition-colors"
          >
            edit
          </button>
          <span className="font-mono text-[13px] font-bold text-ink">{node.slug}</span>
          <span className="text-[11px] text-muted">
            <span className="text-dim">type:</span>{" "}
            <span className={node.node_type === "task" ? "text-accent" : "text-ink"}>
              {node.node_type}
            </span>
          </span>
          <span className="text-[11px] text-muted">
            <span className="text-dim">status:</span>{" "}
            <span className={node.status === "canon" ? "text-green-700 font-semibold" : "text-ink"}>
              {node.status}
            </span>
          </span>
        </div>
        <div className="font-mono text-[11px] text-dim">{String(node.scope)}</div>
        {/* work_status — only show for task nodes (per Randy 2026-05-09:
             pills on document/principle/etc looked like content tabs and
             did nothing; remove visual confusion). */}
        {node.node_type === "task" && (
          <div className="flex gap-px">
            {(["inbox", "in-progress", "done"] as WorkStatus[]).map(ws => (
              <span
                key={ws}
                className={`font-mono text-[11px] uppercase tracking-wide px-2.5 py-1 border ${
                  node.work_status === ws
                    ? "bg-ink text-bg border-ink"
                    : "border-rule/20 text-dim"
                }`}
              >
                {STATUS_LABELS[ws]}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Content + tags + activity */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-4">

        {/* Content */}
        {node.content ? (
          <div className="prose-node">
            <ReactMarkdown>{node.content}</ReactMarkdown>
          </div>
        ) : (
          <div className="text-[13px] text-dim italic">no content</div>
        )}

        {/* Tags */}
        {node.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {node.tags.map(tag => (
              <span
                key={tag}
                className="font-mono text-[11px] border border-rule/60 px-1.5 py-0.5 text-muted"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Activity feed */}
        {events.length > 0 && (
          <div className="border-t border-rule/20 pt-3">
            <div className="text-[11px] uppercase tracking-widest text-dim mb-2">activity</div>
            <div className="flex flex-col gap-1.5">
              {events.map((ev, i) => (
                <div key={i} className="flex items-baseline gap-2 font-mono text-[11px]">
                  <span className="text-dim shrink-0">
                    {new Date(ev.occurred_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="text-muted shrink-0">{ev.actor}</span>
                  <span className="text-muted">{ev.event_kind}</span>
                  {ev.outcome && <span className="text-dim">→ {ev.outcome}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
