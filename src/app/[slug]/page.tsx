"use client";

import { useState, useCallback, useRef, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { WrapperPanel } from "@/components/WrapperPanel";
import { NodeEditor } from "@/components/NodeEditor";
import { NodeViewer } from "@/components/NodeViewer";

interface SearchResult {
  slug: string;
  node_type: string;
  status: string;
  work_status: string;
  content: string | null;
}

interface Props {
  params: Promise<{ slug: string }>;
}

export default function NodePage({ params }: Props) {
  const { slug } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"view" | "edit">(
    searchParams.get("mode") === "edit" ? "edit" : "view"
  );

  // Search state
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

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

  const navigateTo = useCallback((targetSlug: string) => {
    setQuery("");
    setResults([]);
    setShowResults(false);
    setMode("view");
    router.push(`/${targetSlug}`);
  }, [router]);

  return (
    <div className="flex h-full">
      {/* Left pane — 40% */}
      <div className="relative w-[40%] h-full border-r border-rule/30 flex flex-col overflow-hidden">

        {/* Pane header with search */}
        <div className="shrink-0 px-4 py-2 border-b border-rule/30 flex items-center gap-2">
          <button
            onClick={() => router.push("/")}
            className="shrink-0 text-[10px] text-dim hover:text-accent transition-colors font-mono"
            title="session home"
          >
            ←
          </button>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-dim shrink-0">
            {mode === "view" ? "view" : "edit"}
          </span>

          {/* Search box */}
          <div ref={searchRef} className="relative flex-1">
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
              placeholder="search nodes…"
              className="w-full bg-transparent border border-rule/30 focus:border-rule/60 outline-none px-2.5 py-1 text-[12px] text-ink placeholder:text-dim transition-colors"
            />
            {searching && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-dim">…</span>
            )}
            {showResults && (
              <div className="absolute top-full left-0 right-0 mt-0.5 bg-[#222] border border-rule/60 z-30 max-h-64 overflow-y-auto shadow-lg">
                {results.map(r => (
                  <button
                    key={r.slug}
                    onMouseDown={() => navigateTo(r.slug)}
                    className="w-full text-left px-3 py-2 hover:bg-rule/20 transition-colors border-b border-rule/20 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-ink truncate">{r.slug}</span>
                      <span className="font-mono text-[9px] border border-rule/40 px-1 py-px text-muted shrink-0 uppercase">{r.node_type}</span>
                    </div>
                    {r.content && (
                      <div className="text-[11px] text-dim truncate mt-0.5">
                        {r.content.slice(0, 80)}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {mode === "edit" && (
            <button
              onClick={() => setMode("view")}
              className="shrink-0 text-[11px] border border-rule/40 px-2 py-0.5 text-muted hover:text-ink transition-colors"
            >
              ← view
            </button>
          )}
        </div>

        {mode === "view"
          ? <NodeViewer slug={slug} onEdit={() => setMode("edit")} />
          : <NodeEditor slug={slug} />
        }
      </div>

      {/* Right pane — 60% — AI viewer */}
      <div className="w-[60%] h-full">
        <WrapperPanel />
      </div>
    </div>
  );
}
