"use client";

// ChatPane — bottom of the right iframe. Talks to /api/broker/chat (SSE)
// and /api/broker/sessions (session list / new / fork / rename / archive).
//
// Layout (Randy 2026-05-09):
//   [orange sidebar | thread]
//                    [input box]
//                    [controls strip below input — model · thinking · ctx · totals]
//
// Fonts: Inter for messages + textarea, mono for stats / labels. Inter is
// loaded by viewer's root layout via next/font/google with --font-inter.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import {
  computeCost,
  type DeepseekModelId,
  type DeepseekUsage,
} from "@/lib/deepseek-client";

interface AssistantMeta {
  usage?: DeepseekUsage;
  cost?: number;
  model: DeepseekModelId;
}

interface ToolCallRecord {
  id: string;
  name: string;
  args: string;
  status: "pending" | "ok" | "error";
  result_summary?: string;
  error?: string;
  latency_ms?: number;
}

interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta?: AssistantMeta;
  streaming?: boolean;
  tool_calls?: ToolCallRecord[];
}

interface SessionRow {
  slug: string;
  title: string;
  last_message_at: string | null;
  message_count: number;
}

const CREAM = "#F5F2E8";
const INK = "#1A1A1A";
const RULE = "#B8B09C";
const ORANGE = "#C2400C";
const ORANGE_DARK = "#8A2D08";
const ORANGE_SOFT = "#D9663A";

// Inter font: loaded by /src/app/layout.tsx via next/font as --font-inter.
// System sans stack — used for UI labels per design pass 2026-05-10.
// Reserve mono only for slug pills / code surfaces.
const FONT_SANS =
  'var(--font-inter), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif';

// Recessed chat band — sits 1 step darker than primary content cream.
const CHAT_BG = "#EEEAE0";

function readActor(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("actor");
}

const MODEL_LABEL: Record<DeepseekModelId, string> = {
  "deepseek-v4-flash": "DeepSeek V4 Flash",
  "deepseek-v4-pro":   "DeepSeek V4 Pro",
};

function fmtCost(n: number): string {
  return `$${n.toFixed(4)}`;
}

function fmtTokens(n: number | undefined): string {
  if (!n && n !== 0) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

// Approximate context-token estimate: tokens we're paying for in the next
// request. Real prompt_tokens come back in usage on the LAST assistant turn —
// prefer that when available; otherwise rough char/4 estimate.
function estimateContextTokens(turns: ChatTurn[]): number {
  let lastPrompt = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const u = turns[i].meta?.usage?.prompt_tokens;
    const c = turns[i].meta?.usage?.completion_tokens;
    if (u != null) {
      lastPrompt = u + (c ?? 0);
      break;
    }
  }
  if (lastPrompt) return lastPrompt;
  let chars = 0;
  for (const t of turns) chars += t.content.length;
  return Math.ceil(chars / 4);
}

const DEFAULT_CTX_LIMIT = 1_000_000;

function readDevMode(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("dev") === "1";
}

export function ChatPane() {
  // SSR returns null; useEffect resolves on client. Tracking hydration in a
  // separate flag prevents disabled-attr hydration mismatch on the textarea.
  const [actor, setActor] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [devMode, setDevMode] = useState(false);
  // Chat open/closed is deliberate (not auto). Default open; persisted per actor.
  const [chatOpen, setChatOpen] = useState<boolean>(true);
  useEffect(() => {
    const a = readActor();
    setActor(a);
    setDevMode(readDevMode());
    if (a) {
      try {
        const raw = localStorage.getItem(`chat-open-${a}`);
        if (raw === "0") setChatOpen(false);
        else if (raw === "1") setChatOpen(true);
      } catch { /* ignore */ }
    }
    setHydrated(true);
  }, []);
  // Persist open/closed per actor.
  useEffect(() => {
    if (!actor || !hydrated) return;
    try { localStorage.setItem(`chat-open-${actor}`, chatOpen ? "1" : "0"); } catch { /* ignore */ }
  }, [chatOpen, actor, hydrated]);
  const [model, setModel] = useState<DeepseekModelId>("deepseek-v4-flash");
  const [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [renamingSlug, setRenamingSlug] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [menuOpenSlug, setMenuOpenSlug] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const sessionCost = useMemo(
    () => turns.reduce((acc, t) => acc + (t.meta?.cost ?? 0), 0),
    [turns]
  );
  const turnCount = turns.filter(t => t.role === "user").length;
  const ctxTokens = useMemo(() => estimateContextTokens(turns), [turns]);

  // Persist active session per actor.
  const activeKey = actor ? `chat-active-session-${actor}` : null;

  const refreshSessions = useCallback(async (): Promise<SessionRow[]> => {
    if (!actor) return [];
    try {
      const res = await fetch(`/api/broker/sessions?actor=${encodeURIComponent(actor)}`);
      if (!res.ok) return [];
      const data = (await res.json()) as { sessions?: SessionRow[] };
      const list = data.sessions ?? [];
      setSessions(list);
      return list;
    } catch {
      return [];
    }
  }, [actor]);

  const loadMessages = useCallback(async (slug: string) => {
    try {
      const res = await fetch(`/api/broker/messages?slug=${encodeURIComponent(slug)}`);
      if (!res.ok) {
        setTurns([]);
        return;
      }
      const data = (await res.json()) as {
        messages?: Array<{
          id: string;
          role: "user" | "assistant";
          content: string;
          model?: string;
          usage?: DeepseekUsage;
        }>;
      };
      const msgs = data.messages ?? [];
      const loaded: ChatTurn[] = msgs.map((m, i) => ({
        id: `${m.role[0]}-${m.id ?? i}`,
        role: m.role,
        content: m.content,
        meta:
          m.role === "assistant"
            ? {
                model: (m.model as DeepseekModelId) ?? "deepseek-v4-flash",
                usage: m.usage,
                cost: m.usage
                  ? computeCost(
                      m.usage,
                      (m.model as DeepseekModelId) ?? "deepseek-v4-flash"
                    )
                  : 0,
              }
            : undefined,
      }));
      setTurns(loaded);
    } catch {
      setTurns([]);
    }
  }, []);

  // Initial mount: load sessions, restore active selection.
  useEffect(() => {
    if (!actor) return;
    (async () => {
      const list = await refreshSessions();
      const stored = activeKey ? localStorage.getItem(activeKey) : null;
      const exists = stored && list.some((s) => s.slug === stored);
      const target =
        exists ? stored! :
        list[0]?.slug ??
        `conv-broker-${actor}`;
      setActiveSlug(target);
      await loadMessages(target);
    })();
  }, [actor, activeKey, refreshSessions, loadMessages]);

  // Persist active selection.
  useEffect(() => {
    if (!activeKey || !activeSlug) return;
    try {
      localStorage.setItem(activeKey, activeSlug);
    } catch { /* ignore */ }
  }, [activeKey, activeSlug]);

  // Auto-scroll to bottom when content changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns]);

  // Close session row menu on outside click.
  useEffect(() => {
    if (!menuOpenSlug) return;
    const onClick = () => setMenuOpenSlug(null);
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [menuOpenSlug]);

  const switchSession = useCallback(async (slug: string) => {
    if (slug === activeSlug || streaming) return;
    setActiveSlug(slug);
    await loadMessages(slug);
  }, [activeSlug, streaming, loadMessages]);

  const newSession = useCallback(async () => {
    if (!actor) return;
    try {
      const res = await fetch("/api/broker/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor, action: "new" }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { slug?: string };
      if (!data.slug) return;
      await refreshSessions();
      setActiveSlug(data.slug);
      setTurns([]);
      requestAnimationFrame(() => taRef.current?.focus());
    } catch { /* ignore */ }
  }, [actor, refreshSessions]);

  const forkSession = useCallback(async (sourceSlug: string) => {
    if (!actor) return;
    setMenuOpenSlug(null);
    try {
      const res = await fetch("/api/broker/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor, action: "fork", source_slug: sourceSlug }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { slug?: string };
      await refreshSessions();
      if (data.slug) {
        setActiveSlug(data.slug);
        await loadMessages(data.slug);
      }
    } catch { /* ignore */ }
  }, [actor, refreshSessions, loadMessages]);

  const archiveSession = useCallback(async (targetSlug: string) => {
    if (!actor) return;
    setMenuOpenSlug(null);
    try {
      await fetch("/api/broker/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor, action: "archive", target_slug: targetSlug }),
      });
      const list = await refreshSessions();
      if (targetSlug === activeSlug) {
        const next = list[0]?.slug ?? `conv-broker-${actor}`;
        setActiveSlug(next);
        await loadMessages(next);
      }
    } catch { /* ignore */ }
  }, [actor, activeSlug, refreshSessions, loadMessages]);

  const commitRename = useCallback(async () => {
    const slug = renamingSlug;
    const title = renameDraft.trim();
    setRenamingSlug(null);
    if (!actor || !slug || !title) return;
    try {
      await fetch("/api/broker/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor, action: "rename", target_slug: slug, new_title: title }),
      });
      await refreshSessions();
    } catch { /* ignore */ }
  }, [actor, renamingSlug, renameDraft, refreshSessions]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || streaming || !actor || !activeSlug) return;

    const userTurn: ChatTurn = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
    };
    const asstId = `a-${Date.now()}`;
    const asstTurn: ChatTurn = {
      id: asstId,
      role: "assistant",
      content: "",
      streaming: true,
      meta: { model },
    };
    const thinkingForThisTurn = thinking;
    setThinking(false);
    setDraft("");
    setError(null);
    setStreaming(true);
    setTurns(prev => [...prev, userTurn, asstTurn]);

    const history = [
      ...turns.map(t => ({ role: t.role, content: t.content })),
      { role: "user" as const, content: text },
    ];

    let acc = "";
    let usage: DeepseekUsage | undefined;
    const wasFirst = turns.length === 0;

    try {
      const res = await fetch("/api/broker/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actor,
          model,
          thinking: thinkingForThisTurn,
          messages: history,
          session_slug: activeSlug,
        }),
      });
      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).replace(/\r$/, "");
          buf = buf.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
              usage?: DeepseekUsage;
              error?: string;
              ds_tool_call?: { id: string; name: string; args: string };
              ds_tool_result?: {
                id: string;
                name: string;
                result: unknown;
                error: string | null;
                latency_ms: number;
              };
            };
            if (parsed.error) throw new Error(parsed.error);
            // DS tool call announced — push a pending chip into the assistant turn.
            if (parsed.ds_tool_call) {
              const tc = parsed.ds_tool_call;
              setTurns(prev =>
                prev.map(t =>
                  t.id === asstId
                    ? {
                        ...t,
                        tool_calls: [
                          ...(t.tool_calls ?? []),
                          { id: tc.id, name: tc.name, args: tc.args, status: "pending" },
                        ],
                      }
                    : t
                )
              );
            }
            // DS tool result — flip the chip to ok/error and record summary.
            if (parsed.ds_tool_result) {
              const tr = parsed.ds_tool_result;
              let summary = "";
              try {
                const s = typeof tr.result === "string" ? tr.result : JSON.stringify(tr.result);
                summary = s.length > 120 ? s.slice(0, 120) + "…" : s;
              } catch {
                summary = String(tr.result);
              }
              setTurns(prev =>
                prev.map(t => {
                  if (t.id !== asstId) return t;
                  const calls = (t.tool_calls ?? []).map(c =>
                    c.id === tr.id
                      ? {
                          ...c,
                          status: tr.error ? ("error" as const) : ("ok" as const),
                          result_summary: summary,
                          error: tr.error ?? undefined,
                          latency_ms: tr.latency_ms,
                        }
                      : c
                  );
                  return { ...t, tool_calls: calls };
                })
              );
            }
            const delta = parsed.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta) {
              acc += delta;
              setTurns(prev =>
                prev.map(t => (t.id === asstId ? { ...t, content: acc } : t))
              );
            }
            if (parsed.usage) usage = parsed.usage;
          } catch { /* skip partials */ }
        }
      }
      const cost = usage ? computeCost(usage, model) : 0;
      setTurns(prev =>
        prev.map(t =>
          t.id === asstId
            ? { ...t, streaming: false, meta: { model, usage, cost } }
            : t
        )
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setTurns(prev =>
        prev.map(t =>
          t.id === asstId
            ? { ...t, streaming: false, content: t.content || `[error: ${msg}]` }
            : t
        )
      );
    } finally {
      setStreaming(false);
      // If this was the first exchange, the server fires auto-title in the
      // background — refresh sessions a beat later to pick up the new label.
      if (wasFirst) {
        setTimeout(() => { void refreshSessions(); }, 2500);
      } else {
        void refreshSessions();
      }
      requestAnimationFrame(() => taRef.current?.focus());
    }
  }, [draft, streaming, actor, model, thinking, turns, activeSlug, refreshSessions]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void send();
      }
    },
    [send]
  );

  const sidebarWidth = sidebarCollapsed ? 32 : 144;

  // Chat is open or closed — deliberately, persisted per actor (Randy 2026-05-10).
  // No focus-or-content magic. Aliased to "expanded" to keep downstream JSX small.
  const expanded = chatOpen;

  // Closed state: a single deliberate reopen affordance. No magic.
  if (!chatOpen) {
    return (
      <div
        className="flex items-center justify-between h-full px-3 transition-all duration-200 ease-out"
        style={{ background: CHAT_BG, color: INK, fontFamily: FONT_SANS, borderTop: `1px solid ${RULE}80` }}
      >
        <span className="text-[12px]" style={{ color: "#6b6450" }}>
          chat closed
        </span>
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="text-[12px] px-3 py-1.5 border transition-colors"
          style={{ borderColor: ORANGE, color: ORANGE, background: "transparent" }}
        >
          Open chat
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full transition-all duration-200 ease-out"
      style={{ background: CHAT_BG, color: INK, fontFamily: FONT_SANS }}
    >
      {/* Header — title + close. Deliberate, not cute. */}
      <div
        className="shrink-0 flex items-center justify-between px-3 py-1.5 border-b"
        style={{ borderColor: `${RULE}80`, background: CHAT_BG }}
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.04em]" style={{ color: "#6b6450" }}>
          chat
        </span>
        <button
          type="button"
          onClick={() => setChatOpen(false)}
          aria-label="Close chat"
          title="Close chat"
          className="w-6 h-6 flex items-center justify-center text-[14px] leading-none hover:opacity-100 opacity-70 transition-opacity"
          style={{ color: INK }}
        >
          ✕
        </button>
      </div>

      {/* Body — sidebar (sessions) + main column (thread/input/controls) */}
      <div className="flex flex-1 min-h-0">
      {/* Sidebar — sessions. */}
      {expanded && (
      <div
        className="shrink-0 flex flex-col h-full transition-all"
        style={{ width: sidebarWidth, background: ORANGE, color: CREAM }}
      >
        <div className="shrink-0 flex items-center justify-between px-1.5 py-1.5 gap-1">
          <button
            onClick={newSession}
            title="new chat"
            className="w-6 h-6 flex items-center justify-center border text-[14px] leading-none hover:bg-white/10 transition-colors"
            style={{ borderColor: CREAM, color: CREAM }}
          >
            +
          </button>
          {!sidebarCollapsed && (
            <button
              onClick={() => setSidebarCollapsed(true)}
              title="collapse sidebar"
              className="w-6 h-6 flex items-center justify-center text-[12px] leading-none opacity-80 hover:opacity-100"
              style={{ color: CREAM }}
            >
              ↤
            </button>
          )}
          {sidebarCollapsed && sessions.length > 0 && (
            <span
              className="font-mono text-[11px] px-1 py-0.5 rounded"
              style={{ background: ORANGE_DARK, color: CREAM }}
              title={`${sessions.length} sessions`}
            >
              {sessions.length}
            </span>
          )}
        </div>
        {sidebarCollapsed && (
          <button
            onClick={() => setSidebarCollapsed(false)}
            title="expand sidebar"
            className="mx-auto mt-1 w-6 h-6 flex items-center justify-center text-[12px] leading-none opacity-80 hover:opacity-100"
            style={{ color: CREAM }}
          >
            ↦
          </button>
        )}
        {!sidebarCollapsed && (
          <div className="flex-1 min-h-0 overflow-auto px-1.5 pb-2 space-y-0.5">
            {sessions.length === 0 && (
              <div
                className="text-[10px] italic opacity-70 px-1 py-2"
                style={{ color: CREAM, fontFamily: FONT_SANS }}
              >
                no sessions yet
              </div>
            )}
            {sessions.map((s) => {
              const isActive = s.slug === activeSlug;
              const isRenaming = renamingSlug === s.slug;
              const truncated = s.title.length > 20 ? `${s.title.slice(0, 19)}…` : s.title;
              return (
                <div
                  key={s.slug}
                  className="group relative"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenuOpenSlug(s.slug);
                  }}
                >
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => void commitRename()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); void commitRename(); }
                        if (e.key === "Escape") { setRenamingSlug(null); }
                      }}
                      className="w-full text-[11px] px-1.5 py-1 border bg-white/95 outline-none"
                      style={{ color: INK, borderColor: ORANGE_DARK, fontFamily: FONT_SANS }}
                    />
                  ) : (
                    <button
                      onClick={() => void switchSession(s.slug)}
                      className="w-full text-left text-[11px] px-1.5 py-1 transition-colors flex items-center gap-1"
                      style={{
                        background: isActive ? ORANGE_DARK : "transparent",
                        color: CREAM,
                        fontFamily: FONT_SANS,
                      }}
                      title={s.title}
                    >
                      <span className="flex-1 truncate">{truncated}</span>
                      <span
                        className="opacity-0 group-hover:opacity-80 hover:opacity-100 text-[10px] leading-none"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenameDraft(s.title);
                          setRenamingSlug(s.slug);
                        }}
                        title="rename"
                      >
                        ✎
                      </span>
                      <span
                        className="opacity-0 group-hover:opacity-80 hover:opacity-100 text-[12px] leading-none"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenSlug(menuOpenSlug === s.slug ? null : s.slug);
                        }}
                        title="more"
                      >
                        ⋯
                      </span>
                    </button>
                  )}
                  {menuOpenSlug === s.slug && (
                    <div
                      className="absolute right-0 top-full z-20 mt-0.5 border shadow-lg"
                      style={{ background: CREAM, borderColor: ORANGE_DARK, color: INK, fontFamily: FONT_SANS }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => void forkSession(s.slug)}
                        className="block w-full text-left text-[11px] px-2 py-1 hover:bg-black/5 whitespace-nowrap"
                      >
                        fork from here
                      </button>
                      <button
                        onClick={() => void archiveSession(s.slug)}
                        className="block w-full text-left text-[11px] px-2 py-1 hover:bg-black/5 whitespace-nowrap"
                      >
                        archive
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* Right column — thread + input + controls */}
      <div className="flex-1 min-w-0 flex flex-col h-full">
        {/* Thread — hidden when recessed (no turns, not focused) */}
        {expanded && (
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto px-3 py-3 space-y-3">
          {turns.length === 0 && (
            <div
              className="text-[12px] italic opacity-60 text-center mt-8"
              style={{ color: "#6b6450", fontFamily: FONT_SANS }}
            >
              {actor ? `chat as ${actor} — type below to begin` : "no actor in URL"}
            </div>
          )}
          {turns.map(t => (
            <TurnView key={t.id} turn={t} />
          ))}
          {error && (
            <div
              className="font-mono text-[10px] px-2 py-1 border"
              style={{ color: ORANGE, borderColor: ORANGE }}
            >
              {error}
            </div>
          )}
        </div>
        )}

        {/* Send box — always visible. Top rule reads as a recessed band when collapsed. */}
        <div
          className="shrink-0 border-t px-3 py-2 flex gap-2 items-end"
          style={{ borderColor: `${RULE}80` }}
        >
          <textarea
            ref={taRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={streaming ? "streaming…" : (expanded ? "message — Enter to send · Shift+Enter newline" : "Ask…")}
            disabled={!hydrated || streaming || !actor}
            rows={expanded ? 2 : 1}
            className="flex-1 resize-none bg-transparent border-0 px-2 py-1.5 text-[13px] leading-relaxed focus:outline-none"
            style={{
              color: INK,
              minHeight: expanded ? 40 : 28,
              maxHeight: 160,
              fontFamily: FONT_SANS,
            }}
          />
          <button
            onClick={() => void send()}
            disabled={streaming || !draft.trim() || !actor}
            className="font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 border transition-colors disabled:opacity-40"
            style={
              streaming || !draft.trim()
                ? { borderColor: `${RULE}99`, color: "#6b6450", background: "transparent" }
                : { borderColor: ORANGE, color: CREAM, background: ORANGE }
            }
          >
            {streaming ? "…" : "send"}
          </button>
        </div>

        {/* Controls strip — BELOW input. Operator-only chrome (model picker,
            thinking toggle, ctx tokens, session cost). Hidden in user mode. */}
        {devMode && expanded && (
        <div
          className="shrink-0 flex items-center gap-3 px-3 h-7 border-t font-mono text-[10px]"
          style={{ borderColor: `${RULE}80`, background: CREAM }}
        >
          <select
            value={model}
            onChange={e => setModel(e.target.value as DeepseekModelId)}
            className="bg-transparent border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
            style={{ borderColor: `${RULE}99`, color: INK }}
            disabled={streaming}
            title="Model"
          >
            <option value="deepseek-v4-flash">{MODEL_LABEL["deepseek-v4-flash"]}</option>
            <option value="deepseek-v4-pro">{MODEL_LABEL["deepseek-v4-pro"]}</option>
          </select>
          <button
            onClick={() => setThinking(t => !t)}
            disabled={streaming}
            title={thinking ? "Thinking ON for next message" : "Thinking OFF"}
            className="border px-1.5 py-0.5 font-mono text-[11px] leading-none transition-colors"
            style={
              thinking
                ? { background: ORANGE, color: CREAM, borderColor: ORANGE }
                : { background: "transparent", color: INK, borderColor: `${RULE}99` }
            }
          >
            🧠 think{thinking ? " ON" : ""}
          </button>
          <span
            className="font-mono text-[10px] uppercase tracking-wider"
            style={{ color: "#6b6450" }}
            title="estimated context tokens / context window"
          >
            {fmtTokens(ctxTokens)}/{fmtTokens(DEFAULT_CTX_LIMIT)} ctx
          </span>
          <span
            className="ml-auto font-mono text-[10px] uppercase tracking-wider"
            style={{ color: "#6b6450" }}
          >
            session: {fmtCost(sessionCost)} · {turnCount} turn{turnCount === 1 ? "" : "s"}
          </span>
        </div>
        )}
      </div>
      </div>
    </div>
  );
}

function TurnView({ turn }: { turn: ChatTurn }) {
  const html = useMemo(() => {
    if (turn.role !== "assistant" || !turn.content) return "";
    try {
      return marked.parse(turn.content, { async: false }) as string;
    } catch {
      return turn.content;
    }
  }, [turn.content, turn.role]);

  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] border px-2.5 py-1.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words"
          style={{
            borderColor: ORANGE,
            color: INK,
            background: "transparent",
            fontFamily: FONT_SANS,
          }}
        >
          {turn.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div
        className="max-w-[92%] text-[13px] leading-relaxed"
        style={{ color: INK, fontFamily: FONT_SANS }}
      >
        {turn.streaming && !turn.content && (turn.tool_calls?.length ?? 0) === 0 && (
          <span className="opacity-50 italic">thinking…</span>
        )}
        {turn.tool_calls && turn.tool_calls.length > 0 && (
          <div className="mb-1.5 ml-3 space-y-0.5">
            {turn.tool_calls.map(tc => (
              <ToolCallChip key={tc.id} tc={tc} />
            ))}
          </div>
        )}
        <div
          className="ds-md whitespace-pre-wrap break-words"
          style={{ color: INK, fontFamily: FONT_SANS }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {!turn.streaming && turn.meta?.usage && (
          <div
            className="mt-1 font-mono text-[10px] uppercase tracking-wider"
            style={{ color: "#6b6450" }}
          >
            🪙 {fmtTokens(turn.meta.usage.prompt_tokens)} in / {fmtTokens(turn.meta.usage.completion_tokens)} out · {fmtCost(turn.meta.cost ?? 0)}
          </div>
        )}
      </div>
    </div>
  );
}

// Tool-call chip — shown inline above assistant messages while DS reads/writes
// substrate. Mono, dimmer, slight indent. Status icon flips on result arrival.
function ToolCallChip({ tc }: { tc: ToolCallRecord }) {
  // Compress args for display: prefer common keys, else truncate JSON.
  let argsText = "";
  try {
    const o = JSON.parse(tc.args || "{}") as Record<string, unknown>;
    const k = Object.keys(o);
    if (k.length === 0) {
      argsText = "";
    } else {
      argsText = k
        .map(key => {
          const v = o[key];
          const s = typeof v === "string" ? v : JSON.stringify(v);
          return `${key}=${s.length > 40 ? s.slice(0, 40) + "…" : s}`;
        })
        .join(", ");
    }
  } catch {
    argsText = tc.args.length > 60 ? tc.args.slice(0, 60) + "…" : tc.args;
  }
  const icon = tc.status === "pending" ? "⋯" : tc.status === "ok" ? "✓" : "✗";
  const color =
    tc.status === "pending" ? "#8a8a8a" : tc.status === "ok" ? "#3f7d3a" : ORANGE;
  return (
    <div
      className="font-mono text-[10px] leading-tight"
      style={{ color, opacity: tc.status === "pending" ? 0.7 : 0.85 }}
      title={tc.error ?? tc.result_summary ?? ""}
    >
      <span className="mr-1">↳</span>
      <span>{icon}</span>{" "}
      <span style={{ color: INK, opacity: 0.7 }}>{tc.name}</span>
      <span style={{ color: "#6b6450" }}>({argsText})</span>
      {tc.status !== "pending" && tc.result_summary && (
        <span style={{ color: "#6b6450" }}>
          {" "}
          → {tc.result_summary}
        </span>
      )}
      {tc.error && (
        <span style={{ color: ORANGE }}> · {tc.error}</span>
      )}
    </div>
  );
}

// suppress unused warning for ORANGE_SOFT — reserved for future inactive style.
void ORANGE_SOFT;
