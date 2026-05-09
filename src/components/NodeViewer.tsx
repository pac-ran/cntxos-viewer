"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import ReactMarkdown from "react-markdown";
import type { Plugin } from "unified";
import type { Root, ListItem, Paragraph, Text } from "mdast";
import { visit } from "unist-util-visit";

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

// Pattern: - [ ] option text {event: "choice", value: "option-a"}
const SLOT_PATTERN = /^\s*\[?\s*\]\s*(.*?)\s*\{event:\s*"([^"]+)",\s*value:\s*"([^"]+)"\s*\}\s*$/;

// Remark plugin: detect interactive slot syntax in list items and annotate with hProperties
const remarkInteractiveSlots: Plugin<[], Root> = () => (tree: Root) => {
  visit(tree, "listItem", (node: ListItem) => {
    // Only process unchecked checkbox items (checked === false or null/undefined)
    if (node.checked !== false && node.checked !== null && node.checked !== undefined) return;

    // Get the text content of the first paragraph child
    const firstChild = node.children[0];
    if (!firstChild || firstChild.type !== "paragraph") return;
    const para = firstChild as Paragraph;
    const firstText = para.children[0];
    if (!firstText || firstText.type !== "text") return;
    const textNode = firstText as Text;

    // Full text of the list item (may span multiple text nodes)
    const fullText = para.children
      .map(c => (c.type === "text" ? c.value : ""))
      .join("");

    const match = SLOT_PATTERN.exec(fullText);
    if (!match) return;

    const [, label, eventKind, value] = match;

    // Annotate node so mdast-util-to-hast passes data attributes to the <li>
    if (!node.data) node.data = {};
    node.data.hProperties = {
      "data-slot": "true",
      "data-event": eventKind,
      "data-value": value,
      "data-label": label.trim(),
    };

    // Replace paragraph children with just the label text (no checkbox prefix)
    textNode.value = label.trim();
    // Remove remaining text nodes that were part of the pattern
    if (para.children.length > 1) {
      para.children = [textNode];
    }
  });
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

  const postSlotEvent = useCallback(async (eventKind: string, value: string) => {
    await fetch("/api/node/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug,
        actor: "viewer",
        event_kind: "answer",
        payload: { [eventKind]: value },
      }),
    });
    // Reload activity feed after posting
    load();
  }, [slug, load]);

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

  // Build markdown components map with custom li for interactive slots
  const markdownComponents = useMemo(() => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    li({ children, ...props }: React.ComponentPropsWithoutRef<"li"> & { node?: any }) {
      const eventKind = (props as Record<string, unknown>)["data-event"] as string | undefined;
      const value = (props as Record<string, unknown>)["data-value"] as string | undefined;
      const label = (props as Record<string, unknown>)["data-label"] as string | undefined;

      if (eventKind && value) {
        // Interactive slot — render as a checkbox button
        return (
          <li className="list-none flex items-center gap-2 py-1">
            <input
              type="checkbox"
              className="cursor-pointer accent-accent w-4 h-4"
              onClick={(e) => {
                e.preventDefault();
                postSlotEvent(eventKind, value);
              }}
              readOnly
            />
            <span className="text-[13px] text-ink">{label ?? children}</span>
          </li>
        );
      }

      // Normal list item
      return <li {...props}>{children}</li>;
    },
  }), [postSlotEvent]);

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
      <div className="shrink-0 border-b border-rule/30 px-5 py-3 flex flex-col gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={onEdit}
            className="text-[11px] border border-accent/60 px-2.5 py-0.5 text-accent hover:bg-accent hover:text-bg transition-colors"
          >
            edit
          </button>
          <span className="font-mono text-[13px] font-bold text-ink">{node.slug}</span>
          <span className="font-mono text-[10px] text-muted">
            <span className="text-dim">type:</span>{" "}
            <span className={node.node_type === "task" ? "text-accent" : "text-ink"}>
              {node.node_type}
            </span>
          </span>
          <span className="font-mono text-[10px] text-muted">
            <span className="text-dim">status:</span>{" "}
            <span className={node.status === "canon" ? "text-green-500 font-semibold" : "text-ink"}>
              {node.status}
            </span>
          </span>
        </div>
        <div className="font-mono text-[9px] text-dim">{String(node.scope)}</div>
        {/* work_status — only show for task nodes (per Randy 2026-05-09:
             pills on document/principle/etc looked like content tabs and
             did nothing; remove visual confusion). */}
        {node.node_type === "task" && (
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
        )}
      </div>

      {/* Content + tags + activity */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-4">

        {/* Content */}
        {node.content ? (
          <div className="prose-node">
            <ReactMarkdown
              remarkPlugins={[remarkInteractiveSlots]}
              components={markdownComponents}
            >{node.content}</ReactMarkdown>
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
