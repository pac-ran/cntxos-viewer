"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { ConnectPanel } from "@/components/ConnectPanel";

type Mode = "watch" | "edit";

interface SearchResult {
  slug: string;
  node_type: string;
  status: string;
  work_status: string;
  content: string | null;
}

const MODES: { id: Mode; label: string; desc: string }[] = [
  { id: "watch", label: "Watch", desc: "Follow along. Read-only view of any node." },
  { id: "edit",  label: "Edit",  desc: "Full editor. Create and update nodes." },
];

const DEFAULT_NODE = "m-box-render-build";

export default function LandingPage() {
  const router = useRouter();
  const [selectedMode, setSelectedMode] = useState<Mode | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); setShowResults(false); return; }
    setSearching(true);
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const { results: r } = await res.json() as { results: SearchResult[] };
    setResults(r);
    setShowResults(r.length > 0);
    setSearching(false);
  }, []);

  const handleSearchChange = useCallback((val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(val), 250);
  }, [runSearch]);

  const go = useCallback((slug: string, mode: Mode) => {
    const url = mode === "edit" ? `/${slug}?mode=edit` : `/${slug}`;
    router.push(url);
  }, [router]);

  const handleSelectMode = (mode: Mode) => {
    setSelectedMode(mode);
    setQuery("");
    setResults([]);
    setShowResults(false);
  };

  return (
    <div className="flex h-full">
      {/* Left — session home */}
      <div className="w-[40%] h-full border-r border-rule/30 flex flex-col overflow-hidden">

        {/* Pane header */}
        <div className="shrink-0 px-4 py-2 border-b border-rule/30">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-dim">
            session home
          </span>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-7 flex flex-col gap-5">

          <p className="text-[12px] text-muted">What are you here to do?</p>

          {/* Mode cards */}
          <div className="flex flex-col gap-2">
            {MODES.map(m => (
              <button
                key={m.id}
                onClick={() => handleSelectMode(m.id)}
                className={`text-left border px-4 py-3 transition-colors ${
                  selectedMode === m.id
                    ? "border-ink/60 bg-rule/10"
                    : "border-rule/30 hover:border-rule/60"
                }`}
              >
                <div className="text-[13px] font-semibold text-ink mb-0.5">{m.label}</div>
                <div className="text-[11px] text-muted">{m.desc}</div>
              </button>
            ))}

            {/* Manage — coming soon */}
            <div className="text-left border border-rule/20 px-4 py-3 opacity-40 cursor-default">
              <div className="text-[13px] font-semibold text-muted mb-0.5">Manage</div>
              <div className="text-[11px] text-dim">Project queue. Work status and tasks. — coming soon</div>
            </div>
          </div>

          {/* Node picker — appears after mode selection */}
          {selectedMode && (
            <div className="flex flex-col gap-3 pt-2 border-t border-rule/20">
              <span className="text-[10px] uppercase tracking-widest text-dim">pick a node</span>

              {/* Search */}
              <div className="relative">
                <input
                  type="text"
                  value={query}
                  onChange={e => handleSearchChange(e.target.value)}
                  onFocus={() => { if (results.length > 0) setShowResults(true); }}
                  onBlur={() => setTimeout(() => setShowResults(false), 150)}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      if (results.length > 0) go(results[0].slug, selectedMode);
                      else if (!query.trim()) go(DEFAULT_NODE, selectedMode);
                    }
                    if (e.key === "Escape") { setQuery(""); setShowResults(false); }
                  }}
                  autoFocus
                  placeholder="search nodes…"
                  className="w-full bg-transparent border border-rule/30 focus:border-rule/60 outline-none px-2.5 py-1.5 text-[12px] text-ink placeholder:text-dim transition-colors"
                />
                {searching && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-dim">…</span>
                )}
                {showResults && (
                  <div className="absolute top-full left-0 right-0 mt-0.5 bg-[#222] border border-rule/60 z-30 max-h-56 overflow-y-auto shadow-lg">
                    {results.map(r => (
                      <button
                        key={r.slug}
                        onMouseDown={() => go(r.slug, selectedMode)}
                        className="w-full text-left px-3 py-2 hover:bg-rule/20 transition-colors border-b border-rule/20 last:border-0"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-ink truncate">{r.slug}</span>
                          <span className="font-mono text-[9px] border border-rule/40 px-1 py-px text-muted shrink-0 uppercase">{r.node_type}</span>
                        </div>
                        {r.content && (
                          <div className="text-[11px] text-dim truncate mt-0.5">{r.content.slice(0, 80)}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Quick open default */}
              <button
                onClick={() => go(DEFAULT_NODE, selectedMode)}
                className="text-left text-[11px] text-dim hover:text-muted transition-colors"
              >
                or open <span className="font-mono">{DEFAULT_NODE}</span> →
              </button>
            </div>
          )}

        </div>
      </div>

      {/* Right — AI connect panel */}
      <div className="w-[60%] h-full">
        <ConnectPanel />
      </div>
    </div>
  );
}
