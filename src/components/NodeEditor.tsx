"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { getBrowserSupabase } from "@/lib/supabase-browser";

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
}

interface ActivityEvent {
  event_kind: string;
  actor: string;
  occurred_at: string;
  outcome: string | null;
}

const WORK_STATUS_PILLS: WorkStatus[] = ["inbox", "in-progress", "done"];

const STATUS_LABELS: Record<WorkStatus, string> = {
  inbox: "inbox",
  "in-progress": "in progress",
  done: "done",
};

export function NodeEditor({ slug }: { slug: string }) {
  const [node, setNode] = useState<NodeRow | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const dirty = content !== savedContent;

  // Load node + activity
  const load = useCallback(async () => {
    const sb = getBrowserSupabase();
    const { data, error } = await sb
      .schema("context_os")
      .from("nodes")
      .select("id, slug, node_type, status, work_status, content, tags, scope, payload")
      .eq("slug", slug)
      .single();

    if (error || !data) {
      setNotFound(true);
      return;
    }

    const row = data as NodeRow;
    setNode(row);
    const c = row.content ?? "";
    setContent(c);
    setSavedContent(c);

    // Activity feed via node_activity RPC
    const { data: actData } = await sb.rpc("node_activity", {
      p_node_slug: slug,
      p_limit: 5,
    });
    if (Array.isArray(actData)) {
      setEvents(actData as ActivityEvent[]);
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  // Cmd+S save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (dirty) handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const handleSave = useCallback(async () => {
    if (!node || !dirty) return;
    setSaving(true);
    setSaveMsg(null);
    const sb = getBrowserSupabase();
    const { data } = await sb.rpc("crud_form_edit", {
      p_actor: "randy",
      p_slug: slug,
      p_content: content,
    });
    setSaving(false);
    if ((data as { ok?: boolean } | null)?.ok) {
      setSavedContent(content);
      setSaveMsg("saved");
      setTimeout(() => setSaveMsg(null), 2000);
      load(); // refresh activity feed
    } else {
      setSaveMsg("error");
    }
  }, [node, dirty, slug, content, load]);

  const handleWorkStatus = useCallback(async (next: WorkStatus) => {
    if (!node || node.work_status === next) return;
    const prev = node.work_status;
    // Optimistic update
    setNode(n => n ? { ...n, work_status: next } : n);
    const sb = getBrowserSupabase();
    await sb.rpc("admin_node_set_field", {
      p_slug: slug,
      p_field: "work_status",
      p_value: next,
    });
    await sb.rpc("post_event", {
      p_actor: "randy",
      p_node_slug: slug,
      p_event_kind: "work_status_changed",
      p_payload: { from: prev, to: next },
    });
    load();
  }, [node, slug, load]);

  const handleArchive = useCallback(async () => {
    setArchiving(true);
    const sb = getBrowserSupabase();
    await sb.rpc("crud_form_archive", {
      p_actor: "randy",
      p_slug: slug,
    });
    setArchiving(false);
    setArchiveOpen(false);
    load();
  }, [slug, load]);

  const copySlug = useCallback(() => {
    navigator.clipboard.writeText(slug);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [slug]);

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
      {/* Header strip — never collapses */}
      <HeaderStrip
        node={node}
        copied={copied}
        onCopySlug={copySlug}
        onWorkStatus={handleWorkStatus}
      />

      {/* Content editor */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden px-5 py-3 gap-3">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={e => setContent(e.target.value)}
          className="flex-1 min-h-0 resize-none font-mono text-[12px] text-ink bg-transparent border border-rule/30 focus:border-rule/60 outline-none p-3 leading-relaxed"
          placeholder="content…"
          spellCheck={false}
        />

        {/* Tags */}
        {node.tags.length > 0 && (
          <div className="shrink-0 flex flex-wrap gap-1.5">
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

        {/* Actions row */}
        <div className="shrink-0 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className={`font-mono text-[10px] px-3 py-1 border transition-colors ${
              dirty && !saving
                ? "border-ink/60 text-ink hover:bg-ink hover:text-bg cursor-pointer"
                : "border-rule/20 text-muted/40 cursor-default"
            }`}
          >
            {saving ? "saving…" : saveMsg === "saved" ? "saved ✓" : saveMsg === "error" ? "error" : "save"}
          </button>

          <span className="font-mono text-[10px] text-muted/40">
            {dirty ? "unsaved changes" : ""}
          </span>

          <div className="ml-auto">
            <button
              onClick={() => setArchiveOpen(true)}
              className="font-mono text-[10px] text-muted/60 hover:text-amber border border-rule/20 hover:border-amber/40 px-2 py-0.5 transition-colors"
            >
              archive
            </button>
          </div>
        </div>

        {/* Activity feed */}
        {events.length > 0 && (
          <div className="shrink-0 border-t border-rule/20 pt-2">
            <div className="font-mono text-[9px] uppercase tracking-widest text-muted/60 mb-1.5">activity</div>
            <div className="flex flex-col gap-1">
              {events.map((ev, i) => (
                <div key={i} className="flex items-baseline gap-2 font-mono text-[10px]">
                  <span className="text-muted/50 shrink-0">
                    {new Date(ev.occurred_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="text-muted/70 shrink-0">{ev.actor}</span>
                  <span className="text-ink/70">{ev.event_kind}</span>
                  {ev.outcome && (
                    <span className="text-muted/50">→ {ev.outcome}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Archive confirm dialog */}
      {archiveOpen && (
        <div className="absolute inset-0 bg-bg/80 flex items-center justify-center z-10">
          <div className="bg-bg border border-rule/60 p-5 max-w-sm w-full mx-4 flex flex-col gap-4">
            <p className="font-mono text-[11px] text-ink leading-relaxed">
              Archive this node? It will no longer appear in scope walks. References to its slug will become broken.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setArchiveOpen(false)}
                className="font-mono text-[10px] border border-rule/40 px-3 py-1 text-muted hover:text-ink transition-colors"
              >
                cancel
              </button>
              <button
                onClick={handleArchive}
                disabled={archiving}
                className="font-mono text-[10px] border border-amber/60 px-3 py-1 text-amber hover:bg-amber hover:text-bg transition-colors"
              >
                {archiving ? "archiving…" : "archive"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HeaderStrip({
  node,
  copied,
  onCopySlug,
  onWorkStatus,
}: {
  node: NodeRow;
  copied: boolean;
  onCopySlug: () => void;
  onWorkStatus: (s: WorkStatus) => void;
}) {
  return (
    <div className="shrink-0 border-b border-rule/30 px-5 py-3 flex flex-col gap-2">
      {/* Slug + type + status row */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={onCopySlug}
          className="font-mono text-[13px] font-bold text-ink hover:text-accent transition-colors text-left"
          title="copy slug"
        >
          {node.slug}
        </button>
        {copied && (
          <span className="font-mono text-[9px] text-muted">copied</span>
        )}
        <span className="font-mono text-[9px] border border-rule/40 px-1.5 py-0.5 text-muted uppercase tracking-wide">
          {node.node_type}
        </span>
        <span
          className={`font-mono text-[9px] border px-1.5 py-0.5 uppercase tracking-wide ${
            node.status === "canon"
              ? "border-green-600/50 text-green-700"
              : "border-rule/30 text-muted"
          }`}
        >
          {node.status}
        </span>
      </div>

      {/* Scope breadcrumb */}
      <div className="font-mono text-[9px] text-muted/60">
        {String(node.scope)}
      </div>

      {/* work_status 3-pill */}
      <div className="flex gap-px">
        {WORK_STATUS_PILLS.map(ws => (
          <button
            key={ws}
            onClick={() => onWorkStatus(ws)}
            className={`font-mono text-[9px] uppercase tracking-wide px-2.5 py-1 border transition-colors ${
              node.work_status === ws
                ? "bg-ink text-bg border-ink"
                : "border-rule/30 text-muted hover:border-rule/60 hover:text-ink"
            }`}
          >
            {STATUS_LABELS[ws]}
          </button>
        ))}
      </div>
    </div>
  );
}
