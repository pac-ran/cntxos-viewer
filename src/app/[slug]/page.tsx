"use client";

import { useState, useCallback, useRef, useEffect, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { NodeEditor } from "@/components/NodeEditor";
import { NodeViewer } from "@/components/NodeViewer";
import { NewNodeForm } from "@/components/NewNodeForm";
import { AdminRail } from "@/components/AdminRail";
import { getBrowserSupabase } from "@/lib/supabase-browser";

interface SearchResult {
  slug: string;
  node_type: string;
  scope: string;
  status: string;
  snippet: string;
}

const NODE_TYPES = [
  "document", "principle", "procedure", "task", "conversation", "file",
  "surface", "walk_formula", "pattern", "session", "policy", "practice",
  "role", "mission", "plan", "opportunity", "entity", "glimmer",
];

interface Props {
  params: Promise<{ slug: string }>;
}

export default function NodePage({ params }: Props) {
  const { slug } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const actor = searchParams.get("actor") ?? "randy";

  const [mode, setMode] = useState<"view" | "edit">(
    searchParams.get("mode") === "edit" ? "edit" : "view"
  );

  // Write left_slug to frame-state so DL knows what Randy is viewing
  useEffect(() => {
    fetch("/api/frame-state", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ left_slug: slug }),
    }).catch(() => {/* non-critical */});
  }, [slug]);

  // LEFT pane Realtime subscription removed (Randy 2026-05-09):
  // LEFT is user/org CRUD only — agent does NOT drive LEFT.
  // The set_left_pane DS tool was also removed from the active TOOLS map.
  // If we ever want a separate agent-driveable surface, build it as a NEW
  // pane, not by re-coupling LEFT to agent events.

  // ── Search state ─────────────────────────────────────────────────────────
  // URL-persisted so reload preserves filter state.
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [typeFilters, setTypeFilters] = useState<string[]>(
    (searchParams.get("types") ?? "").split(",").filter(Boolean)
  );
  const [scopeFilter, setScopeFilter] = useState(searchParams.get("scopes") ?? "");
  const [includeArchived, setIncludeArchived] = useState(
    searchParams.get("archived") === "1"
  );
  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const persistFilters = useCallback((q: string, types: string[], scopes: string, arch: boolean) => {
    const sp = new URLSearchParams();
    if (actor) sp.set("actor", actor);
    if (q) sp.set("q", q);
    if (types.length > 0) sp.set("types", types.join(","));
    if (scopes) sp.set("scopes", scopes);
    if (arch) sp.set("archived", "1");
    const qs = sp.toString();
    // Replace, not push — search state shouldn't litter history.
    const url = qs ? `?${qs}` : window.location.pathname;
    window.history.replaceState({}, "", url);
  }, [actor]);

  const runSearch = useCallback(async (q: string, types: string[], scopes: string, arch: boolean) => {
    if (q.length < 2) { setResults([]); setShowResults(false); return; }
    setSearching(true);
    const sp = new URLSearchParams({ q });
    if (actor) sp.set("actor", actor);
    if (types.length > 0) sp.set("types", types.join(","));
    if (scopes) sp.set("scopes", scopes);
    if (arch) sp.set("include_archived", "1");
    try {
      const res = await fetch(`/api/node/search?${sp.toString()}`);
      const { results: r } = await res.json() as { results: SearchResult[] };
      setResults(r ?? []);
      // Always show the dropdown for non-empty queries — empty-state message
      // makes "no matches" obvious instead of looking like search is broken.
      setShowResults(true);
    } finally {
      setSearching(false);
    }
  }, [actor]);

  const handleSearchChange = useCallback((val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runSearch(val, typeFilters, scopeFilter, includeArchived);
      persistFilters(val, typeFilters, scopeFilter, includeArchived);
    }, 250);
  }, [runSearch, typeFilters, scopeFilter, includeArchived, persistFilters]);

  const toggleType = useCallback((t: string) => {
    setTypeFilters(prev => {
      const next = prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t];
      runSearch(query, next, scopeFilter, includeArchived);
      persistFilters(query, next, scopeFilter, includeArchived);
      return next;
    });
  }, [query, scopeFilter, includeArchived, runSearch, persistFilters]);

  const toggleArchived = useCallback(() => {
    setIncludeArchived(prev => {
      const next = !prev;
      runSearch(query, typeFilters, scopeFilter, next);
      persistFilters(query, typeFilters, scopeFilter, next);
      return next;
    });
  }, [query, typeFilters, scopeFilter, runSearch, persistFilters]);

  const handleScopeChange = useCallback((val: string) => {
    setScopeFilter(val);
    runSearch(query, typeFilters, val, includeArchived);
    persistFilters(query, typeFilters, val, includeArchived);
  }, [query, typeFilters, includeArchived, runSearch, persistFilters]);

  const navigateTo = useCallback((targetSlug: string) => {
    setQuery("");
    setResults([]);
    setShowResults(false);
    setMode("view");
    const sp = new URLSearchParams();
    if (actor) sp.set("actor", actor);
    const qs = sp.toString();
    router.push(`/${targetSlug}${qs ? `?${qs}` : ""}`);
  }, [router, actor]);

  return (
    <div className="flex h-full w-full min-h-0">
      <AdminRail currentSlug={slug} actor={actor} />
      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
      {/* Pane header with search + new button.
          Randy 2026-05-09: full-strength ink border on the search box; the
          old rule/30 was illegible against cream. The "+ new" button is the
          primary action — orange filled, white text. */}
      <div className="shrink-0 px-4 py-2 border-b border-rule/30 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/")}
            className="shrink-0 text-[14px] text-dim hover:text-accent transition-colors"
            title="session home"
          >
            ←
          </button>
          <span className="text-[11px] font-semibold uppercase tracking-widest text-dim shrink-0">
            {mode === "view" ? "view" : "edit"}
          </span>

          {/* Search box — high-contrast cream/ink with magnifying-glass affordance.
              Auto-searches on type (debounced 250ms). Enter navigates first result. */}
          <div ref={searchRef} className="relative flex-1">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/70 text-[15px] pointer-events-none select-none font-bold">⌕</span>
            <input
              type="text"
              value={query}
              onChange={e => handleSearchChange(e.target.value)}
              onFocus={() => { if (results.length > 0) setShowResults(true); }}
              onBlur={() => setTimeout(() => setShowResults(false), 150)}
              onKeyDown={e => {
                if (e.key === "Escape") { setQuery(""); setShowResults(false); }
                if (e.key === "Enter" && results.length > 0) navigateTo(results[0].slug);
              }}
              placeholder="search nodes — type to find by slug, content, or tag"
              className="w-full bg-bg/90 border border-ink focus:border-accent outline-none pl-8 pr-8 h-9 text-[13px] text-ink placeholder:text-ink/60 transition-colors"
            />
            {query && !searching && (
              <button
                onClick={() => { setQuery(""); setResults([]); setShowResults(false); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink/60 hover:text-ink text-[16px] leading-none"
                title="clear"
                tabIndex={-1}
              >
                ×
              </button>
            )}
            {searching && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-dim">…</span>
            )}
            {showResults && (
              <div className="absolute top-full left-0 right-0 mt-0.5 bg-bg border border-ink z-30 max-h-72 overflow-y-auto shadow-lg">
                {results.length === 0 && !searching && (
                  <div className="px-3 py-3 text-[12px] text-muted italic">
                    no matches for &ldquo;{query}&rdquo;{includeArchived ? "" : " (archived hidden — toggle in filters to include)"}
                  </div>
                )}
                {searching && results.length === 0 && (
                  <div className="px-3 py-3 text-[12px] text-dim italic">
                    searching…
                  </div>
                )}
                {results.map(r => (
                  <button
                    key={r.slug}
                    onMouseDown={() => navigateTo(r.slug)}
                    className="w-full text-left px-3 py-2 hover:bg-rule/20 transition-colors border-b border-rule/30 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12px] text-ink truncate">{r.slug}</span>
                      <span className="text-[11px] border border-rule px-1 py-px text-muted shrink-0 uppercase">{r.node_type}</span>
                      {r.status === "archived" && (
                        <span className="text-[11px] text-amber shrink-0 uppercase">archived</span>
                      )}
                    </div>
                    {r.snippet && (
                      <div className="text-[11px] text-dim truncate mt-0.5">{r.snippet}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => setShowFilters(s => !s)}
            className={`shrink-0 text-[12px] px-3 h-9 border transition-colors ${
              showFilters || typeFilters.length > 0 || scopeFilter || includeArchived
                ? "border-ink text-ink bg-bg/80"
                : "border-rule/50 text-dim hover:text-ink hover:border-ink"
            }`}
            title="filters"
          >
            filters{(typeFilters.length > 0 || scopeFilter || includeArchived) ? ` (${typeFilters.length + (scopeFilter ? 1 : 0) + (includeArchived ? 1 : 0)})` : ""}
          </button>

          {/* + new — primary action, orange fill */}
          <button
            onClick={() => setShowNewForm(s => !s)}
            className="shrink-0 text-[12px] font-semibold px-3 h-9 transition-colors"
            style={{ background: "#C2400C", color: "#ffffff" }}
            title="create new node"
          >
            {showNewForm ? "× cancel" : "+ new"}
          </button>

          {mode === "edit" && (
            <button
              onClick={() => setMode("view")}
              className="shrink-0 text-[11px] border border-ink/60 px-2 h-9 text-ink hover:bg-ink hover:text-bg transition-colors"
            >
              ← view
            </button>
          )}
        </div>

        {/* Filter chips */}
        {showFilters && (
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] uppercase tracking-widest text-dim shrink-0 mr-1">type:</span>
              {NODE_TYPES.map(t => (
                <button
                  key={t}
                  onClick={() => toggleType(t)}
                  className={`text-[11px] font-mono px-1.5 py-0.5 border transition-colors ${
                    typeFilters.includes(t)
                      ? "border-accent bg-accent text-bg"
                      : "border-rule/50 text-muted hover:text-ink hover:border-ink"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] uppercase tracking-widest text-dim shrink-0">scope:</span>
              <input
                type="text"
                value={scopeFilter}
                onChange={e => handleScopeChange(e.target.value)}
                placeholder="root.cntxos.workspace.randy"
                className="text-[12px] font-mono px-2 py-1 bg-bg border border-rule focus:border-ink outline-none text-ink placeholder:text-ink/40 flex-1 min-w-[200px]"
              />
              <label className="flex items-center gap-1.5 text-[11px] text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeArchived}
                  onChange={toggleArchived}
                  className="cursor-pointer"
                />
                show archived
              </label>
            </div>
          </div>
        )}
      </div>

      {/* New-node inline form */}
      {showNewForm && (
        <NewNodeForm
          actor={actor}
          onCancel={() => setShowNewForm(false)}
          onCreated={(newSlug) => {
            setShowNewForm(false);
            const sp = new URLSearchParams();
            if (actor) sp.set("actor", actor);
            const qs = sp.toString();
            router.push(`/${newSlug}${qs ? `?${qs}` : ""}`);
          }}
        />
      )}

      {mode === "view"
        ? <NodeViewer slug={slug} onEdit={() => setMode("edit")} />
        : <NodeEditor slug={slug} onExitEdit={() => setMode("view")} />
      }
      </div>
    </div>
  );
}
