"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import ReactMarkdown from "react-markdown";

const NODE_TYPES = [
  "document", "principle", "procedure", "task", "conversation", "file",
  "surface", "walk_formula", "pattern", "session", "policy", "practice",
  "role", "mission", "plan", "opportunity", "entity", "glimmer",
];

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
  visibility?: string;
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
  const parts = condition.split(/\bAND\b/).map(p => p.trim());
  return parts.every(part => evalSingleCondition(part, node));
}

function evalSingleCondition(cond: string, node: NodeRow): boolean {
  const wsEq = cond.match(/work_status\s*=\s*(\S+)/);
  if (wsEq) return node.work_status === wsEq[1].replace("in_progress", "in-progress");

  const stEq = cond.match(/^status\s*=\s*(\S+)/);
  if (stEq) return node.status === stEq[1];

  const ntEq = cond.match(/node_type\s*=\s*(\S+)/);
  if (ntEq) return node.node_type === ntEq[1];

  const visNe = cond.match(/payload\.visibility\s*!=\s*(\S+)/);
  if (visNe) return (node.payload?.visibility as string | undefined) !== visNe[1];

  if (cond.includes("operator has authority")) return true;

  return false;
}

// ── Session actor lookup ───────────────────────────────────────────────────

async function resolveActor(): Promise<string> {
  if (typeof window !== "undefined") {
    const param = new URLSearchParams(window.location.search).get("actor");
    if (param) return param;
  }
  try {
    const res = await fetch("/api/node/session-randy");
    if (res.ok) {
      const { node } = await res.json() as { node: { payload?: { active?: boolean; agent_slug?: string } } | null };
      const payload = node?.payload;
      if (payload?.active && payload.agent_slug) {
        return payload.agent_slug.replace(/^agent-/, "");
      }
    }
  } catch {
    // fall through
  }
  return "randy";
}

// ── NodeEditor ─────────────────────────────────────────────────────────────

export function NodeEditor({ slug, onExitEdit }: { slug: string; onExitEdit?: () => void }) {
  const [actor, setActor] = useState("randy");
  const [node, setNode] = useState<NodeRow | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  // Full-edit fields (Randy 2026-05-09)
  const [nodeType, setNodeType] = useState<string>("");
  const [savedNodeType, setSavedNodeType] = useState<string>("");
  const [scope, setScope] = useState<string>("");
  const [savedScope, setSavedScope] = useState<string>("");
  const [statusVal, setStatusVal] = useState<string>("");
  const [savedStatus, setSavedStatus] = useState<string>("");
  const [visibility, setVisibility] = useState<string>("");
  const [savedVisibility, setSavedVisibility] = useState<string>("");
  const [payloadText, setPayloadText] = useState<string>("{}");
  const [savedPayloadText, setSavedPayloadText] = useState<string>("{}");
  const [payloadEditOpen, setPayloadEditOpen] = useState(false);
  const [payloadJsonError, setPayloadJsonError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [copied, setCopied] = useState(false);
  const [actions, setActions] = useState<ParsedAction[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [noteModal, setNoteModal] = useState<{ eventKind: string; label: string } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [promoting, setPromoting] = useState(false);
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

  // Resolve session actor on mount
  useEffect(() => {
    resolveActor().then(setActor);
  }, []);

  // Load node + events + action manifest + tags vocab
  const load = useCallback(async () => {
    const res = await fetch(`/api/node/${slug}`);
    if (!res.ok) { setNotFound(true); return; }
    const { node: row, events: evts, actionManifest, tagsVocab } = await res.json() as {
      node: NodeRow | null;
      events: ActivityEvent[];
      actionManifest: string | null;
      tagsVocab: string[];
    };
    if (!row) { setNotFound(true); return; }
    setNode(row);
    const c = row.content ?? "";
    setContent(c);
    setSavedContent(c);
    setTags(row.tags ?? []);
    setSavedTags(row.tags ?? []);
    setEvents(evts ?? []);
    setNodeType(row.node_type ?? "");
    setSavedNodeType(row.node_type ?? "");
    setScope(String(row.scope ?? ""));
    setSavedScope(String(row.scope ?? ""));
    setStatusVal(row.status ?? "draft");
    setSavedStatus(row.status ?? "draft");
    setVisibility(row.visibility ?? "private");
    setSavedVisibility(row.visibility ?? "private");
    const ptxt = JSON.stringify(row.payload ?? {}, null, 2);
    setPayloadText(ptxt);
    setSavedPayloadText(ptxt);
    setPayloadJsonError(null);
    setAllKnownTags(tagsVocab ?? []);
    if (actionManifest) {
      setActions(parseActionManifest(actionManifest));
    } else {
      setActions([]);
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  // Realtime subscription — auto-refresh when an event is inserted for this node
  useEffect(() => {
    if (!node?.id) return;
    const supabase = getBrowserSupabase();
    const channel = supabase
      .channel(`node-editor-${node.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "context_os", table: "events", filter: `subject_node_id=eq.${node.id}` },
        () => { load(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [node?.id, load]);

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

  // ── Dirty tracking for full-edit ─────────────────────────────────────────
  const nodeTypeDirty   = nodeType !== savedNodeType;
  const scopeDirty      = scope !== savedScope;
  const statusDirty     = statusVal !== savedStatus;
  const visibilityDirty = visibility !== savedVisibility;
  const payloadDirty    = payloadText !== savedPayloadText;
  const anyDirty = contentDirty || tagsDirty || nodeTypeDirty || scopeDirty
                || statusDirty || visibilityDirty || payloadDirty;

  // ── Save (full patch via /api/node/update) ───────────────────────────────
  const handleSave = useCallback(async () => {
    if (!node || !anyDirty) return;
    // Validate payload JSON first
    let payloadObj: Record<string, unknown> | undefined;
    if (payloadDirty) {
      try {
        payloadObj = JSON.parse(payloadText);
        if (typeof payloadObj !== "object" || payloadObj === null || Array.isArray(payloadObj)) {
          throw new Error("payload must be a JSON object");
        }
      } catch (err) {
        setPayloadJsonError((err as Error).message);
        setSaveMsg("error");
        return;
      }
    }
    setPayloadJsonError(null);
    setUpdateError(null);
    setSaving(true);
    setSaveMsg(null);

    const patch: Record<string, unknown> = {};
    if (contentDirty)    patch.content    = content;
    if (tagsDirty)       patch.tags       = tags;
    if (nodeTypeDirty)   patch.node_type  = nodeType;
    if (scopeDirty)      patch.scope      = scope.trim();
    if (statusDirty)     patch.status     = statusVal;
    if (visibilityDirty) patch.visibility = visibility;
    if (payloadDirty && payloadObj !== undefined) {
      // payload is deep-merged on the server. Send a "replace" by sending all
      // current keys; the merge with existing keeps any server-only keys.
      // For Randy's "raw json edit" expectation, this is the closest safe semantic.
      patch.payload = payloadObj;
    }

    const res = await fetch("/api/node/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, patch, actor }),
    });
    const data = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null;
    setSaving(false);
    if (data?.ok) {
      setSaveMsg("saved");
      setTimeout(() => setSaveMsg(null), 2000);
      // Refresh from server to confirm and switch back to view.
      await load();
      if (onExitEdit) onExitEdit();
    } else {
      setUpdateError(data?.error ?? "update failed");
      setSaveMsg("error");
    }
  }, [node, anyDirty, slug, content, contentDirty, tags, tagsDirty, nodeType, nodeTypeDirty,
      scope, scopeDirty, statusVal, statusDirty, visibility, visibilityDirty,
      payloadText, payloadDirty, actor, load, onExitEdit]);

  // ── Archive / Unarchive (uses update RPC, sets status) ───────────────────
  const handleArchiveToggle = useCallback(async () => {
    if (!node) return;
    const next = node.status === "archived" ? "draft" : "archived";
    setArchiving(true);
    const res = await fetch("/api/node/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, patch: { status: next }, actor }),
    });
    setArchiving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null) as { error?: string } | null;
      setUpdateError(data?.error ?? "archive failed");
      return;
    }
    showToast(next === "archived" ? "archived" : "unarchived");
    load();
  }, [node, slug, actor, load, showToast]);

  // ── Delete forever (hard delete after type-DELETE confirm) ───────────────
  const handleDelete = useCallback(async () => {
    if (deleteConfirmText !== "DELETE") return;
    setDeleting(true);
    setDeleteError(null);
    const res = await fetch("/api/node/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, confirm: true, actor }),
    });
    const data = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null;
    setDeleting(false);
    if (data?.ok) {
      // Navigate away — node no longer exists.
      window.location.href = "/";
    } else {
      setDeleteError(data?.error ?? "delete failed");
    }
  }, [deleteConfirmText, slug, actor]);

  // ── work_status ──────────────────────────────────────────────────────────

  const handleWorkStatus = useCallback(async (next: WorkStatus) => {
    if (!node || node.work_status === next) return;
    const prev = node.work_status;
    setNode(n => n ? { ...n, work_status: next } : n);
    await fetch("/api/node/work-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, value: next, actor, prev }),
    });
    load();
  }, [node, slug, actor, load]);

  // ── Promote to canon ────────────────────────────────────────────────────

  const handlePromoteToCanon = useCallback(async () => {
    setPromoting(true);
    await fetch("/api/node/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, value: "canon", actor }),
    });
    setPromoting(false);
    load();
    showToast("promoted to canon");
  }, [slug, actor, load, showToast]);

  // ── Action manifest dispatch ─────────────────────────────────────────────

  const dispatchAction = useCallback(async (action: ParsedAction) => {
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
      await fetch("/api/node/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, actor, event_kind: kind, payload: { triggered_by: "action-manifest", action: action.name } }),
      });
      showToast(`${action.name} posted`);
      load();
      return;
    }

    // review-requested (special pattern in actions-for-document)
    if (oc.includes("review-requested")) {
      await fetch("/api/node/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, actor, event_kind: "note", payload: { kind: "review-requested" } }),
      });
      showToast("Review requested");
      load();
      return;
    }

    // admin_node_set_field for visibility
    if (oc.match(/admin_node_set_field to update (\S+) in payload/)) {
      showToast("Visibility selector — coming in v2");
      return;
    }

    showToast(`${action.name} — coming in v2`);
  }, [actor, slug, handleWorkStatus, load, showToast]);

  const submitNoteModal = useCallback(async () => {
    if (!noteModal || !noteText.trim()) return;
    await fetch("/api/node/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, actor, event_kind: noteModal.eventKind.replace(/_/g, "-"), payload: { note: noteText.trim() } }),
    });
    setNoteModal(null);
    setNoteText("");
    showToast(`${noteModal.label} posted`);
    load();
  }, [noteModal, noteText, actor, slug, load, showToast]);

  // ── Tags ─────────────────────────────────────────────────────────────────

  const saveTags = useCallback(async (nextTags: string[]) => {
    await fetch("/api/node/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, tags: nextTags, actor }),
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
              className="text-[11px] uppercase tracking-wide border border-rule px-2 py-0.5 text-muted hover:text-ink hover:border-ink transition-colors"
            >
              {action.name}
            </button>
          ))}
        </div>
      )}

      {/* Content editor + fields */}
      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto px-5 py-3 gap-3">
        {/* Metadata field editors (Randy 2026-05-09: full edit mode) */}
        <div className="shrink-0 grid grid-cols-2 gap-2 text-[11px]">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-dim">node_type</span>
            <select
              value={nodeType}
              onChange={e => setNodeType(e.target.value)}
              className="font-mono text-[11px] px-2 py-1 bg-bg border border-ink/60 focus:border-accent outline-none text-ink"
            >
              {NODE_TYPES.includes(nodeType) ? null : <option value={nodeType}>{nodeType}</option>}
              {NODE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-dim">scope</span>
            <input
              type="text"
              value={scope}
              onChange={e => setScope(e.target.value)}
              className="font-mono text-[11px] px-2 py-1 bg-bg border border-ink/60 focus:border-accent outline-none text-ink"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-dim">status</span>
            <select
              value={statusVal}
              onChange={e => setStatusVal(e.target.value)}
              className="font-mono text-[11px] px-2 py-1 bg-bg border border-ink/60 focus:border-accent outline-none text-ink"
            >
              <option value="draft">draft</option>
              <option value="canon">canon</option>
              <option value="archived">archived</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-dim">visibility</span>
            <select
              value={visibility}
              onChange={e => setVisibility(e.target.value)}
              className="font-mono text-[11px] px-2 py-1 bg-bg border border-ink/60 focus:border-accent outline-none text-ink"
            >
              <option value="private">private</option>
              <option value="public">public</option>
            </select>
          </label>
        </div>

        {/* Content with preview toggle */}
        <div className="shrink-0 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wide text-dim">content (markdown)</span>
          <button
            onClick={() => setPreviewMode(p => !p)}
            className="text-[11px] text-muted hover:text-ink border border-rule hover:border-ink px-2 py-0.5 transition-colors"
          >
            {previewMode ? "edit" : "preview"}
          </button>
        </div>
        {previewMode ? (
          <div className="min-h-[200px] border border-rule/40 p-3 prose-node text-[12px] overflow-y-auto">
            <ReactMarkdown>{content || "_no content_"}</ReactMarkdown>
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={e => setContent(e.target.value)}
            className="min-h-[200px] resize-y text-[13px] text-ink bg-transparent border border-ink/60 focus:border-accent outline-none p-3 leading-relaxed"
            placeholder="content…"
            spellCheck={false}
          />
        )}

        {/* TODO (v1.5): slug rename via separate confirm flow.
            Renaming a slug is dangerous — breaks inbound URLs, edges,
            references in payloads. Build behind explicit "type old slug
            to confirm" modal + cascade update of context_os.events. */}

        {/* Tags chip input */}
        <div className="shrink-0 flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-1.5 items-center">
            {tags.map(tag => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 font-mono text-[11px] border border-rule px-1.5 py-0.5 text-muted"
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
                className="font-mono text-[11px] text-ink bg-transparent border border-rule focus:border-ink outline-none px-1.5 py-0.5 w-24 placeholder:text-dim"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute top-full left-0 mt-0.5 bg-bg border border-ink z-20 min-w-[120px] max-h-32 overflow-y-auto shadow-lg">
                  {suggestions.map(s => (
                    <button
                      key={s}
                      onMouseDown={() => addTag(s)}
                      className="block w-full text-left font-mono text-[11px] px-2 py-1 text-muted hover:text-ink hover:bg-rule/30 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {tagsDirty && (
              <span className="text-[11px] text-dim">saving tags…</span>
            )}
          </div>
        </div>

        {/* Payload JSON editor (collapsible, all node types now editable) */}
        <div className="shrink-0 border-t border-rule/20 pt-2">
          <button
            onClick={() => setPayloadEditOpen(p => !p)}
            className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-dim hover:text-ink transition-colors w-full text-left"
          >
            <span>{payloadEditOpen ? "▾" : "▸"}</span>
            <span>payload (json)</span>
            {payloadDirty && <span className="text-amber normal-case lowercase">• unsaved</span>}
          </button>
          {payloadEditOpen && (
            <div className="mt-1.5 flex flex-col gap-1">
              <textarea
                value={payloadText}
                onChange={e => { setPayloadText(e.target.value); setPayloadJsonError(null); }}
                rows={8}
                className="font-mono text-[11px] text-ink bg-bg border border-ink/60 focus:border-accent outline-none p-2 leading-relaxed resize-y"
                spellCheck={false}
              />
              {payloadJsonError && (
                <span className="text-[11px] text-red-600">JSON error: {payloadJsonError}</span>
              )}
            </div>
          )}
        </div>

        {/* Errors */}
        {updateError && (
          <div className="shrink-0 text-[11px] text-red-500 font-mono border border-red-500/40 px-2 py-1">
            {updateError}
          </div>
        )}

        {/* Actions row — primary save (orange), cancel (text), archive,
            delete-forever (red w/ type-DELETE confirm). Randy 2026-05-09. */}
        <div className="shrink-0 flex items-center gap-2 flex-wrap pt-2 border-t border-rule/20">
          <button
            onClick={handleSave}
            disabled={!anyDirty || saving}
            className="text-[12px] font-semibold px-4 py-1.5 transition-opacity"
            style={{
              background: anyDirty && !saving ? "#C2400C" : "#888",
              color: "#ffffff",
              opacity: anyDirty && !saving ? 1 : 0.6,
            }}
          >
            {saving ? "saving…" : saveMsg === "saved" ? "saved ✓" : saveMsg === "error" ? "error" : "save changes"}
          </button>
          <button
            onClick={() => onExitEdit?.()}
            className="text-[12px] text-muted hover:text-ink px-3 py-1.5 transition-colors"
          >
            cancel
          </button>
          <span className="text-[11px] text-dim">
            {anyDirty ? "unsaved changes" : ""}
          </span>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-[11px] text-dim">{actor}</span>
            {node.status === "draft" && (actor === "randy" || actor === "dl") && (
              <button
                onClick={handlePromoteToCanon}
                disabled={promoting}
                className="text-[11px] border border-green-600/50 text-green-400 hover:bg-green-600/20 px-2 py-0.5 transition-colors disabled:opacity-40"
              >
                {promoting ? "promoting…" : "→ canon"}
              </button>
            )}
            <button
              onClick={handleArchiveToggle}
              disabled={archiving}
              className="text-[11px] text-muted hover:text-amber transition-colors px-2 py-0.5 disabled:opacity-40"
            >
              {node.status === "archived"
                ? (archiving ? "unarchiving…" : "[unarchive]")
                : (archiving ? "archiving…" : "[archive]")}
            </button>
            <button
              onClick={() => { setDeleteOpen(o => !o); setDeleteConfirmText(""); setDeleteError(null); }}
              className="text-[11px] text-red-500 hover:text-red-400 transition-colors px-2 py-0.5"
            >
              delete forever
            </button>
          </div>
        </div>

        {/* Delete forever inline confirm (NOT a modal) */}
        {deleteOpen && (
          <div className="shrink-0 border border-red-500/60 bg-red-500/5 p-3 flex flex-col gap-2">
            <div className="text-[12px] text-red-400 font-semibold">
              Hard-delete <span className="font-mono">{slug}</span>? This removes the node and its events. Cannot be undone.
            </div>
            <input
              type="text"
              autoFocus
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              placeholder='Type DELETE to confirm'
              className="font-mono text-[12px] px-2 py-1 bg-bg border border-red-500/60 focus:border-red-500 outline-none text-ink"
            />
            {deleteError && (
              <span className="text-[11px] text-red-500">{deleteError}</span>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setDeleteOpen(false); setDeleteConfirmText(""); }}
                className="text-[12px] text-muted hover:text-ink px-3 py-1 transition-colors"
              >
                cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteConfirmText !== "DELETE" || deleting}
                className="text-[12px] px-3 py-1 transition-colors text-white"
                style={{
                  background: deleteConfirmText === "DELETE" && !deleting ? "#dc2626" : "#888",
                  opacity: deleteConfirmText === "DELETE" && !deleting ? 1 : 0.6,
                }}
              >
                {deleting ? "deleting…" : "delete forever"}
              </button>
            </div>
          </div>
        )}

        {/* Activity feed */}
        {events.length > 0 && (
          <div className="shrink-0 border-t border-rule/20 pt-2">
            <div className="text-[11px] uppercase tracking-widest text-dim mb-1.5">activity</div>
            <div className="flex flex-col gap-1">
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


      {/* Note/reason modal */}
      {noteModal && (
        <div className="absolute inset-0 bg-bg/80 flex items-center justify-center z-10">
          <div className="bg-bg border border-rule/60 p-5 max-w-sm w-full mx-4 flex flex-col gap-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{noteModal.label}</div>
            <textarea
              autoFocus
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              rows={3}
              className="resize-none font-mono text-[12px] text-ink bg-transparent border border-rule/40 focus:border-rule/70 outline-none p-2 leading-relaxed"
              placeholder="note…"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setNoteModal(null)} className="text-[12px] border border-rule/40 px-3 py-1 text-muted hover:text-ink transition-colors">cancel</button>
              <button onClick={submitNoteModal} disabled={!noteText.trim()} className="text-[12px] border border-ink/60 px-3 py-1 text-ink hover:bg-ink hover:text-bg transition-colors disabled:opacity-30">post</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-ink text-bg text-[12px] px-3 py-1.5 z-20">
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
    <div className="shrink-0 border-b border-rule px-5 py-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onCopySlug} className="font-mono text-[13px] font-bold text-ink hover:text-accent transition-colors text-left" title="copy slug">
          {node.slug}
        </button>
        {copied && <span className="text-[11px] text-muted">copied</span>}
        <span className="text-[11px] border border-rule px-1.5 py-0.5 text-muted uppercase tracking-wide">{node.node_type}</span>
        <span className={`text-[11px] border px-1.5 py-0.5 uppercase tracking-wide ${node.status === "canon" ? "border-green-700 text-green-700" : "border-rule text-muted"}`}>
          {node.status}
        </span>
      </div>
      <div className="font-mono text-[11px] text-dim">{String(node.scope)}</div>
      {node.node_type === "task" && (
        <div className="flex gap-px">
          {WORK_STATUS_PILLS.map(ws => (
            <button
              key={ws}
              onClick={() => onWorkStatus(ws)}
              className={`text-[11px] uppercase tracking-wide px-2.5 py-1 border transition-colors ${
                node.work_status === ws
                  ? "bg-ink text-bg border-ink"
                  : "border-rule/30 text-muted hover:border-rule/60 hover:text-ink"
              }`}
            >
              {STATUS_LABELS[ws]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
