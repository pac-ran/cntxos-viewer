"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { getBrowserSupabase } from "@/lib/supabase-browser";

// ── Types ──────────────────────────────────────────────────────────────────

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

interface ParsedAction {
  name: string;
  applies_when: string;
  on_click: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const WORK_STATUS_PILLS: WorkStatus[] = ["inbox", "in-progress", "done"];
const STATUS_LABELS: Record<WorkStatus, string> = {
  inbox: "inbox",
  "in-progress": "in progress",
  done: "done",
};

// ── Action manifest parser ─────────────────────────────────────────────────

function parseActionManifest(content: string): ParsedAction[] {
  const sections = content.split(/^## /m).slice(1);
  return sections.map(section => {
    const lines = section.split("\n");
    const name = lines[0].trim();
    const appliesLine = lines.find(l => l.startsWith("applies_when:"));
    const onClickLine = lines.find(l => l.startsWith("on_click:"));
    return {
      name,
      applies_when: appliesLine?.replace("applies_when:", "").trim() ?? "always",
      on_click: onClickLine?.replace("on_click:", "").trim() ?? "",
    };
  }).filter(a => a.name);
}

function evalAppliesWhen(condition: string, node: NodeRow): boolean {
  if (!condition || condition === "always") return true;
  // Split compound AND conditions
  const parts = condition.split(/\bAND\b/).map(p => p.trim());
  return parts.every(part => evalSingleCondition(part, node));
}

function evalSingleCondition(cond: string, node: NodeRow): boolean {
  // work_status = X (normalise in_progress → in-progress)
  const wsEq = cond.match(/work_status\s*=\s*(\S+)/);
  if (wsEq) return node.work_status === wsEq[1].replace("in_progress", "in-progress");

  // status = X
  const stEq = cond.match(/^status\s*=\s*(\S+)/);
  if (stEq) return node.status === stEq[1];

  // node_type = X
  const ntEq = cond.match(/node_type\s*=\s*(\S+)/);
  if (ntEq) return node.node_type === ntEq[1];

  // payload.visibility != X
  const visNe = cond.match(/payload\.visibility\s*!=\s*(\S+)/);
  if (visNe) return (node.payload?.visibility as string | undefined) !== visNe[1];

  // operator has authority — always show, backend gates
  if (cond.includes("operator has authority")) return true;

  return false;
}

// ── Session actor lookup ───────────────────────────────────────────────────

async function resolveActor(): Promise<string> {
  // 1. URL param override
  if (typeof window !== "undefined") {
    const param = new URLSearchParams(window.location.search).get("actor");
    if (param) return param;
  }
  // 2. session-randy node payload
  try {
    const sb = getBrowserSupabase();
    const { data } = await sb
      .schema("context_os")
      .from("nodes")
      .select("payload")
      .eq("slug", "session-randy")
      .single();
    const payload = data?.payload as { active?: boolean; agent_slug?: string } | null;
    if (payload?.active && payload.agent_slug) {
      // 'agent-randy' → 'randy'
      return payload.agent_slug.replace(/^agent-/, "");
    }
  } catch {
    // fall through
  }
  return "randy";
}

// ── NodeEditor ─────────────────────────────────────────────────────────────

export function NodeEditor({ slug }: { slug: string }) {
  const [actor, setActor] = useState("randy");
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
  const [actions, setActions] = useState<ParsedAction[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [noteModal, setNoteModal] = useState<{ eventKind: string; label: string } | null>(null);
  const [noteText, setNoteText] = useState("");
  // Tags
  const [tags, setTags] = useState<string[]>([]);
  const [savedTags, setSavedTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [allKnownTags, setAllKnownTags] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const tagDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const contentDirty = content !== savedContent;
  const tagsDirty = JSON.stringify([...tags].sort()) !== JSON.stringify([...savedTags].sort());

  // Resolve session actor + prefetch tag vocabulary on mount
  useEffect(() => {
    resolveActor().then(setActor);
    // Fetch all distinct tags once — no user input interpolated
    const sb = getBrowserSupabase();
    void sb.rpc("exec_render_query", {
      p_sql: "SELECT DISTINCT unnest(tags) AS tag FROM context_os.nodes ORDER BY tag LIMIT 100",
    }).then(({ data }) => {
      if (Array.isArray(data)) {
        setAllKnownTags((data as { tag: string }[]).map(r => r.tag));
      }
    });
  }, []);

  // Load node + events + action manifest
  const load = useCallback(async () => {
    const sb = getBrowserSupabase();
    const { data, error } = await sb
      .schema("context_os")
      .from("nodes")
      .select("id, slug, node_type, status, work_status, content, tags, scope, payload")
      .eq("slug", slug)
      .single();

    if (error || !data) { setNotFound(true); return; }

    const row = data as NodeRow;
    setNode(row);
    const c = row.content ?? "";
    setContent(c);
    setSavedContent(c);
    setTags(row.tags ?? []);
    setSavedTags(row.tags ?? []);

    // Fetch action manifest for this node_type
    const { data: manifestData } = await sb
      .schema("context_os")
      .from("nodes")
      .select("content")
      .eq("slug", `actions-for-${row.node_type}`)
      .single();
    if (manifestData?.content) {
      setActions(parseActionManifest(manifestData.content as string));
    } else {
      setActions([]);
    }

    // Activity feed
    const { data: actData } = await sb.rpc("node_activity", { p_node_slug: slug, p_limit: 5 });
    if (Array.isArray(actData)) setEvents(actData as ActivityEvent[]);
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  // Cmd+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (contentDirty) handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  // ── Save content ─────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!node || !contentDirty) return;
    setSaving(true);
    setSaveMsg(null);
    const sb = getBrowserSupabase();
    const { data } = await sb.rpc("crud_form_edit", {
      p_actor: actor,
      p_slug: slug,
      p_content: content,
    });
    setSaving(false);
    if ((data as { ok?: boolean } | null)?.ok) {
      setSavedContent(content);
      setSaveMsg("saved");
      setTimeout(() => setSaveMsg(null), 2000);
      load();
    } else {
      setSaveMsg("error");
    }
  }, [node, contentDirty, slug, content, actor, load]);

  // ── work_status ──────────────────────────────────────────────────────────

  const handleWorkStatus = useCallback(async (next: WorkStatus) => {
    if (!node || node.work_status === next) return;
    const prev = node.work_status;
    setNode(n => n ? { ...n, work_status: next } : n);
    const sb = getBrowserSupabase();
    await sb.rpc("admin_node_set_field", { p_slug: slug, p_field: "work_status", p_value: next });
    await sb.rpc("post_event", {
      p_actor: actor,
      p_node_slug: slug,
      p_event_kind: "work_status_changed",
      p_payload: { from: prev, to: next },
    });
    load();
  }, [node, slug, actor, load]);

  // ── Archive ──────────────────────────────────────────────────────────────

  const handleArchive = useCallback(async () => {
    setArchiving(true);
    const sb = getBrowserSupabase();
    await sb.rpc("crud_form_archive", { p_actor: actor, p_slug: slug });
    setArchiving(false);
    setArchiveOpen(false);
    load();
  }, [slug, actor, load]);

  // ── Action manifest dispatch ─────────────────────────────────────────────

  const dispatchAction = useCallback(async (action: ParsedAction) => {
    const sb = getBrowserSupabase();
    const oc = action.on_click;

    // work_status transition
    const wsMatch = oc.match(/set work_status = (\S+)/);
    if (wsMatch) {
      const next = wsMatch[1].replace("in_progress", "in-progress") as WorkStatus;
      await handleWorkStatus(next);
      return;
    }

    // navigate to cx-surface
    if (oc.includes("navigate to /cx-surface")) {
      window.open(`/api/cx-surface/${slug}`, "_blank");
      return;
    }

    // note/reason text → modal
    if (oc.includes("note text") || oc.includes("reason text")) {
      const kindMatch = oc.match(/post (\S+) event/);
      setNoteModal({ eventKind: kindMatch?.[1] ?? "note", label: action.name });
      setNoteText("");
      return;
    }

    // simple event post
    const eventMatch = oc.match(/post (\S+) event/);
    if (eventMatch) {
      const kind = eventMatch[1].replace(/_/g, "-");
      await sb.rpc("post_event", {
        p_actor: actor,
        p_node_slug: slug,
        p_event_kind: kind,
        p_payload: { triggered_by: "action-manifest", action: action.name },
      });
      showToast(`${action.name} posted`);
      load();
      return;
    }

    // review-requested (special pattern in actions-for-document)
    if (oc.includes("review-requested")) {
      await sb.rpc("post_event", {
        p_actor: actor,
        p_node_slug: slug,
        p_event_kind: "note",
        p_payload: { kind: "review-requested" },
      });
      showToast("Review requested");
      load();
      return;
    }

    // admin_node_set_field for visibility
    const fieldMatch = oc.match(/admin_node_set_field to update (\S+) in payload/);
    if (fieldMatch) {
      showToast("Visibility selector — coming in v2");
      return;
    }

    showToast(`${action.name} — coming in v2`);
  }, [actor, slug, handleWorkStatus, load, showToast]);

  const submitNoteModal = useCallback(async () => {
    if (!noteModal || !noteText.trim()) return;
    const sb = getBrowserSupabase();
    await sb.rpc("post_event", {
      p_actor: actor,
      p_node_slug: slug,
      p_event_kind: noteModal.eventKind.replace(/_/g, "-"),
      p_payload: { note: noteText.trim() },
    });
    setNoteModal(null);
    setNoteText("");
    showToast(`${noteModal.label} posted`);
    load();
  }, [noteModal, noteText, actor, slug, load, showToast]);

  // ── Tags ─────────────────────────────────────────────────────────────────

  const saveTags = useCallback(async (nextTags: string[]) => {
    const sb = getBrowserSupabase();
    await sb.rpc("crud_form_edit", {
      p_actor: actor,
      p_slug: slug,
      p_tags: nextTags,
    });
    setSavedTags(nextTags);
  }, [actor, slug]);

  const scheduleTagSave = useCallback((nextTags: string[]) => {
    if (tagDebounceRef.current) clearTimeout(tagDebounceRef.current);
    tagDebounceRef.current = setTimeout(() => saveTags(nextTags), 800);
  }, [saveTags]);

  const addTag = useCallback((tag: string) => {
    const t = tag.trim().toLowerCase();
    if (!t || tags.includes(t)) { setTagInput(""); setShowSuggestions(false); return; }
    const next = [...tags, t];
    setTags(next);
    setTagInput("");
    setShowSuggestions(false);
    scheduleTagSave(next);
  }, [tags, scheduleTagSave]);

  const removeTag = useCallback((tag: string) => {
    const next = tags.filter(t => t !== tag);
    setTags(next);
    scheduleTagSave(next);
  }, [tags, scheduleTagSave]);

  const handleTagInputChange = useCallback((val: string) => {
    setTagInput(val);
    if (!val.trim()) { setSuggestions([]); setShowSuggestions(false); return; }
    // Filter from prefetched vocabulary — no user input in any SQL
    const q = val.trim().toLowerCase();
    const filtered = allKnownTags.filter(t => t.startsWith(q) && !tags.includes(t)).slice(0, 20);
    setSuggestions(filtered);
    setShowSuggestions(filtered.length > 0);
  }, [allKnownTags, tags]);

  const copySlug = useCallback(() => {
    navigator.clipboard.writeText(slug);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [slug]);

  // ── Render ────────────────────────────────────────────────────────────────

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

  const applicableActions = actions.filter(a => evalAppliesWhen(a.applies_when, node));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header strip */}
      <HeaderStrip
        node={node}
        copied={copied}
        onCopySlug={copySlug}
        onWorkStatus={handleWorkStatus}
      />

      {/* Action manifest buttons — below header strip */}
      {applicableActions.length > 0 && (
        <div className="shrink-0 flex flex-wrap gap-1.5 px-5 py-2 border-b border-rule/20">
          {applicableActions.map((action, i) => (
            <button
              key={i}
              onClick={() => dispatchAction(action)}
              className="font-mono text-[9px] uppercase tracking-wide border border-rule/40 px-2 py-0.5 text-muted hover:text-ink hover:border-rule/70 transition-colors"
            >
              {action.name}
            </button>
          ))}
        </div>
      )}

      {/* Content editor + fields */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden px-5 py-3 gap-3">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={e => setContent(e.target.value)}
          className="flex-1 min-h-0 resize-none font-mono text-[12px] text-ink bg-transparent border border-rule/30 focus:border-rule/60 outline-none p-3 leading-relaxed"
          placeholder="content…"
          spellCheck={false}
        />

        {/* Tags chip input */}
        <div className="shrink-0 flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-1.5 items-center">
            {tags.map(tag => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 font-mono text-[10px] border border-rule/30 px-1.5 py-0.5 text-muted"
              >
                {tag}
                <button
                  onClick={() => removeTag(tag)}
                  className="opacity-50 hover:opacity-100 leading-none"
                  aria-label={`remove ${tag}`}
                >
                  ×
                </button>
              </span>
            ))}
            <div className="relative">
              <input
                type="text"
                value={tagInput}
                onChange={e => handleTagInputChange(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagInput); }
                  if (e.key === "Escape") { setShowSuggestions(false); }
                }}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                placeholder={tags.length === 0 ? "add tags…" : "+"}
                className="font-mono text-[10px] text-ink bg-transparent border border-rule/20 focus:border-rule/50 outline-none px-1.5 py-0.5 w-24 placeholder:text-muted/40"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute top-full left-0 mt-0.5 bg-bg border border-rule/50 z-20 min-w-[120px] max-h-32 overflow-y-auto">
                  {suggestions.map(s => (
                    <button
                      key={s}
                      onMouseDown={() => addTag(s)}
                      className="block w-full text-left font-mono text-[10px] px-2 py-1 text-muted hover:text-ink hover:bg-rule/10 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {tagsDirty && (
              <span className="font-mono text-[9px] text-muted/50">saving tags…</span>
            )}
          </div>
        </div>

        {/* Actions row */}
        <div className="shrink-0 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={!contentDirty || saving}
            className={`font-mono text-[10px] px-3 py-1 border transition-colors ${
              contentDirty && !saving
                ? "border-ink/60 text-ink hover:bg-ink hover:text-bg cursor-pointer"
                : "border-rule/20 text-muted/40 cursor-default"
            }`}
          >
            {saving ? "saving…" : saveMsg === "saved" ? "saved ✓" : saveMsg === "error" ? "error" : "save"}
          </button>
          <span className="font-mono text-[10px] text-muted/40">
            {contentDirty ? "unsaved changes" : ""}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="font-mono text-[9px] text-muted/40">{actor}</span>
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
                  {ev.outcome && <span className="text-muted/50">→ {ev.outcome}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Archive confirm */}
      {archiveOpen && (
        <div className="absolute inset-0 bg-bg/80 flex items-center justify-center z-10">
          <div className="bg-bg border border-rule/60 p-5 max-w-sm w-full mx-4 flex flex-col gap-4">
            <p className="font-mono text-[11px] text-ink leading-relaxed">
              Archive this node? It will no longer appear in scope walks. References to its slug will become broken.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setArchiveOpen(false)} className="font-mono text-[10px] border border-rule/40 px-3 py-1 text-muted hover:text-ink transition-colors">cancel</button>
              <button onClick={handleArchive} disabled={archiving} className="font-mono text-[10px] border border-amber/60 px-3 py-1 text-amber hover:bg-amber hover:text-bg transition-colors">
                {archiving ? "archiving…" : "archive"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Note/reason modal */}
      {noteModal && (
        <div className="absolute inset-0 bg-bg/80 flex items-center justify-center z-10">
          <div className="bg-bg border border-rule/60 p-5 max-w-sm w-full mx-4 flex flex-col gap-3">
            <div className="font-mono text-[10px] font-bold uppercase tracking-wide text-muted">{noteModal.label}</div>
            <textarea
              autoFocus
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              rows={3}
              className="resize-none font-mono text-[11px] text-ink bg-transparent border border-rule/40 focus:border-rule/70 outline-none p-2 leading-relaxed"
              placeholder="note…"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setNoteModal(null)} className="font-mono text-[10px] border border-rule/40 px-3 py-1 text-muted hover:text-ink transition-colors">cancel</button>
              <button onClick={submitNoteModal} disabled={!noteText.trim()} className="font-mono text-[10px] border border-ink/60 px-3 py-1 text-ink hover:bg-ink hover:text-bg transition-colors disabled:opacity-30">post</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-ink text-bg font-mono text-[10px] px-3 py-1.5 z-20">
          {toast}
        </div>
      )}
    </div>
  );
}

// ── HeaderStrip ────────────────────────────────────────────────────────────

function HeaderStrip({
  node, copied, onCopySlug, onWorkStatus,
}: {
  node: NodeRow;
  copied: boolean;
  onCopySlug: () => void;
  onWorkStatus: (s: WorkStatus) => void;
}) {
  return (
    <div className="shrink-0 border-b border-rule/30 px-5 py-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onCopySlug} className="font-mono text-[13px] font-bold text-ink hover:text-accent transition-colors text-left" title="copy slug">
          {node.slug}
        </button>
        {copied && <span className="font-mono text-[9px] text-muted">copied</span>}
        <span className="font-mono text-[9px] border border-rule/40 px-1.5 py-0.5 text-muted uppercase tracking-wide">{node.node_type}</span>
        <span className={`font-mono text-[9px] border px-1.5 py-0.5 uppercase tracking-wide ${node.status === "canon" ? "border-green-600/50 text-green-700" : "border-rule/30 text-muted"}`}>
          {node.status}
        </span>
      </div>
      <div className="font-mono text-[9px] text-muted/60">{String(node.scope)}</div>
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
