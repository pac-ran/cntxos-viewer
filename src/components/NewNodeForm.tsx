"use client";

// NewNodeForm — inline (NOT modal) creation form rendered in the LEFT pane
// header area when "+ new" is clicked. Per Randy 2026-05-09: modals are not
// allowed for this flow.
//
// On successful create the parent navigates to /{newSlug}?actor={actor}.
// Errors render inline below the form.

import { useState, useCallback, useMemo } from "react";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

const NODE_TYPES = [
  "document", "principle", "procedure", "task", "conversation", "file",
  "surface", "walk_formula", "pattern", "session", "policy", "practice",
  "role", "mission", "plan", "opportunity", "entity", "glimmer",
];

interface Props {
  actor: string;
  onCancel: () => void;
  onCreated: (newSlug: string) => void;
}

export function NewNodeForm({ actor, onCancel, onCreated }: Props) {
  const defaultScope = useMemo(
    () => `root.cntxos.workspace.${actor || "randy"}`,
    [actor]
  );

  const [slug, setSlug] = useState("");
  const [nodeType, setNodeType] = useState("document");
  const [scope, setScope] = useState(defaultScope);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [status, setStatus] = useState<"draft" | "canon">("draft");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slugError = slug.length > 0 && !SLUG_RE.test(slug)
    ? "slug must be lowercase letters, digits, dashes (no leading dash)"
    : null;
  const canSubmit = !!slug && !slugError && !!nodeType && !!scope && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const tags = tagsInput
      .split(",")
      .map(t => t.trim().toLowerCase())
      .filter(Boolean);
    try {
      const res = await fetch("/api/node/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: slug.trim(),
          node_type: nodeType,
          scope: scope.trim(),
          title: title.trim() || undefined,
          content: content || undefined,
          tags,
          visibility,
          status,
          actor,
        }),
      });
      const data = await res.json().catch(() => null) as { ok?: boolean; slug?: string; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `error (${res.status})`);
        setSubmitting(false);
        return;
      }
      onCreated(data.slug ?? slug.trim());
    } catch (err) {
      setError(String(err));
      setSubmitting(false);
    }
  }, [canSubmit, slug, nodeType, scope, title, content, tagsInput, visibility, status, actor, onCreated]);

  return (
    <div className="shrink-0 border-b border-ink/40 bg-bg/40 px-4 py-3 flex flex-col gap-3">
      <div className="text-[11px] uppercase tracking-widest text-dim font-semibold">
        new node
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Slug */}
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-muted">slug *</span>
          <input
            autoFocus
            type="text"
            value={slug}
            onChange={e => setSlug(e.target.value)}
            placeholder="my-new-node"
            className="font-mono text-[12px] px-2 py-1 bg-bg border border-ink/70 focus:border-accent outline-none text-ink"
          />
          {slugError && (
            <span className="text-[11px] text-red-600">{slugError}</span>
          )}
        </label>

        {/* node_type */}
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-muted">node_type *</span>
          <select
            value={nodeType}
            onChange={e => setNodeType(e.target.value)}
            className="font-mono text-[12px] px-2 py-1 bg-bg border border-ink/70 focus:border-accent outline-none text-ink"
          >
            {NODE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>

        {/* scope */}
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-[11px] uppercase tracking-wide text-muted">scope *</span>
          <input
            type="text"
            value={scope}
            onChange={e => setScope(e.target.value)}
            className="font-mono text-[12px] px-2 py-1 bg-bg border border-ink/70 focus:border-accent outline-none text-ink"
          />
        </label>

        {/* title */}
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-[11px] uppercase tracking-wide text-muted">title (optional)</span>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="human-readable title"
            className="text-[12px] px-2 py-1 bg-bg border border-ink/70 focus:border-accent outline-none text-ink"
          />
        </label>

        {/* content */}
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-[11px] uppercase tracking-wide text-muted">content (markdown, optional)</span>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={4}
            className="text-[13px] px-2 py-1 bg-bg border border-ink/70 focus:border-accent outline-none text-ink resize-y leading-relaxed"
            placeholder="..."
          />
        </label>

        {/* tags */}
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-[11px] uppercase tracking-wide text-muted">tags (comma-separated)</span>
          <input
            type="text"
            value={tagsInput}
            onChange={e => setTagsInput(e.target.value)}
            placeholder="alpha, beta, gamma"
            className="font-mono text-[12px] px-2 py-1 bg-bg border border-ink/70 focus:border-accent outline-none text-ink"
          />
        </label>

        {/* visibility */}
        <div className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-muted">visibility</span>
          <div className="flex gap-3 text-[12px]">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={visibility === "private"} onChange={() => setVisibility("private")} />
              <span className="text-ink">private</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={visibility === "public"} onChange={() => setVisibility("public")} />
              <span className="text-ink">public</span>
            </label>
          </div>
        </div>

        {/* status */}
        <div className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-muted">status</span>
          <div className="flex gap-3 text-[12px]">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={status === "draft"} onChange={() => setStatus("draft")} />
              <span className="text-ink">draft</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={status === "canon"} onChange={() => setStatus("canon")} />
              <span className="text-ink">canon</span>
            </label>
          </div>
        </div>
      </div>

      {error && (
        <div className="text-[12px] text-red-500 font-mono border border-red-500/40 px-2 py-1">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 justify-end">
        <button
          onClick={onCancel}
          className="text-[12px] text-muted hover:text-ink px-3 py-1.5 transition-colors"
        >
          cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="text-[12px] font-semibold px-4 py-1.5 transition-opacity"
          style={{
            background: canSubmit ? "#C2400C" : "#888",
            color: "#ffffff",
            opacity: canSubmit ? 1 : 0.6,
          }}
        >
          {submitting ? "creating…" : "save"}
        </button>
      </div>
    </div>
  );
}
