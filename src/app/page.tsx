"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { ConnectPanel } from "@/components/ConnectPanel";

interface SearchResult {
  slug: string;
  node_type: string;
  status: string;
  work_status: string;
  content: string | null;
}

const DEFAULT_NODE = "m-box-render-build";

export default function LandingPage() {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
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

  const goEdit = useCallback((slug: string) => {
    router.push(`/${slug}?mode=edit`);
  }, [router]);

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
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-7 flex flex-col gap-4">

          <p className="text-[12px] text-muted">What are you here to do?</p>

          {/* Watch — one click, opens viewer immediately */}
          <button
            onClick={() => router.push(`/${DEFAULT_NODE}`)}
            className="text-left border border-rule/30 hover:border-accent hover:bg-accent/5 px-4 py-4 transition-colors group"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[14px] font-semibold text-ink">Watch</span>
              <span className="text-[11px] text-accent opacity-0 group-hover:opacity-100 transition-opacity">open →</span>
            </div>
            <div className="text-[11px] text-muted">Follow along. Read-only view, no changes.</div>
          </button>

          {/* Edit — opens search picker */}
          <button
            onClick={() => { setEditOpen(true); setQuery(""); setResults([]); setShowResults(false); }}
            className={`text-left border px-4 py-4 transition-colors ${
              editOpen ? "border-accent bg-accent/5" : "border-rule/30 hover:border-accent hover:bg-accent/5"
            }`}
          >
            <div className="text-[14px] font-semibold text-ink mb-1">Edit</div>
            <div className="text-[11px] text-muted">Full editor. Create and update nodes.</div>
          </button>

          {/* Edit node picker */}
          {editOpen && (
            <div className="flex flex-col gap-2.5 pl-1">
              <div className="relative">
                <input
                  type="text"
                  value={query}
                  onChange={e => handleSearchChange(e.target.value)}
                  onFocus={() => { if (results.length > 0) setShowResults(true); }}
                  onBlur={() => setTimeout(() => setShowResults(false), 150)}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      if (results.length > 0) goEdit(results[0].slug);
                      else if (!query.trim()) goEdit(DEFAULT_NODE);
                    }
                    if (e.key === "Escape") { setEditOpen(false); }
                  }}
                  autoFocus
                  placeholder="search nodes…"
                  className="w-full bg-transparent border border-rule/40 focus:border-accent outline-none px-2.5 py-1.5 text-[12px] text-ink placeholder:text-dim transition-colors"
                />
                {searching && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-dim">…</span>
                )}
                {showResults && (
                  <div className="absolute top-full left-0 right-0 mt-0.5 bg-[#222] border border-rule/60 z-30 max-h-56 overflow-y-auto shadow-lg">
                    {results.map(r => (
                      <button
                        key={r.slug}
                        onMouseDown={() => goEdit(r.slug)}
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
              <button
                onClick={() => goEdit(DEFAULT_NODE)}
                className="text-left text-[11px] text-dim hover:text-muted transition-colors"
              >
                or open <span className="font-mono text-accent">{DEFAULT_NODE}</span> →
              </button>
            </div>
          )}

          {/* Contacts */}
          <button
            onClick={() => router.push("/contact-ingress")}
            className="text-left border border-rule/30 hover:border-accent hover:bg-accent/5 px-4 py-4 transition-colors group"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[14px] font-semibold text-ink">Add contact</span>
              <span className="text-[11px] text-accent opacity-0 group-hover:opacity-100 transition-opacity">open →</span>
            </div>
            <div className="text-[11px] text-muted">Ingest a new contact into the substrate.</div>
          </button>

          {/* Box surfaces */}
          <div className="border border-rule/20 px-4 py-3">
            <div className="text-[12px] font-semibold text-muted mb-2">Box</div>
            <div className="flex flex-col gap-1">
              {[
                { slug: "s-box-scripts", label: "Scripts", desc: "cntxos/scripts — file browser" },
                { slug: "s-box-cluster-state", label: "Cluster", desc: "tmux sessions + spawn log" },
              ].map(({ slug, label, desc }) => (
                <button
                  key={slug}
                  onClick={() => router.push(`/${slug}`)}
                  className="text-left flex items-center gap-3 px-2 py-1.5 hover:bg-rule/10 transition-colors group"
                >
                  <span className="font-mono text-[11px] text-accent w-16 shrink-0">{label}</span>
                  <span className="text-[10px] text-dim group-hover:text-muted transition-colors">{desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Manage — coming soon */}
          <div className="border border-rule/15 px-4 py-4 opacity-35 cursor-default">
            <div className="text-[14px] font-semibold text-muted mb-1">Manage</div>
            <div className="text-[11px] text-dim">Project queue, work status, tasks — coming soon</div>
          </div>

        </div>
      </div>

      {/* Right — AI connect panel */}
      <div className="w-[60%] h-full">
        <ConnectPanel />
      </div>
    </div>
  );
}
