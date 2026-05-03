"use client";

import { useEffect, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";

type WorkStatus = "inbox" | "in-progress" | "done";

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

  useEffect(() => { load(); }, [load]);

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
      {/* Header strip */}
      <div className="shrink-0 border-b border-rule/30 px-5 py-3 flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[13px] font-bold text-ink">{node.slug}</span>
          <span className="font-mono text-[9px] border border-rule/40 px-1.5 py-0.5 text-muted uppercase tracking-wide">{node.node_type}</span>
          <span className={`font-mono text-[9px] border px-1.5 py-0.5 uppercase tracking-wide ${node.status === "canon" ? "border-green-600/50 text-green-700" : "border-rule/30 text-muted"}`}>
            {node.status}
          </span>
          <button
            onClick={onEdit}
            className="ml-auto text-[11px] border border-accent/60 px-2.5 py-0.5 text-accent hover:bg-accent hover:text-bg transition-colors"
          >
            edit →
          </button>
        </div>
        <div className="font-mono text-[9px] text-dim">{String(node.scope)}</div>
        {/* work_status — read-only indicator */}
        <div className="flex gap-px">
          {(["inbox", "in-progress", "done"] as WorkStatus[]).map(ws => (
            <span
              key={ws}
              className={`font-mono text-[9px] uppercase tracking-wide px-2.5 py-1 border ${
                node.work_status === ws
                  ? "bg-ink text-bg border-ink"
                  : "border-rule/20 text-dim"
              }`}
            >
              {STATUS_LABELS[ws]}
            </span>
          ))}
        </div>
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
                className="font-mono text-[10px] border border-rule/30 px-1.5 py-0.5 text-muted"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Activity feed */}
        {events.length > 0 && (
          <div className="border-t border-rule/20 pt-3">
            <div className="text-[10px] uppercase tracking-widest text-dim mb-2">activity</div>
            <div className="flex flex-col gap-1.5">
              {events.map((ev, i) => (
                <div key={i} className="flex items-baseline gap-2 font-mono text-[10px]">
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
